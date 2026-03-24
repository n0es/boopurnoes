use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use crate::algorithms::{ExpectedValueOptimizer, GeneticSearch, Optimizer};
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
        }
    }

    fn get_optimizer(&self, algorithm: &AlgorithmId) -> Box<dyn Optimizer> {
        match algorithm {
            AlgorithmId::ExpectedValue => Box::new(ExpectedValueOptimizer::new()),
            AlgorithmId::MonteCarlo => {
                // TODO: implement Monte Carlo optimizer
                // For now, fall back to EV
                Box::new(ExpectedValueOptimizer::new())
            }
        }
    }
}

/// GET /api/algorithms — list available algorithms.
pub async fn list_algorithms() -> Json<Vec<AlgorithmInfo>> {
    Json(vec![
        AlgorithmInfo {
            id: "expected_value".into(),
            name: "Expected Value".into(),
            description: "Deterministic scoring using exact training formulas. \
                Fast and consistent — no randomness.".into(),
            status: "stable".into(),
        },
        AlgorithmInfo {
            id: "monte_carlo".into(),
            name: "Monte Carlo".into(),
            description: "Stochastic simulation of thousands of 72-turn career runs. \
                More accurate but slower.".into(),
            status: "coming_soon".into(),
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

/// POST /api/optimize — run deck optimization.
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
        &req.config,
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
    let score = optimizer.score_deck(trainee, &cards, &levels, &req.config);

    Ok(Json(score))
}

#[derive(serde::Deserialize)]
pub struct ScoreDeckRequest {
    pub trainee_id: i32,
    pub algorithm: AlgorithmId,
    #[serde(default)]
    pub config: ScenarioConfig,
    /// Array of (card_id, level) tuples.
    pub deck: Vec<(i32, i32)>,
}

/// GET /health
pub async fn health() -> &'static str {
    "ok"
}
