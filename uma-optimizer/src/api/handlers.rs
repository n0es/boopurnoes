use axum::{
    extract::State,
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use crate::algorithms::{
    ExpectedValueOptimizer, ExpectedValueV2Optimizer, MonteCarloOptimizer, MonteCarloV2Optimizer, GeneticSearch, Optimizer,
};
use crate::models::*;
use crate::models::config::*;
use crate::models::career::{self, CareerConfig, CareerInitialState};
use crate::models::session::{
    CareerSession, GameEvent, TimelineEntry, TrainingDetail, TurnAction, TurnSnapshot,
};
use rand::SeedableRng;
use crate::models::engine;
use uuid::Uuid;

/// Shared application state.
pub struct AppState {
    pub cards: Vec<SupportCard>,
    pub trainees: Vec<Trainee>,
    /// Card lookup by ID for fast access.
    pub card_index: HashMap<i32, usize>,
    /// Trainee lookup by ID.
    pub trainee_index: HashMap<i32, usize>,
    /// Current running optimization's pause flag (if any).
    pub current_run_pause: Mutex<Option<Arc<AtomicBool>>>,
    /// In-memory career simulation sessions.
    pub career_sessions: Mutex<HashMap<Uuid, crate::models::session::CareerSession>>,
}

impl AppState {
    pub fn new(cards: Vec<SupportCard>, trainees: Vec<Trainee>) -> Self {
        let card_index: HashMap<i32, usize> = cards
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id, i))
            .collect();
        let trainee_index: HashMap<i32, usize> = trainees
            .iter()
            .enumerate()
            .map(|(i, t)| (t.id, i))
            .collect();
        Self {
            cards,
            trainees,
            card_index,
            trainee_index,
            current_run_pause: Mutex::new(None),
            career_sessions: Mutex::new(HashMap::new()),
        }
    }

    fn get_optimizer(&self, algorithm: &AlgorithmId) -> Box<dyn Optimizer> {
        match algorithm {
            AlgorithmId::ExpectedValue => Box::new(ExpectedValueOptimizer::new()),
            AlgorithmId::ExpectedValueV2 => Box::new(ExpectedValueV2Optimizer::new()),
            AlgorithmId::MonteCarlo => Box::new(MonteCarloOptimizer::new()),
            AlgorithmId::MonteCarloV2 => Box::new(MonteCarloV2Optimizer::new()),
        }
    }
}

/// GET /api/algorithms — list available algorithms.
pub async fn list_algorithms() -> Json<Vec<AlgorithmInfo>> {
    Json(vec![
        AlgorithmInfo {
            id: "expected_value".into(),
            name: "Expected Value (V1)".into(),
            description: "Basic deterministic scoring. Fast but assumes flat \
                training distribution and ignores energy/failures.".into(),
            status: "stable".into(),
        },
        AlgorithmInfo {
            id: "expected_value_v2".into(),
            name: "Expected Value V2".into(),
            description: "Energy-aware scoring with facility allocation. Models \
                train/rest cycles, training failures, card events, and per-facility \
                stat bonuses. More realistic stat projections.".into(),
            status: "stable".into(),
        },
        AlgorithmInfo {
            id: "monte_carlo".into(),
            name: "Monte Carlo".into(),
            description: "Stochastic simulation of thousands of 72-turn career runs. \
                More accurate but slower.".into(),
            status: "experimental".into(),
        },
        AlgorithmInfo {
            id: "monte_carlo_v2".into(),
            name: "Monte Carlo Simulation v3".into(),
            description: "Calendar-aware Monte Carlo simulator with facility leveling, \
                energy management, mood tracking, training failure, inheritance events, \
                summer camp, and skill hint resolution. Runs 10,000 parallel simulations \
                for accurate variance modeling.".into(),
            status: "experimental".into(),
        },
    ])
}

#[derive(serde::Serialize)]
pub struct AlgorithmInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
}

