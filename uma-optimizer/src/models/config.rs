use serde::{Deserialize, Serialize};
use super::deck::DeckScore;

// ─── Legacy / Inheritance Configuration ──────────────────────────────────────

/// A single factor (spark) on a legacy member.
/// E.g. "Stamina 3x" = BlueStat { stat_index: 1, stars: 3 }
/// E.g. "Corner Adept 3x" = SkillHint { skill_id: ..., stars: 3 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Factor {
    /// Blue factor: flat stat bonus. stat_index: 0=spd,1=sta,2=pow,3=gut,4=wit
    BlueStat {
        #[serde(alias = "statIndex")]
        stat_index: usize,
        stars: u8,
    },
    /// Green factor: unique skill hint
    UniqueSkill { skill_id: u32, stars: u8 },
    /// White factor: normal skill hint
    SkillHint { skill_id: u32, stars: u8 },
    /// White factor: race bonus (e.g. "Arima Kinen 2x")
    RaceBonus { race_name: String, stars: u8 },
    /// White factor: aptitude bonus (e.g. "Turf 3x", "Long 2x")
    Aptitude { apt_name: String, stars: u8 },
    /// White factor: scenario-specific
    Scenario { name: String, stars: u8 },
}

impl Factor {
    /// Fixed stat gain at career start for blue factors.
    /// 1★ = 5, 2★ = 12, 3★ = 21
    pub fn initial_stat_gain(stars: u8) -> f64 {
        match stars {
            1 => 5.0,
            2 => 12.0,
            3 => 21.0,
            _ => 0.0,
        }
    }

    /// Random stat gain range during Spark of Inspiration events.
    /// 1★ = 1..10, 2★ = 1..16, 3★ = 1..25
    pub fn spark_stat_range(stars: u8) -> (f64, f64) {
        match stars {
            1 => (1.0, 10.0),
            2 => (1.0, 16.0),
            3 => (1.0, 25.0),
            _ => (0.0, 0.0),
        }
    }

    /// Random hint levels gained from a skill factor spark.
    /// Returns (min, max) hint levels.
    pub fn spark_hint_range(stars: u8) -> (u8, u8) {
        match stars {
            1 => (0, 1),
            2 => (1, 2),
            3 => (1, 3),
            _ => (0, 0),
        }
    }
}

/// Affinity level between trainee and their legacies.
/// Affects probability of factor activation during mid-run inheritance.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AffinityLevel {
    /// △ — ~10% activation rate per factor
    Triangle,
    /// ○ — ~25% activation rate per factor
    Circle,
    /// ◎ — ~40% activation rate per factor
    DoubleCircle,
    /// ◎◎ — ~60%+ activation rate, 9 factor slots
    Max,
}

impl AffinityLevel {
    /// Probability that a single factor activates during a mid-run Spark event.
    pub fn activation_rate(&self) -> f64 {
        match self {
            AffinityLevel::Triangle => 0.10,
            AffinityLevel::Circle => 0.25,
            AffinityLevel::DoubleCircle => 0.40,
            AffinityLevel::Max => 0.60,
        }
    }
}

/// A single legacy member (parent or grandparent).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyMember {
    /// Name of the character used as legacy (for display purposes).
    pub name: String,
    /// All factors on this legacy member.
    pub factors: Vec<Factor>,
    /// Trainee–member succession compatibility (△ / ○ / ◎). Drives mid-run spark odds for
    /// this member's factors; if omitted, [`LegacyConfig::affinity`] is used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spark_affinity: Option<AffinityLevel>,
}

impl LegacyMember {
    /// Mid-run activation probability for factors on this member (not the initial spark).
    #[inline]
    pub fn midrun_spark_rate(&self, fallback: AffinityLevel) -> f64 {
        self.spark_affinity
            .unwrap_or(fallback)
            .activation_rate()
    }
}

/// One legacy slot: a parent plus their two grandparents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacySlot {
    pub parent: LegacyMember,
    pub grandparent_1: LegacyMember,
    pub grandparent_2: LegacyMember,
}

