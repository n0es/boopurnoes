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
            stat_growth: t.stat_growth.clone(),
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

/// GET /health
pub async fn health() -> &'static str {
    "ok"
}