/// GET /api/trainees — list all trainees (lightweight).
pub async fn list_trainees(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<TraineeSummary>> {
    let summaries: Vec<TraineeSummary> = state
        .trainees
        .iter()
        .map(|t| TraineeSummary {
            id: t.id,
            name: t.name.clone(),
            title: t.title.clone(),
            rarity: t.rarity,
            stat_growth: t.stat_growth.as_ref().map(|j| j.0.clone()),
        })
        .collect();
    Json(summaries)
}

#[derive(serde::Serialize)]
pub struct TraineeSummary {
    pub id: i32,
    pub name: String,
    pub title: Option<String>,
    pub rarity: i16,
    pub stat_growth: Option<Vec<i16>>,
}

/// GET /api/cards — list all support cards (lightweight).
pub async fn list_cards(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<CardSummary>> {
    let summaries: Vec<CardSummary> = state
        .cards
        .iter()
        .map(|c| CardSummary {
            id: c.id,
            name: c.name.clone(),
            rarity: c.rarity.clone(),
            card_type: c.card_type.clone(),
        })
        .collect();
    Json(summaries)
}

#[derive(serde::Serialize)]
pub struct CardSummary {
    pub id: i32,
    pub name: String,
    pub rarity: String,
    pub card_type: String,
}

/// POST /api/optimize — run deck optimization (original, non-streaming).
pub async fn optimize(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OptimizeRequest>,
) -> Result<Json<OptimizeResponse>, (StatusCode, String)> {
    let start = Instant::now();

    // Look up trainee
    let trainee_idx = state
        .trainee_index
        .get(&req.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, format!("Trainee {} not found", req.trainee_id)))?;
    let trainee = &state.trainees[*trainee_idx];

    // Inject star_rank from request into config so the scorer uses the right starting stats
    let mut config = req.config;
    config.star_rank = req.star_rank;

    // Build card pool + levels
    let (card_pool, card_levels) = if let Some(ref owned) = req.owned_cards {
        // Filter to owned cards at their specified levels
        let mut pool = Vec::new();
        let mut levels = Vec::new();
        for oc in owned {
            if let Some(&idx) = state.card_index.get(&oc.card_id) {
                pool.push(state.cards[idx].clone());
                let max_lvl = SupportCard::max_level_for_uncap(&state.cards[idx].rarity, oc.uncap);
                levels.push(oc.level.min(max_lvl));
            }
        }
        (pool, levels)
    } else {
        // Use all cards at max level (SSR=50, SR=45, R=40 — 4 uncaps)
        let pool = state.cards.clone();
        let levels: Vec<i32> = pool
            .iter()
            .map(|c| SupportCard::max_level_for_uncap(&c.rarity, 4))
            .collect();
        (pool, levels)
    };

    if card_pool.len() < 6 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Need at least 6 cards in pool to build a deck".into(),
        ));
    }

    // Resolve locked cards to pool indices
    let locked_indices: Vec<usize> = req
        .locked_cards
        .iter()
        .filter_map(|lc| card_pool.iter().position(|c| c.id == lc.card_id))
        .collect();

    // Get optimizer
    let optimizer = state.get_optimizer(&req.algorithm);

    // Run genetic search
    let results = GeneticSearch::run(
        optimizer.as_ref(),
        trainee,
        &card_pool,
        &card_levels,
        &locked_indices,
        &config,
        &req.search_params,
    );

    let elapsed = start.elapsed();

    Ok(Json(OptimizeResponse {
        results,
        algorithm: optimizer.id().to_string(),
        elapsed_ms: elapsed.as_millis() as u64,
        search_info: SearchInfo {
            generations_run: req.search_params.generations,
            population_size: req.search_params.population_size,
            total_decks_evaluated: req.search_params.population_size * req.search_params.generations,
            cards_in_pool: card_pool.len(),
        },
    }))
}