/// Full legacy configuration for a training run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyConfig {
    pub legacy_1: LegacySlot,
    pub legacy_2: LegacySlot,
    /// Affinity level (determines mid-run activation probability).
    #[serde(default = "default_affinity")]
    pub affinity: AffinityLevel,
}

fn default_affinity() -> AffinityLevel { AffinityLevel::Circle }

/// Normalize aptitude labels from the UI (e.g. "Turf", "芝") to stable map keys.
pub fn normalize_apt_key(apt_name: &str) -> String {
    apt_name.trim().to_lowercase().replace([' ', '-'], "_")
}

impl LegacyConfig {
    /// Collect all blue stat factors across the entire legacy tree.
    /// Returns Vec of (stat_index, stars, is_parent).
    /// Parents contribute fixed bonuses; all members contribute to spark rolls.
    pub fn all_blue_factors(&self) -> Vec<(usize, u8, bool)> {
        let mut factors = Vec::new();
        for slot in [&self.legacy_1, &self.legacy_2] {
            for (member, is_parent) in [
                (&slot.parent, true),
                (&slot.grandparent_1, false),
                (&slot.grandparent_2, false),
            ] {
                for factor in &member.factors {
                    if let Factor::BlueStat { stat_index, stars } = factor {
                        factors.push((*stat_index, *stars, is_parent));
                    }
                }
            }
        }
        factors
    }

    /// Collect all skill hint factors across the entire legacy tree.
    pub fn all_skill_factors(&self) -> Vec<(u32, u8)> {
        let mut factors = Vec::new();
        for slot in [&self.legacy_1, &self.legacy_2] {
            for member in [&slot.parent, &slot.grandparent_1, &slot.grandparent_2] {
                for factor in &member.factors {
                    match factor {
                        Factor::SkillHint { skill_id, stars }
                        | Factor::UniqueSkill { skill_id, stars } => {
                            factors.push((*skill_id, *stars));
                        }
                        _ => {}
                    }
                }
            }
        }
        factors
    }

    /// Blue factors for mid-run spark rolls with per-member activation probability.
    pub fn all_blue_spark_rolls(&self) -> Vec<(usize, u8, f64)> {
        let fb = self.affinity;
        let mut out = Vec::new();
        for slot in [&self.legacy_1, &self.legacy_2] {
            for member in [&slot.parent, &slot.grandparent_1, &slot.grandparent_2] {
                let rate = member.midrun_spark_rate(fb);
                for factor in &member.factors {
                    if let Factor::BlueStat { stat_index, stars } = factor {
                        out.push((*stat_index, *stars, rate));
                    }
                }
            }
        }
        out
    }

    /// Skill / unique factors for mid-run spark rolls with per-member activation probability.
    pub fn all_skill_spark_rolls(&self) -> Vec<(u32, u8, f64)> {
        let fb = self.affinity;
        let mut out = Vec::new();
        for slot in [&self.legacy_1, &self.legacy_2] {
            for member in [&slot.parent, &slot.grandparent_1, &slot.grandparent_2] {
                let rate = member.midrun_spark_rate(fb);
                for factor in &member.factors {
                    match factor {
                        Factor::SkillHint { skill_id, stars }
                        | Factor::UniqueSkill { skill_id, stars } => {
                            out.push((*skill_id, *stars, rate));
                        }
                        _ => {}
                    }
                }
            }
        }
        out
    }

    /// Red (aptitude) factors for mid-run Spark of Inspiration — activation rate per member.
    pub fn all_aptitude_spark_rolls(&self) -> Vec<(String, u8, f64)> {
        let fb = self.affinity;
        let mut out = Vec::new();
        for slot in [&self.legacy_1, &self.legacy_2] {
            for member in [&slot.parent, &slot.grandparent_1, &slot.grandparent_2] {
                let rate = member.midrun_spark_rate(fb);
                for factor in &member.factors {
                    if let Factor::Aptitude { apt_name, stars } = factor {
                        out.push((normalize_apt_key(apt_name), (*stars).min(3), rate));
                    }
                }
            }
        }
        out
    }

