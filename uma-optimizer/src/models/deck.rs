use serde::{Deserialize, Serialize};

/// The five primary stats.
pub const STAT_NAMES: [&str; 5] = ["Speed", "Stamina", "Power", "Guts", "Wisdom"];

/// A block of 5 stats: [speed, stamina, power, guts, wisdom].
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct StatBlock {
    pub speed: f64,
    pub stamina: f64,
    pub power: f64,
    pub guts: f64,
    pub wisdom: f64,
}

impl StatBlock {
    // pub fn as_array(&self) -> [f64; 5] {
    //     [self.speed, self.stamina, self.power, self.guts, self.wisdom]
    // }

    // pub fn from_array(a: [f64; 5]) -> Self {
    //     Self {
    //         speed: a[0],
    //         stamina: a[1],
    //         power: a[2],
    //         guts: a[3],
    //         wisdom: a[4],
    //     }
    // }

    pub fn total(&self) -> f64 {
        self.speed + self.stamina + self.power + self.guts + self.wisdom
    }

    // pub fn add(&self, other: &StatBlock) -> StatBlock {
    //     StatBlock {
    //         speed: self.speed + other.speed,
    //         stamina: self.stamina + other.stamina,
    //         power: self.power + other.power,
    //         guts: self.guts + other.guts,
    //         wisdom: self.wisdom + other.wisdom,
    //     }
    // }
}

impl std::ops::Index<usize> for StatBlock {
    type Output = f64;
    fn index(&self, i: usize) -> &f64 {
        match i {
            0 => &self.speed,
            1 => &self.stamina,
            2 => &self.power,
            3 => &self.guts,
            4 => &self.wisdom,
            _ => panic!("StatBlock index out of range: {i}"),
        }
    }
}

impl std::ops::IndexMut<usize> for StatBlock {
    fn index_mut(&mut self, i: usize) -> &mut f64 {
        match i {
            0 => &mut self.speed,
            1 => &mut self.stamina,
            2 => &mut self.power,
            3 => &mut self.guts,
            4 => &mut self.wisdom,
            _ => panic!("StatBlock index out of range: {i}"),
        }
    }
}

/// A deck of 6 support cards, each at a specific level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deck {
    /// (card_id, card_level) for each of the 6 slots.
    pub cards: Vec<(i32, i32)>,
}

impl Deck {
    // pub fn card_ids(&self) -> Vec<i32> {
    //     self.cards.iter().map(|(id, _)| *id).collect()
    // }
}

/// The result of scoring a deck.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckScore {
    /// The deck that was scored.
    pub deck: Deck,
    /// Projected terminal stats after a 72-turn simulation.
    pub projected_stats: StatBlock,
    /// Overall fitness score (higher = better).
    pub fitness: f64,
    /// Per-stat breakdown of where stats come from.
    pub stat_sources: StatSources,
    /// Any warnings (e.g. "stamina below race threshold").
    pub warnings: Vec<String>,
    /// Human-readable explanation of the score.
    pub explanation: Vec<String>,
}

/// Breakdown of stat contributions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatSources {
    pub initial_stats: StatBlock,
    pub training_expected_value: StatBlock,
    pub race_bonus_stats: StatBlock,
}

/// Represents the state of a single training run at a specific turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunState {
    pub turn: u32,
    pub stats: StatBlock,
    pub energy: f64,
    pub mood: u8,
    pub friendship: Vec<f64>,
    pub facility_levels: Vec<u32>,
    pub facility_trains: Vec<u32>,
    pub skill_points: f64,
    /// Observed card placements for this turn (index = card slot, value = facility 0-4, or -1 = away).
    /// When provided, simulate_turn uses these fixed placements instead of random rolling,
    /// giving exact expected gains for the actual configuration the player sees in-game.
    #[serde(default)]
    pub card_placements: Vec<i32>,
    /// Per-slot unity bonus active this turn (Unity Cup only). Index matches card slot.
    #[serde(default)]
    pub unity_bonus_cards: Vec<bool>,
    /// Per-slot hint active this turn (card showing ! icon). Index matches card slot.
    #[serde(default)]
    pub hint_cards: Vec<bool>,
}

/// The result of simulating a single turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnResult {
    pub state: RunState,
    pub expected_gains: Vec<StatBlock>, // Total Gains for each of the 5 facilities
    pub expected_energy_costs: Vec<f64>,
    pub failure_rates: Vec<f64>,
    /// Optional breakdowns for display in UI when card placements are fixed.
    #[serde(default)]
    pub base_gains: Option<Vec<StatBlock>>,
    #[serde(default)]
    pub special_gains: Option<Vec<StatBlock>>,
    #[serde(default)]
    pub base_sp_gains: Option<Vec<f64>>,
    #[serde(default)]
    pub special_sp_gains: Option<Vec<f64>>,
    /// Composite score per facility accounting for stats, SP, friendship, and hints.
    /// Frontend should use this (not raw stats) to highlight the best facility.
    #[serde(default)]
    pub facility_scores: Vec<f64>,
}