/// POST /api/optimize/stream — run deck optimization with SSE streaming.
///
/// Sends generation-by-generation progress as SSE events:
///   event: progress  — top 5 decks updated
///   event: done       — final results
///   event: error      — error message
pub async fn optimize_stream(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OptimizeRequest>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    // Look up trainee
    let trainee_idx = state
        .trainee_index
        .get(&req.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, format!("Trainee {} not found", req.trainee_id)))?;
    let trainee = state.trainees[*trainee_idx].clone();

    let mut config = req.config;
    config.star_rank = req.star_rank;

    // Build card pool + levels
    let (card_pool, card_levels) = if let Some(ref owned) = req.owned_cards {
        let mut pool = Vec::new();
        let mut levels = Vec::new();
        for oc in owned {
            if let Some(&idx) = state.card_index.get(&oc.card_id) {
                pool.push(state.cards[idx].clone());
                let max_lvl = SupportCard::max_level_for_uncap(&state.cards[idx].rarity, oc.uncap);
                levels.push(oc.level.min(max_lvl));
            }
        }
        (pool, levels)
    } else {
        let pool = state.cards.clone();
        let levels: Vec<i32> = pool
            .iter()
            .map(|c| SupportCard::max_level_for_uncap(&c.rarity, 4))
            .collect();
        (pool, levels)
    };

    if card_pool.len() < 6 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Need at least 6 cards in pool to build a deck".into(),
        ));
    }

    let locked_indices: Vec<usize> = req
        .locked_cards
        .iter()
        .filter_map(|lc| card_pool.iter().position(|c| c.id == lc.card_id))
        .collect();

    let optimizer = state.get_optimizer(&req.algorithm);
    let algorithm_id = optimizer.id().to_string();
    let search_params = req.search_params;

    // Create pause flag and store it in shared state
    let pause_flag = Arc::new(AtomicBool::new(false));
    {
        let mut lock = state.current_run_pause.lock().await;
        *lock = Some(Arc::clone(&pause_flag));
    }

    // Channel for generation updates
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);

    let state_clone = Arc::clone(&state);

    // Spawn the GA on a blocking thread (it's CPU-bound)
    let pause_flag_clone = Arc::clone(&pause_flag);
    let search_params_clone = SearchParams {
        population_size: search_params.population_size,
        generations: search_params.generations,
        mutation_rate: search_params.mutation_rate,
        top_n: search_params.top_n,
    };
    let start = Instant::now();

    tokio::task::spawn_blocking(move || {
        let (results, total_evaluated) = GeneticSearch::run_streaming(
            optimizer.as_ref(),
            &trainee,
            &card_pool,
            &card_levels,
            &locked_indices,
            &config,
            &search_params_clone,
            Some(&tx),
            Some(&pause_flag_clone),
        );

        let elapsed = start.elapsed();

        // Send final "done" event through the channel as a special marker
        let final_response = OptimizeResponse {
            results,
            algorithm: algorithm_id,
            elapsed_ms: elapsed.as_millis() as u64,
            search_info: SearchInfo {
                generations_run: search_params_clone.generations,
                population_size: search_params_clone.population_size,
                total_decks_evaluated: total_evaluated,
                cards_in_pool: 0, // filled below
            },
        };

        // We reuse the tx channel; drop it after sending final data
        // The "done" event is signaled by the channel closing after this block
        let _ = tx.blocking_send(crate::algorithms::GenerationUpdate {
            generation: search_params_clone.generations,
            total_generations: search_params_clone.generations,
            best_fitness: final_response.results.first().map(|r| r.fitness).unwrap_or(0.0),
            top_decks: final_response.results,
            decks_evaluated: total_evaluated,
        });

        // Clear the pause flag from shared state
        tokio::spawn(async move {
            let mut lock = state_clone.current_run_pause.lock().await;
            *lock = None;
        });
    });

    // Build the SSE stream from the receiver
    let stream = async_stream::stream! {
        let mut last_gen = 0usize;
        while let Some(update) = rx.recv().await {
            let is_final = update.generation == update.total_generations && update.generation > last_gen;
            last_gen = update.generation;

            if is_final {
                // Send as "done" event
                let json = serde_json::to_string(&update).unwrap_or_default();
                yield Ok(Event::default().event("done").data(json));
            } else {
                // Send as "progress" event
                let json = serde_json::to_string(&update).unwrap_or_default();
                yield Ok(Event::default().event("progress").data(json));
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

/// POST /api/optimize/pause — pause the current running optimization.
pub async fn optimize_pause(
    State(state): State<Arc<AppState>>,
) -> StatusCode {
    let lock = state.current_run_pause.lock().await;
    if let Some(ref flag) = *lock {
        flag.store(true, Ordering::Relaxed);
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

/// POST /api/optimize/resume — resume the current paused optimization.
pub async fn optimize_resume(
    State(state): State<Arc<AppState>>,
) -> StatusCode {
    let lock = state.current_run_pause.lock().await;
    if let Some(ref flag) = *lock {
        flag.store(false, Ordering::Relaxed);
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

/// POST /api/score — score a specific deck (no search, just evaluate).
pub async fn score_deck(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ScoreDeckRequest>,
) -> Result<Json<DeckScore>, (StatusCode, String)> {
    let trainee_idx = state
        .trainee_index
        .get(&req.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, format!("Trainee {} not found", req.trainee_id)))?;
    let trainee = &state.trainees[*trainee_idx];

    let mut config = req.config;
    config.star_rank = req.star_rank;

    let mut cards: Vec<&SupportCard> = Vec::new();
    let mut levels: Vec<i32> = Vec::new();
    for &(card_id, level) in &req.deck {
        let idx = state
            .card_index
            .get(&card_id)
            .ok_or((StatusCode::NOT_FOUND, format!("Card {} not found", card_id)))?;
        cards.push(&state.cards[*idx]);
        levels.push(level);
    }

    let optimizer = state.get_optimizer(&req.algorithm);
    
    tracing::info!(
        "Scoring deck for trainee {} (ID: {}) using {}",
        trainee.name, trainee.id, req.algorithm
    );
    
    let score = optimizer.score_deck(trainee, &cards, &levels, &config);

    tracing::info!(
        "Deck score calculated: fitness={:.2}, projected_total={:.0}",
        score.fitness, score.projected_stats.total()
    );

    Ok(Json(score))
}

/// POST /api/simulate-turn — simulate a single turn based on current run state.
pub async fn simulate_turn(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SimulateTurnRequest>,
) -> Result<Json<TurnResult>, (StatusCode, String)> {
    let trainee_idx = state
        .trainee_index
        .get(&req.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, format!("Trainee {} not found", req.trainee_id)))?;
    let trainee = &state.trainees[*trainee_idx];

    let mut config = req.config;
    config.star_rank = req.star_rank;

    let mut cards: Vec<&SupportCard> = Vec::new();
    let mut levels: Vec<i32> = Vec::new();
    for &(card_id, level) in &req.deck {
        let idx = state
            .card_index
            .get(&card_id)
            .ok_or((StatusCode::NOT_FOUND, format!("Card {} not found", card_id)))?;
        cards.push(&state.cards[*idx]);
        levels.push(level);
    }

    let optimizer = state.get_optimizer(&req.algorithm);

    tracing::info!(
        "Simulating turn {} for trainee {} (ID: {})",
        req.state.turn, trainee.name, trainee.id
    );

    let result = optimizer.simulate_turn(trainee, &cards, &levels, &config, &req.state);

    let max_gain = result.expected_gains.iter().map(|g| g.total()).fold(0.0, f64::max);
    tracing::info!(
        "Turn simulation complete. Max potential gain: {:.1} stats",
        max_gain
    );

    Ok(Json(result))
}

#[derive(serde::Deserialize)]
pub struct SimulateTurnRequest {
    pub trainee_id: i32,
    #[serde(default = "default_star_rank")]
    pub star_rank: u8,
    pub algorithm: AlgorithmId,
    #[serde(default)]
    pub config: ScenarioConfig,
    pub deck: Vec<(i32, i32)>,
    pub state: RunState,
}

#[derive(serde::Deserialize)]
pub struct ScoreDeckRequest {
    pub trainee_id: i32,
    #[serde(default = "default_star_rank")]
    pub star_rank: u8,
    pub algorithm: AlgorithmId,
    #[serde(default)]
    pub config: ScenarioConfig,
    /// Array of (card_id, level) tuples.
    pub deck: Vec<(i32, i32)>,
}

fn default_star_rank() -> u8 { 5 }

/// POST /api/career/init — compute initial state for a career simulation.
///
/// Given a trainee, star rank, deck, and optional legacy config, computes the
/// full starting state including stat breakdowns from each source.
pub async fn career_init(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CareerConfig>,
) -> Result<Json<CareerInitialState>, (StatusCode, String)> {
    // Look up trainee
    let trainee_idx = state
        .trainee_index
        .get(&req.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, format!("Trainee {} not found", req.trainee_id)))?;
    let trainee = &state.trainees[*trainee_idx];

    // Resolve deck cards
    let mut cards: Vec<&SupportCard> = Vec::new();
    let mut levels: Vec<i32> = Vec::new();
    for &(card_id, level) in &req.deck {
        let idx = state
            .card_index
            .get(&card_id)
            .ok_or((StatusCode::NOT_FOUND, format!("Card {} not found", card_id)))?;
        cards.push(&state.cards[*idx]);
        levels.push(level);
    }

    if cards.len() != 6 {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Deck must contain exactly 6 cards, got {}", cards.len()),
        ));
    }

    tracing::info!(
        "Computing career init for trainee {} (ID: {}, {}★) with {} cards",
        trainee.name, trainee.id, req.star_rank, cards.len()
    );

    let initial_state = career::compute_initial_state(trainee, &cards, &levels, &req);

    if let Some(ref leg) = req.legacy {
        tracing::info!(
            "Career init legacy: {} blue factor(s) on tree; inheritance stat sum = {:.0}",
            leg.all_blue_factors().len(),
            initial_state.inheritance_stats.total()
        );
    }

    Ok(Json(initial_state))
}

// ─── Career Session API ─────────────────────────────────────────────────────

/// POST /api/career/create — create a new career session.
///
/// Takes a CareerConfig, computes initial state, creates a session with a UUID,
/// and stores it in the in-memory session map.
pub async fn career_create(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CareerConfig>,
) -> Result<Json<CareerCreateResponse>, (StatusCode, String)> {
    // Look up trainee
    let trainee_idx = state
        .trainee_index
        .get(&req.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, format!("Trainee {} not found", req.trainee_id)))?;
    let trainee = &state.trainees[*trainee_idx];

    // Resolve deck cards
    let mut cards: Vec<&SupportCard> = Vec::new();
    let mut levels: Vec<i32> = Vec::new();
    for &(card_id, level) in &req.deck {
        let idx = state
            .card_index
            .get(&card_id)
            .ok_or((StatusCode::NOT_FOUND, format!("Card {} not found", card_id)))?;
        cards.push(&state.cards[*idx]);
        levels.push(level);
    }

    if cards.len() != 6 {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Deck must contain exactly 6 cards, got {}", cards.len()),
        ));
    }

    // Compute initial state
    let initial_state = career::compute_initial_state(trainee, &cards, &levels, &req);

    let mut session = CareerSession::new(req, initial_state.clone());
    let session_id = session.id;

    tracing::info!("Created career session {}", session_id);

    let mut rng = rand::rngs::StdRng::seed_from_u64(engine::spark_seed(session_id, 0));
    let spark = engine::build_career_start_spark_event(
        session.config.legacy.as_ref(),
        &initial_state.inheritance_stats,
        &initial_state.aptitudes,
        &mut rng,
    );
    let record = engine::apply_event(&session, spark);
    session.push_event(record);

    session.append_pending_turn_slots();

    let timeline: Vec<TimelineEntrySummary> = session
        .timeline
        .iter()
        .enumerate()
        .map(|(idx, entry)| timeline_entry_summary(idx, entry))
        .collect();

    let current_snapshot = session.latest_snapshot().clone();

    let turn_phases: Vec<TurnPhaseInfo> = session
        .config
        .scenario
        .turn_phase_labels()
        .into_iter()
        .map(|(label, start, end)| TurnPhaseInfo {
            label: label.to_string(),
            start_turn: start,
            end_turn: end,
        })
        .collect();

    // Store session
    let response = CareerCreateResponse {
        session_id,
        initial_snapshot: session.initial_snapshot.clone(),
        initial_state: session.initial_state.clone(),
        total_turns: session.total_turns(),
        timeline,
        turn_phases,
        current_snapshot,
    };

    state.career_sessions.lock().await.insert(session_id, session);

    Ok(Json(response))
}

