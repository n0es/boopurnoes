use serde::{Deserialize, Serialize};
use super::deck::DeckScore;

/// Identifier for which algorithm to use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AlgorithmId {
    /// Deterministic expected-value scorer. Fast, no randomness.
    ExpectedValue,
    /// Monte Carlo simulation scorer. Slower, more accurate.
    MonteCarlo,
}

impl std::fmt::Display for AlgorithmId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ExpectedValue => write!(f, "expected_value"),
            Self::MonteCarlo => write!(f, "monte_carlo"),
        }
    }
}

/// Scenario-specific configuration that affects scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioConfig {
    /// Which scenario: "default", "trackblazer", "beyond_dreams"
    #[serde(default = "default_scenario")]
    pub scenario: String,

    /// Target race distance: "short", "mile", "mid", "long"
    #[serde(default = "default_distance")]
    pub target_distance: String,

    /// Target running strategy: "leading", "stalking", "mid_pack", "chasing"
    #[serde(default = "default_strategy")]
    pub target_strategy: String,

    /// Number of simulation turns (default 72).
    #[serde(default = "default_turns")]
    pub turns: u32,

    /// Stat caps: [speed, stamina, power, guts, wisdom].
    /// Beyond Dreams raises speed to 2100, wisdom to 1800, others to 1700.
    #[serde(default = "default_stat_caps")]
    pub stat_caps: [f64; 5],

    /// Minimum stamina threshold. If None, auto-calculated from distance + strategy.
    pub min_stamina: Option<f64>,

    /// Minimum Race Bonus threshold (e.g. 0.35 for Trackblazer).
    #[serde(default)]
    pub min_race_bonus: Option<f64>,

    /// Stat weights for scoring: how important is each stat.
    /// Default [1, 1, 1, 0.8, 0.8] (speed/stamina/power weighted equally, guts/wisdom slightly less).
    #[serde(default = "default_stat_weights")]
    pub stat_weights: [f64; 5],
}

fn default_scenario() -> String { "default".to_string() }
fn default_distance() -> String { "mid".to_string() }
fn default_strategy() -> String { "stalking".to_string() }
fn default_turns() -> u32 { 72 }
fn default_stat_caps() -> [f64; 5] { [1200.0, 1200.0, 1200.0, 1200.0, 1200.0] }
fn default_stat_weights() -> [f64; 5] { [1.0, 1.0, 1.0, 0.8, 0.8] }

impl Default for ScenarioConfig {
    fn default() -> Self {
        Self {
            scenario: default_scenario(),
            target_distance: default_distance(),
            target_strategy: default_strategy(),
            turns: default_turns(),
            stat_caps: default_stat_caps(),
            min_stamina: None,
            min_race_bonus: None,
            stat_weights: default_stat_weights(),
        }
    }
}

impl ScenarioConfig {
    /// Build config for the Beyond Dreams scenario.
    pub fn beyond_dreams() -> Self {
        Self {
            scenario: "beyond_dreams".to_string(),
            stat_caps: [2100.0, 1700.0, 1700.0, 1700.0, 1800.0],
            ..Default::default()
        }
    }

    /// Build config for the Trackblazer scenario.
    pub fn trackblazer() -> Self {
        Self {
            scenario: "trackblazer".to_string(),
            min_race_bonus: Some(0.35),
            ..Default::default()
        }
    }

    /// HP modifier for the target strategy.
    pub fn strategy_hp_modifier(&self) -> f64 {
        match self.target_strategy.as_str() {
            "leading" | "runner" => 0.95,
            "stalking" | "leader" => 0.89,
            "mid_pack" | "betweener" => 1.00,
            "chasing" | "chaser" => 0.995,
            _ => 1.00,
        }
    }

    /// Auto-calculate minimum stamina from distance + strategy if not explicitly set.
    pub fn effective_min_stamina(&self) -> f64 {
        if let Some(s) = self.min_stamina {
            return s;
        }
        // Base distance in meters (approximate)
        let distance_m = match self.target_distance.as_str() {
            "short" | "sprint" => 1200.0,
            "mile" => 1600.0,
            "mid" | "medium" => 2000.0,
            "long" => 2500.0,
            _ => 2000.0,
        };
        // Rough stamina requirement: distance * modifier * scaling factor
        let hp_modifier = self.strategy_hp_modifier();
        // Simplified estimation: ~0.38 stamina per meter needed, adjusted by strategy
        (distance_m * 0.38 * hp_modifier).ceil()
    }
}

/// Request body for the optimize endpoint.
#[derive(Debug, Deserialize)]
pub struct OptimizeRequest {
    /// Trainee ID to optimize for.
    pub trainee_id: i32,

    /// Which algorithm to use.
    pub algorithm: AlgorithmId,

    /// Scenario and scoring configuration.
    #[serde(default)]
    pub config: ScenarioConfig,

    /// Optional: restrict to only cards the user owns.
    /// Map of card_id -> (level, uncap_tier).
    pub owned_cards: Option<Vec<OwnedCard>>,

    /// Optional: lock specific cards into the deck (they won't be swapped out).
    #[serde(default)]
    pub locked_cards: Vec<LockedCard>,

    /// Genetic algorithm parameters.
    #[serde(default)]
    pub search_params: SearchParams,
}

#[derive(Debug, Deserialize)]
pub struct OwnedCard {
    pub card_id: i32,
    pub level: i32,
    pub uncap: u8,
}

#[derive(Debug, Deserialize)]
pub struct LockedCard {
    pub card_id: i32,
    pub level: i32,
}

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    /// Population size for the genetic algorithm.
    #[serde(default = "default_pop_size")]
    pub population_size: usize,
    /// Number of generations to evolve.
    #[serde(default = "default_generations")]
    pub generations: usize,
    /// Mutation rate (0.0 - 1.0).
    #[serde(default = "default_mutation_rate")]
    pub mutation_rate: f64,
    /// Number of top results to return.
    #[serde(default = "default_top_n")]
    pub top_n: usize,
}

fn default_pop_size() -> usize { 200 }
fn default_generations() -> usize { 500 }
fn default_mutation_rate() -> f64 { 0.15 }
fn default_top_n() -> usize { 5 }

impl Default for SearchParams {
    fn default() -> Self {
        Self {
            population_size: default_pop_size(),
            generations: default_generations(),
            mutation_rate: default_mutation_rate(),
            top_n: default_top_n(),
        }
    }
}

/// Response body for the optimize endpoint.
#[derive(Debug, Serialize)]
pub struct OptimizeResponse {
    /// The top N deck configurations found.
    pub results: Vec<DeckScore>,
    /// Which algorithm was used.
    pub algorithm: String,
    /// How long the optimization took.
    pub elapsed_ms: u64,
    /// Search metadata.
    pub search_info: SearchInfo,
}

#[derive(Debug, Serialize)]
pub struct SearchInfo {
    pub generations_run: usize,
    pub population_size: usize,
    pub total_decks_evaluated: usize,
    pub cards_in_pool: usize,
}