    /// Calculate the deterministic stat injection at career start.
    /// Only parent blue factors contribute fixed values.
    pub fn fixed_stat_injection(&self) -> [f64; 5] {
        let mut stats = [0.0; 5];
        for (stat_idx, stars, is_parent) in self.all_blue_factors() {
            if is_parent {
                stats[stat_idx] += Factor::initial_stat_gain(stars);
            }
        }
        stats
    }

    /// Calculate the deterministic stat injection from grandparents at career start.
    /// Grandparent blue factors also contribute fixed values.
    pub fn fixed_grandparent_injection(&self) -> [f64; 5] {
        let mut stats = [0.0; 5];
        for (stat_idx, stars, is_parent) in self.all_blue_factors() {
            if !is_parent {
                stats[stat_idx] += Factor::initial_stat_gain(stars);
            }
        }
        stats
    }
}

/// Identifier for which algorithm to use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AlgorithmId {
    /// Deterministic expected-value scorer. Fast, no randomness.
    ExpectedValue,
    /// V2 scorer: energy-aware with facility allocation and card events.
    ExpectedValueV2,
    /// Monte Carlo simulation scorer. Slower, more accurate.
    MonteCarlo,
    /// Monte Carlo simulation V2. More robust, better inheritance.
    MonteCarloV2,
}

impl std::fmt::Display for AlgorithmId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ExpectedValue => write!(f, "expected_value"),
            Self::ExpectedValueV2 => write!(f, "expected_value_v2"),
            Self::MonteCarlo => write!(f, "monte_carlo"),
            Self::MonteCarloV2 => write!(f, "monte_carlo_v2"),
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

    /// Star rank of the trainee (1-5). Determines starting stats.
    /// This is populated from the request's star_rank field before scoring.
    #[serde(default = "default_star_rank_config")]
    pub star_rank: u8,

    /// Awakening level of the trainee (1-5). Unlocks awakening skills.
    #[serde(default = "default_awakening_level_config")]
    pub awakening_level: u8,

    /// Legacy configuration (parents + grandparents with factors).
    /// Required for Monte Carlo v3 to model inheritance/spark mechanics.
    /// If None, inheritance bonuses are skipped.
    #[serde(default)]
    pub legacy: Option<LegacyConfig>,
}

fn default_scenario() -> String { "default".to_string() }
fn default_distance() -> String { "mid".to_string() }
fn default_strategy() -> String { "stalking".to_string() }
fn default_turns() -> u32 { 72 }
fn default_stat_caps() -> [f64; 5] { [1200.0, 1200.0, 1200.0, 1200.0, 1200.0] }
fn default_stat_weights() -> [f64; 5] { [1.0, 1.0, 1.0, 0.8, 0.8] }
fn default_star_rank_config() -> u8 { 5 }
fn default_awakening_level_config() -> u8 { 5 }

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
            star_rank: default_star_rank_config(),
            awakening_level: default_awakening_level_config(),
            legacy: None,
        }
    }
}

impl ScenarioConfig {
    pub fn unity_cup() -> Self {
        Self {
            scenario: "unity_cup".to_string(),
            stat_caps: [1200.0, 1200.0, 1200.0, 1200.0, 1200.0],
            ..Default::default()
        }
    }

    // /// Build config for the Trackblazer scenario.
    // pub fn trackblazer() -> Self {
    //     Self {
    //         scenario: "trackblazer".to_string(),
    //         min_race_bonus: Some(0.35),
    //         ..Default::default()
    //     }
    // }

    /// HP modifier for the target strategy.
    pub fn strategy_hp_modifier(&self) -> f64 {
        match self.target_strategy.as_str() {
            "leading" | "Front Runner" => 0.95,
            "stalking" | "Pace Chaser" => 0.89,
            "mid_pack" | "Late Surger" => 1.00,
            "chasing" | "End Closer" => 0.995,
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

    /// Star rank of the trainee (1-5). Determines starting stats.
    /// Defaults to 5 if not provided.
    #[serde(default = "default_star_rank")]
    pub star_rank: u8,

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
    // pub level: i32,
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

fn default_star_rank() -> u8 { 5 }
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