#[derive(serde::Serialize)]
pub struct CareerCreateResponse {
    pub session_id: Uuid,
    pub initial_snapshot: TurnSnapshot,
    pub initial_state: CareerInitialState,
    pub total_turns: u32,
    /// Timeline includes the auto career-start Spark of Inspiration when the session is created.
    pub timeline: Vec<TimelineEntrySummary>,
    /// Scenario UI sections (Pre-debut / Regular / Climax for Trackblazer, etc.).
    #[serde(default)]
    pub turn_phases: Vec<TurnPhaseInfo>,
    /// State after the last timeline entry (post–career-start spark).
    pub current_snapshot: TurnSnapshot,
}

#[derive(serde::Serialize)]
pub struct TurnPhaseInfo {
    pub label: String,
    pub start_turn: u32,
    pub end_turn: u32,
}

/// POST /api/career/:id/preview — preview what would happen this turn.
///
/// Requires the current card placements (observed from the game).
/// Returns training previews for all 5 facilities + pre-turn events.
pub async fn career_preview(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(session_id): axum::extract::Path<Uuid>,
    Json(req): Json<CareerPreviewRequest>,
) -> Result<Json<engine::TurnPreview>, (StatusCode, String)> {
    let sessions = state.career_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    if session.is_complete() {
        return Err((StatusCode::BAD_REQUEST, "Career is already complete".to_string()));
    }

    // Resolve deck cards
    let mut cards: Vec<&SupportCard> = Vec::new();
    let mut levels: Vec<i32> = Vec::new();
    for &(card_id, level) in &session.config.deck {
        let idx = state
            .card_index
            .get(&card_id)
            .ok_or((StatusCode::NOT_FOUND, format!("Card {} not found", card_id)))?;
        cards.push(&state.cards[*idx]);
        levels.push(level);
    }

    let trainee_idx = state
        .trainee_index
        .get(&session.config.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, "Trainee not found".to_string()))?;
    let trainee = &state.trainees[*trainee_idx];

    let preview = engine::preview_turn(session, &req.card_placements, &cards, &levels, trainee);

    Ok(Json(preview))
}

#[derive(serde::Deserialize)]
pub struct CareerPreviewRequest {
    /// Where each of the 6 support cards is placed (facility 0–4, or 5=away).
    pub card_placements: [usize; 6],
}

/// POST /api/career/:id/event — submit a game event (Spark of Inspiration, New Year, etc.)
///
/// Events are first-class timeline entries. The frontend should submit events
/// that fire before a turn BEFORE submitting the turn action itself.
pub async fn career_event(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(session_id): axum::extract::Path<Uuid>,
    Json(req): Json<CareerEventRequest>,
) -> Result<Json<CareerEventResponse>, (StatusCode, String)> {
    let mut sessions = state.career_sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    let record = engine::apply_event(session, req.event);
    let state_after = record.state_after.clone();
    let event_label = record.event.label();
    let timeline_index = session.insert_event_before_first_pending(record);

    Ok(Json(CareerEventResponse {
        timeline_index,
        event_label,
        state_after,
    }))
}

#[derive(serde::Deserialize)]
pub struct CareerEventRequest {
    pub event: crate::models::session::GameEvent,
}

#[derive(serde::Serialize)]
pub struct CareerEventResponse {
    pub timeline_index: usize,
    pub event_label: String,
    pub state_after: TurnSnapshot,
}

/// POST /api/career/:id/advance — execute a turn action.
///
/// Events should be submitted separately via /event BEFORE calling this.
/// This endpoint only handles the player's chosen action for the turn.
pub async fn career_advance(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(session_id): axum::extract::Path<Uuid>,
    Json(req): Json<CareerAdvanceRequest>,
) -> Result<Json<CareerAdvanceResponse>, (StatusCode, String)> {
    let mut sessions = state.career_sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    if session.is_complete() {
        return Err((StatusCode::BAD_REQUEST, "Career is already complete".to_string()));
    }

    // Resolve deck cards
    let mut cards: Vec<&SupportCard> = Vec::new();
    let mut levels: Vec<i32> = Vec::new();
    for &(card_id, level) in &session.config.deck {
        let idx = state
            .card_index
            .get(&card_id)
            .ok_or((StatusCode::NOT_FOUND, format!("Card {} not found", card_id)))?;
        cards.push(&state.cards[*idx]);
        levels.push(level);
    }

    let trainee_idx = state
        .trainee_index
        .get(&session.config.trainee_id)
        .ok_or((StatusCode::NOT_FOUND, "Trainee not found".to_string()))?;
    let trainee = &state.trainees[*trainee_idx];

    if session.first_pending_index().is_none() {
        return Err((StatusCode::BAD_REQUEST, "No pending turn to advance".to_string()));
    }

    let record = engine::execute_turn(
        session,
        req.action,
        req.card_placements,
        &cards,
        &levels,
        trainee,
        req.training_failed.unwrap_or(false),
        req.rest_energy,
    );

    let turn_number = record.turn_number;
    let state_after = record.state_after.clone();
    let timeline_index = session
        .replace_first_pending_turn(record)
        .ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to replace pending turn".to_string(),
        ))?;

    let is_complete = session.is_complete();
    let next_turn = session.current_turn();

    Ok(Json(CareerAdvanceResponse {
        turn_number,
        state_after,
        is_complete,
        next_turn,
        timeline_index,
    }))
}

#[derive(serde::Deserialize)]
pub struct CareerAdvanceRequest {
    pub action: crate::models::session::TurnAction,
    pub card_placements: [usize; 6],
    /// Did the training fail? (Player reports this from the game.)
    #[serde(default)]
    pub training_failed: Option<bool>,
    /// How much energy was recovered from rest? (Player reports this.)
    pub rest_energy: Option<f64>,
}

#[derive(serde::Serialize)]
pub struct CareerAdvanceResponse {
    pub turn_number: u32,
    pub state_after: TurnSnapshot,
    pub is_complete: bool,
    pub next_turn: u32,
    pub timeline_index: usize,
}

/// GET /api/career/:id/state — get the current state or state at a specific timeline index.
///
/// Query params: ?index=N (optional, defaults to latest)
pub async fn career_state(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(session_id): axum::extract::Path<Uuid>,
    axum::extract::Query(params): axum::extract::Query<CareerStateQuery>,
) -> Result<Json<CareerStateResponse>, (StatusCode, String)> {
    let sessions = state.career_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    let (snapshot, previous_snapshot) = if let Some(idx) = params.index {
        let snap = session.snapshot_at(Some(idx as usize)).clone();
        // Previous snapshot: one index back, or initial_snapshot for index 0
        let prev = if idx == 0 {
            Some(session.initial_snapshot.clone())
        } else {
            Some(session.snapshot_at(Some((idx - 1) as usize)).clone())
        };
        (snap, prev)
    } else {
        (session.latest_snapshot().clone(), None)
    };

    Ok(Json(CareerStateResponse {
        session_id,
        current_turn: session.current_turn(),
        total_turns: session.total_turns(),
        is_complete: session.is_complete(),
        snapshot,
        previous_snapshot,
        timeline_length: session.timeline_len() as u32,
    }))
}

#[derive(serde::Deserialize)]
pub struct CareerStateQuery {
    pub index: Option<u32>,
}

#[derive(serde::Serialize)]
pub struct CareerStateResponse {
    pub session_id: Uuid,
    pub current_turn: u32,
    pub total_turns: u32,
    pub is_complete: bool,
    pub snapshot: TurnSnapshot,
    /// The snapshot immediately before this entry (for computing deltas).
    /// Present when a specific index was requested; None for "latest" queries.
    pub previous_snapshot: Option<TurnSnapshot>,
    pub timeline_length: u32,
}

/// GET /api/career/:id/timeline — get the full timeline for the rollback bar.
///
/// Returns a summary of each entry (turns and events) for efficient rendering.
pub async fn career_timeline(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(session_id): axum::extract::Path<Uuid>,
) -> Result<Json<Vec<TimelineEntrySummary>>, (StatusCode, String)> {
    let sessions = state.career_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    let summaries: Vec<TimelineEntrySummary> = session
        .timeline
        .iter()
        .enumerate()
        .map(|(idx, entry)| timeline_entry_summary(idx, entry))
        .collect();

    Ok(Json(summaries))
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimelineEntryDetail {
    Training {
        detail: TrainingDetail,
    },
    SparkOfInspiration {
        phase: crate::models::session::SparkPhase,
        stat_gains: [f64; 5],
        sp_gained: f64,
        hint_deltas: Vec<crate::models::session::SparkHintDelta>,
        aptitude_deltas: Vec<crate::models::session::AptitudeDelta>,
    },
    NewYear {
        energy_gained: f64,
        sp_gained: f64,
    },
    SummerCampStart,
    BuySkill {
        skill_id: u32,
        name: String,
        level: u8,
        sp_cost: f64,
    },
    AcquireItem {
        item_id: u32,
        name: String,
        quantity: u8,
    },
    CustomEvent {
        description: String,
        stat_gains: Option<[f64; 5]>,
        sp_gained: Option<f64>,
        energy_gained: Option<f64>,
        mood_change: Option<i8>,
    },
}

#[derive(serde::Serialize)]
pub struct TimelineEntrySummary {
    pub index: usize,
    pub kind: String,        // "turn" or "event"
    pub turn_number: Option<u32>,
    pub calendar_label: String,
    pub entry_type: String,  // e.g. "train_speed", "rest", "Spark of Inspiration", "New Year"
    pub color: Option<String>,
    pub stats_total: f64,
    pub energy: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<TimelineEntryDetail>,
}

fn turn_entry_type(action: &TurnAction) -> String {
    match action {
        TurnAction::Pending => "pending".to_string(),
        TurnAction::Train { facility } => {
            format!("train_{}", ["speed", "stamina", "power", "guts", "wisdom"][*facility])
        }
        TurnAction::Rest => "rest".to_string(),
        TurnAction::Race { .. } => "race".to_string(),
        TurnAction::Infirmary => "infirmary".to_string(),
        TurnAction::Recreation => "recreation".to_string(),
    }
}

fn detail_for_game_event(ev: &GameEvent) -> TimelineEntryDetail {
    match ev {
        GameEvent::SparkOfInspiration {
            phase,
            stat_gains,
            sp_gained,
            hint_deltas,
            aptitude_deltas,
        } => TimelineEntryDetail::SparkOfInspiration {
            phase: *phase,
            stat_gains: *stat_gains,
            sp_gained: *sp_gained,
            hint_deltas: hint_deltas.clone(),
            aptitude_deltas: aptitude_deltas.clone(),
        },
        GameEvent::NewYear {
            energy_gained,
            sp_gained,
        } => TimelineEntryDetail::NewYear {
            energy_gained: *energy_gained,
            sp_gained: *sp_gained,
        },
        GameEvent::SummerCampStart => TimelineEntryDetail::SummerCampStart,
        GameEvent::BuySkill { skill_id, name, level, sp_cost } => TimelineEntryDetail::BuySkill {
            skill_id: *skill_id,
            name: name.clone(),
            level: *level,
            sp_cost: *sp_cost,
        },
        GameEvent::AcquireItem { item_id, name, quantity } => TimelineEntryDetail::AcquireItem {
            item_id: *item_id,
            name: name.clone(),
            quantity: *quantity,
        },
        GameEvent::CustomEvent {
            description,
            stat_gains,
            sp_gained,
            energy_gained,
            mood_change,
        } => TimelineEntryDetail::CustomEvent {
            description: description.clone(),
            stat_gains: *stat_gains,
            sp_gained: *sp_gained,
            energy_gained: *energy_gained,
            mood_change: *mood_change,
        },
    }
}

fn detail_for_timeline_entry(entry: &TimelineEntry) -> Option<TimelineEntryDetail> {
    match entry {
        TimelineEntry::Turn(r) => r
            .training_detail
            .as_ref()
            .map(|d| TimelineEntryDetail::Training { detail: d.clone() }),
        TimelineEntry::Event(e) => Some(detail_for_game_event(&e.event)),
    }
}

fn timeline_entry_summary(idx: usize, entry: &TimelineEntry) -> TimelineEntrySummary {
    let detail = detail_for_timeline_entry(entry);
    match entry {
        TimelineEntry::Turn(r) => TimelineEntrySummary {
            index: idx,
            kind: "turn".to_string(),
            turn_number: Some(r.turn_number),
            calendar_label: r.calendar.label(),
            entry_type: turn_entry_type(&r.action),
            color: if matches!(r.action, TurnAction::Pending) {
                Some("#3f3f46".to_string())
            } else {
                None
            },
            stats_total: r.state_after.stats.total(),
            energy: r.state_after.energy,
            detail,
        },
        TimelineEntry::Event(e) => TimelineEntrySummary {
            index: idx,
            kind: "event".to_string(),
            turn_number: None,
            calendar_label: e.calendar.label(),
            entry_type: e.event.label(),
            color: Some(e.event.color().to_string()),
            stats_total: e.state_after.stats.total(),
            energy: e.state_after.energy,
            detail,
        },
    }
}

/// Health check
pub async fn health() -> &'static str {
    "ok"
}