use rand::distributions::{Distribution, WeightedIndex};
use rand::prelude::*;
use rayon::prelude::*;
use std::collections::HashMap;

use crate::models::*;
use crate::algorithms::traits::Optimizer;

// ─── Simulation Tuning Constants ─────────────────────────────────────────────

const NUM_SIMULATIONS: i32 = 10_000;

// Energy
const MAX_ENERGY: f64 = 100.0;
const STARTING_ENERGY: f64 = 100.0;
const SUMMER_REST_ENERGY_GAIN: f64 = 35.0;

// Mood levels: 0=Very Bad, 1=Bad, 2=Normal, 3=Good, 4=Very Good
const MOOD_MULTIPLIERS: [f64; 5] = [0.80, 0.90, 1.00, 1.10, 1.20];
const STARTING_MOOD: u8 = 2; // Normal (1.0)

// Friendship
const FRIENDSHIP_THRESHOLD: f64 = 80.0;
const FRIENDSHIP_GAIN_PER_TRAIN: f64 = 7.0;
const MAX_FRIENDSHIP: f64 = 100.0;

// Spirit (Unity Cup / Great Tracen Festival)
const SPIRIT_THRESHOLD: f64 = 100.0;
const SPIRIT_GAIN_PER_TRAIN: f64 = 7.0;
const MAX_SPIRIT: f64 = 100.0;

// Card placement weights
const BASE_FACILITY_WEIGHT: f64 = 100.0;
const VACATION_WEIGHT: f64 = 50.0;

// Facility base stats by level — datamined values.
// Format: [speed, stamina, power, guts, wisdom, SP, energy_cost]
// Negative energy = cost, positive = recovery.
// Indexed as FACILITY_DATA[level-1][facility_idx]
// Base training gains per facility per level. Format: [speed, stamina, power, guts, wisdom, SP, energy]
// Calibrated for Unity Cup (Aoharu Hai) - Global Server.
// Training Level is determined by Team Stat Rank (G/F=Lv1, E/D=Lv2, C/B=Lv3, A=Lv4, S=Lv5).
const FACILITY_DATA: [[[f64; 7]; 5]; 5] = [
    // Level 1 (Team Rank G/F)
    [
        [ 8.0, 0.0, 4.0, 0.0, 0.0,  2.0, -19.0], // Speed
        [ 0.0, 7.0, 0.0, 3.0, 0.0,  2.0, -17.0], // Stamina
        [ 0.0, 4.0, 6.0, 0.0, 0.0,  2.0, -18.0], // Power
        [ 3.0, 0.0, 3.0, 6.0, 0.0,  2.0, -20.0], // Guts
        [ 2.0, 0.0, 0.0, 0.0, 6.0,  3.0,   5.0], // Wisdom
    ],
    // Level 2 (Team Rank E/D)
    [
        [10.0, 0.0, 5.0, 0.0, 0.0,  2.0, -20.0],
        [ 0.0, 9.0, 0.0, 4.0, 0.0,  2.0, -18.0],
        [ 0.0, 5.0, 8.0, 0.0, 0.0,  2.0, -19.0],
        [ 3.0, 0.0, 3.0, 8.0, 0.0,  2.0, -21.0],
        [ 2.0, 0.0, 0.0, 0.0, 7.0,  3.0,   5.0],
    ],
    // Level 3 (Team Rank C/B)
    [
        [12.0, 0.0, 6.0, 0.0, 0.0,  2.0, -21.0],
        [ 0.0,11.0, 0.0, 5.0, 0.0,  2.0, -19.0],
        [ 0.0, 6.0,10.0, 0.0, 0.0,  2.0, -20.0],
        [ 4.0, 0.0, 4.0,10.0, 0.0,  2.0, -22.0],
        [ 3.0, 0.0, 0.0, 0.0, 8.0,  3.0,   5.0],
    ],
    // Level 4 (Team Rank A)
    [
        [14.0, 0.0, 7.0, 0.0, 0.0,  2.0, -23.0],
        [ 0.0,13.0, 0.0, 6.0, 0.0,  2.0, -21.0],
        [ 0.0, 7.0,12.0, 0.0, 0.0,  2.0, -22.0],
        [ 5.0, 0.0, 5.0,12.0, 0.0,  2.0, -24.0],
        [ 4.0, 0.0, 0.0, 0.0, 9.0,  3.0,   5.0],
    ],
    // Level 5 (Team Rank S)
    [
        [16.0, 0.0, 8.0, 0.0, 0.0,  2.0, -25.0],
        [ 0.0,15.0, 0.0, 7.0, 0.0,  2.0, -23.0],
        [ 0.0, 8.0,14.0, 0.0, 0.0,  2.0, -24.0],
        [ 6.0, 0.0, 6.0,14.0, 0.0,  2.0, -26.0],
        [ 5.0, 0.0, 0.0, 0.0,10.0,  3.0,   5.0],
    ],
];

// Rest recovery probability distribution
// (probability, energy_gained, gains_night_owl_condition)
const REST_OUTCOMES: [(f64, f64, bool); 4] = [
    (0.255, 70.0, false),
    (0.580, 50.0, false),
    (0.130, 30.0, false),
    (0.035, 30.0, true), // Night Owl condition
];

// Facility levels up every N trains at that facility
const TRAINS_PER_FACILITY_LEVEL: u32 = 4;
const MAX_FACILITY_LEVEL: u32 = 5;

// SP gains
const INTRO_EVENT_SP: f64 = 120.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Location {
    Sapporo, 
    Hakodate, 
    Niigata, 
    Fukushima,
    Nakayama,
    Tokyo,
    Chukyo,
    Kyoto,
    Hanshin,
    Kokura,
    Ooi,
    Kawasaki,
    Funabashi,
    Morioka,
    Longchamp,
    SantaAnitaPark,
    DelMar,
}

// ─── Calendar System ─────────────────────────────────────────────────────────

/// The three years of a training career.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Year {
    Junior,   // Year 1
    Classic,  // Year 2
    Senior,   // Year 3
}

/// Which half of a month a turn falls on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Half {
    First,  // 1st-15th
    Second, // 16th-end
}

/// A specific turn mapped to its calendar position.
#[derive(Debug, Clone, Copy)]
struct CalendarTurn {
    turn: u32,      // 0-indexed turn number
    year: Year,
    month: u8,      // 1-12
    half: Half,
}

impl CalendarTurn {
    /// Convert a 0-indexed turn number into a calendar position.
    /// Junior year starts in December (2 turns), then Jan-Nov of years 1-3.
    ///
    /// Turn layout (0-indexed):
    ///   0-1:   Junior Dec (first/second half)
    ///   2-23:  Junior Jan-Oct (but the game actually starts later...)
    ///
    /// Actually, the standard Uma Musume calendar:
    ///   Junior:  Turns 0-23  (Dec Y0 through Nov Y1) — 24 turns
    ///   Classic: Turns 24-47 (Dec Y1 through Nov Y2) — 24 turns
    ///   Senior:  Turns 48-71 (Dec Y2 through Nov Y3) — 24 turns
    ///
    /// Each year: Dec(2) + Jan(2) + Feb(2) + ... + Nov(2) = 12 months × 2 = 24 turns
    fn from_turn(turn: u32) -> Self {
        let year_idx = turn / 24;
        let turn_in_year = turn % 24;

        let year = match year_idx {
            0 => Year::Junior,
            1 => Year::Classic,
            2 => Year::Senior,
            _ => Year::Senior,
        };

        // Month mapping within a year: starts at December
        // turn_in_year 0-1 = December, 2-3 = January, ..., 22-23 = November
        let month_offset = turn_in_year / 2;
        let month = if month_offset == 0 {
            12 // December
        } else {
            month_offset as u8 // 1=Jan, 2=Feb, ..., 11=Nov
        };

        let half = if turn_in_year % 2 == 0 { Half::First } else { Half::Second };

        CalendarTurn { turn, year, month, half }
    }

    /// Is this turn during summer training camp? (July-August)
    fn is_summer_camp(&self) -> bool {
        // Summer camp happens in Classic and Senior years only
        (self.year == Year::Classic || self.year == Year::Senior)
            && (self.month == 7 || self.month == 8)
    }

    /// Is this an inheritance event turn? (First half of April, Classic and Senior)
    fn is_inheritance_event(&self) -> bool {
        (self.year == Year::Classic || self.year == Year::Senior)
            && self.month == 4
            && self.half == Half::First
    }

    /// Is this a New Year event turn? (First half of January)
    fn is_new_year_event(&self) -> bool {
        self.month == 1 && self.half == Half::First
    }
}

// ─── Turn Actions ────────────────────────────────────────────────────────────

/// The possible actions a player can take each turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TurnAction {
    Train(usize),   // Train at facility index 0-4
    Rest,
    Race,
    Infirmary,
    Recreation,
    SkillPurchase,  // Doesn't end the turn (mid-turn action)
}

// ─── Conditions ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Condition {
    Charming,
    FastLearner,
    PracticePerfect,
    PracticePerfectEx,
    HotTopic,
    ShiningBrightly,
    FanPromise(Location),
    PositiveThinking,
    LuckyConstitution,
    PracticePoor,
    Migraine,
    SkinOutbreak,
    NightOwl,
    SlowMetabolism,
    Slacker,
    UnderTheWeather,
    NotReady,
    LegsOfGlass,
}

// ─── Simulation State ────────────────────────────────────────────────────────

/// Full mutable state for a single 72-turn simulation run.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SimState {
    // --- Core stats ---
    pub stats: [f64; 5],           // [speed, stamina, power, guts, wisdom]
    pub skill_points: f64,

    // --- Energy & Mood ---
    pub energy: f64,
    pub mood: u8,                  // 0-4 index into MOOD_MULTIPLIERS

    // --- Support card state ---
    pub friendship: [f64; 6],      // Friendship gauge per card (0-100)
    pub spirit: [f64; 6],          // Spirit gauge per card (0-100) — Unity Cup scenario
    pub unity_bonuses: [bool; 6],  // Whether each card has a unity bonus active this turn

    // --- Facility state ---
    pub facility_levels: [u32; 5], // Current level of each facility (1-5)
    pub facility_trains: [u32; 5], // Number of times each facility has been trained

    // --- Skill hints ---
    /// Tracks hint levels acquired. Key = skill name/id, Value = hint level (1-5)
    pub hint_levels: HashMap<u32, u8>,

    // --- Conditions --- In Career Mode, Umamusume can acquire various Conditions that affect gameplay both positively and negatively. Positive conditions are displayed orange on the trainee's full stats screen, while negative conditions are displayed blue.
    // Positive conditions typically cannot be removed, with the exception of Practice Perfect ○, which is always removed upon the acquisition of Practice Poor. Negative conditions can be removed by visiting the Infirmary, getting the Shrine Visit during Recreation, or experiencing certain events with Hayakawa Tazuna (Tracen Reception) as a Support Card.
    pub conditions: Vec<Condition>,

    // --- Tracking ---
    pub total_fans: f64,
    pub races_run: u32,
}

impl SimState {
    pub fn new(
        initial_stats: [f64; 5],
        initial_friendship: &[f64],
        initial_sp: f64,
    ) -> Self {
        let mut friendship = [0.0; 6];
        for (i, &f) in initial_friendship.iter().enumerate().take(6) {
            friendship[i] = f;
        }

        SimState {
            stats: initial_stats,
            skill_points: initial_sp,
            energy: STARTING_ENERGY,
            mood: STARTING_MOOD,
            friendship,
            spirit: [0.0; 6],
            unity_bonuses: [false; 6],
            facility_levels: [1; 5],  // All facilities start at level 1
            facility_trains: [0; 5],
            hint_levels: HashMap::new(),
            conditions: Vec::new(),
            total_fans: 0.0,
            races_run: 0,
        }
    }

    pub fn has_condition(&self, condition: Condition) -> bool {
        self.conditions.contains(&condition)
    }

    pub fn mood_multiplier(&self) -> f64 {
        MOOD_MULTIPLIERS[self.mood as usize]
    }

    /// Increment facility train count and level up if threshold reached.
    pub fn record_facility_train(&mut self, facility: usize) {
        self.facility_trains[facility] += 1;
        let new_level = (self.facility_trains[facility] / TRAINS_PER_FACILITY_LEVEL) + 1;
        self.facility_levels[facility] = new_level.min(MAX_FACILITY_LEVEL);
    }

}


// ─── Training Calculation ────────────────────────────────────────────────────

/// Result of evaluating a training action at a facility.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrainingResult {
    pub stat_gains: [f64; 5],           // Total stat gains for each of the 5 stats
    pub sp_gain: f64,                   // Total skill points gained
    pub energy_cost: f64,               // Energy change (negative = cost, positive = recovery)
    pub base_stat_gains: [f64; 5],      // Base stat gains (before special training)
    pub base_sp_gain: f64,              // Base SP gain (before special training)
    pub special_stat_gains: [f64; 5],   // Special training stat bonuses
    pub special_sp_gain: f64,           // Special training SP bonus
}

/// Identifies if a card is scenario-linked for the Unity Cup (Grand Masters).
pub fn is_scenario_linked(card_name: &str) -> bool {
    let name = card_name.to_lowercase();
    name.contains("kitasan black") || 
    name.contains("satono diamond") || 
    name.contains("rice shower") || 
    name.contains("machikane tannhauser") || 
    name.contains("haru urara") || 
    name.contains("sweep tosho") || 
    name.contains("king halo") ||
    name.contains("mejiro ardan") ||
    name.contains("sakura chiyono o")
}

/// Returns the flat special training bonuses for a given facility and flame count.
/// Returns (stat_bonuses, sp_bonus).
pub fn get_special_training_bonus(
    facility_idx: usize, 
    flames: usize, 
    has_scenario_linked: bool
) -> ([f64; 5], f64) {
    let mut stats = [0.0; 5];
    let mut sp = 0.0;
    
    if flames < 2 {
        return (stats, sp);
    }
    
    // (primary, secondary, secondary_2, sp)
    let (p, s1, s2, b_sp) = match (facility_idx, flames) {
        // Speed/Stamina/Power
        (0..=2, 2) => (2.0, 0.0, 0.0, 0.0),
        (0..=2, 3) => (3.0, 1.0, 0.0, 1.0),
        (0..=2, 4) => (5.0, 2.0, 0.0, 2.0),
        (0..=2, 5) => (7.0, 3.0, 0.0, 3.0),
        
        // Guts
        (3, 2) => (2.0, 0.0, 0.0, 0.0),
        (3, 3) => (2.0, 1.0, 1.0, 1.0),
        (3, 4) => (4.0, 2.0, 1.0, 2.0),
        (3, 5) => (6.0, 2.0, 2.0, 3.0),
        
        // Wisdom
        (4, 2) => (1.0, 0.0, 0.0, 0.0),
        (4, 3) => (2.0, 0.0, 0.0, 1.0),
        (4, 4) => (3.0, 1.0, 0.0, 2.0),
        (4, 5) => (4.0, 2.0, 0.0, 3.0),
        
        _ => (0.0, 0.0, 0.0, 0.0),
    };
    
    let lb = if has_scenario_linked { 1.0 } else { 0.0 };
    
    match facility_idx {
        0 => { // Speed
            stats[0] = p + lb;
            if s1 > 0.0 { stats[2] = s1 + lb; } // Power secondary
        }
        1 => { // Stamina
            stats[1] = p + lb;
            if s1 > 0.0 { stats[3] = s1 + lb; } // Guts secondary
        }
        2 => { // Power
            stats[2] = p + lb;
            if s1 > 0.0 { stats[1] = s1 + lb; } // Stamina secondary
        }
        3 => { // Guts
            stats[3] = p + lb;
            if s1 > 0.0 { stats[0] = s1 + lb; } // Speed
            if s2 > 0.0 { stats[2] = s2 + lb; } // Power
        }
        4 => { // Wisdom
            stats[4] = p + lb;
            if s1 > 0.0 { stats[0] = s1 + lb; } // Speed
        }
        _ => {}
    }
    
    if b_sp > 0.0 {
        sp = b_sp + lb;
    }
    
    (stats, sp)
}

/// Calculates the full training result for a given facility this turn.
/// Uses datamined base values and applies the multiplier chain:
///   gain = (base + flat_bonuses) × mood × (1 + TE) × friendship_product × presence × growth
pub fn calculate_training_result(
    facility_idx: usize,
    card_locations: &[usize; 6],
    deck_cards: &[&SupportCard],
    deck_levels: &[i32],
    state: &SimState,
    trainee: &Trainee,
    is_summer_camp: bool,
    config: &ScenarioConfig,
) -> TrainingResult {
    // Effective facility level (summer camp forces level 5)
    let effective_level = if is_summer_camp {
        MAX_FACILITY_LEVEL
    } else {
        state.facility_levels[facility_idx]
    };
    let level_idx = (effective_level - 1) as usize;

    // Base data for this facility at this level:
    // [speed, stamina, power, guts, wisdom, SP, energy]
    let base = FACILITY_DATA[level_idx][facility_idx];
    let base_sp = base[5];
    let base_energy = base[6]; // Negative = cost, positive = recovery

    let n_cards = deck_cards.len().min(6);

    // Identify which cards are present at this facility
    let present_cards: Vec<usize> = card_locations.iter().enumerate()
        .filter(|&(i, &loc)| i < n_cards && loc == facility_idx)
        .map(|(i, _)| i)
        .collect();

    // --- Aggregate card effects ---
    let mut total_training_effectiveness = 0.0;
    let mut friendship_product = 1.0;
    let mut total_stat_bonuses = [0.0; 5];
    let mut total_energy_reduction = 0.0;
    let mut card_sp_bonus = 0.0;
    
    let mut flames = 0;
    let mut has_scenario_linked = false;

    let is_unity_cup = config.scenario == "unity_cup";

    for &card_idx in &present_cards {
        let card = deck_cards[card_idx];
        let level = deck_levels[card_idx];

        total_training_effectiveness += card.training_effectiveness(level);

        if state.friendship[card_idx] >= FRIENDSHIP_THRESHOLD {
            friendship_product *= 1.0 + card.friendship_bonus(level);
        }

        // Special training flames (Unity Cup)
        if is_unity_cup && state.unity_bonuses[card_idx] {
            flames += 1;
            if is_scenario_linked(&card.name) {
                has_scenario_linked = true;
            }
        }

        for stat_idx in 0..5 {
            total_stat_bonuses[stat_idx] += card.stat_bonus(stat_idx, level);
        }

        total_energy_reduction += card.energy_cost_reduction(level);
        card_sp_bonus += card.effect_value(EffectType::SkillPointBonus, level);
    }

    // --- Multiplier chain ---
    let mood_mult = state.mood_multiplier();
    let training_eff_mult = 1.0 + total_training_effectiveness;

    // --- Calculate base stat gains (before special training) ---
    let mut base_stat_gains = [0.0; 5];
    for s in 0..5 {
        let base_stat = base[s];
        if base_stat > 0.0 {
            // raw = base_stat × mood × (1 + TE) × friendship_product
            let raw = base_stat * mood_mult * training_eff_mult * friendship_product;
            
            // post_growth = floor(floor(raw) × (1 + growth_rate))
            let growth_rate = trainee.growth_rate(s);
            let raw_floored = raw.floor();
            let after_growth = (raw_floored * (1.0 + growth_rate)).floor();
            
            // base_gain = after_growth + flat_stat_bonuses_from_cards
            base_stat_gains[s] = after_growth + total_stat_bonuses[s];
        }
    }

    // --- Base SP gain ---
    // sp = floor(base_sp × (1 + TE)) + num_partners + card_sp_bonus
    let base_sp_gain = if base_sp > 0.0 {
        (base_sp * training_eff_mult).floor() + (present_cards.len() as f64) + card_sp_bonus
    } else {
        0.0
    };

    // --- Special Training bonuses (Unity Cup) ---
    let (special_stat_gains, special_sp_gain) = if is_unity_cup {
        get_special_training_bonus(facility_idx, flames, has_scenario_linked)
    } else {
        ([0.0; 5], 0.0)
    };

    // --- Totals ---
    let mut total_stat_gains = [0.0; 5];
    for s in 0..5 {
        total_stat_gains[s] = base_stat_gains[s] + special_stat_gains[s];
    }
    let total_sp_gain = base_sp_gain + special_sp_gain;

    // --- Energy cost (base + card reductions + special training penalty) ---
    let mut energy_cost = if base_energy < 0.0 {
        // Training costs energy — card reductions reduce the cost
        (base_energy + total_energy_reduction).min(-1.0)
    } else {
        // Wisdom recovers energy — no reduction needed
        base_energy
    };

    // Aoharu Special Training Energy Penalty/Bonus
    if is_unity_cup && flames > 0 {
        let penalty = if flames >= 2 { 4.0 } else { 2.0 };
        if facility_idx == 4 {
            // Wisdom recovers MORE energy with special training
            energy_cost += penalty;
        } else {
            // Other facilities cost MORE energy
            energy_cost -= penalty;
        }
    }

    TrainingResult {
        stat_gains: total_stat_gains,
        sp_gain: total_sp_gain,
        energy_cost,
        base_stat_gains,
        base_sp_gain,
        special_stat_gains,
        special_sp_gain,
    }
}

/// Training failure rate formula (datamined quadratic).
/// x = energy AFTER training would be applied.
pub fn failure_rate(energy_after: f64, is_wisdom: bool) -> f64 {
    if energy_after > 35.0 {
        return 0.0;
    }
    let x = energy_after;
    if is_wisdom {
        (0.000263953 * x * x - 0.0361337 * x + 0.983803).max(0.0).min(1.0)
    } else {
        (0.000258411 * x * x - 0.0277237 * x + 0.622712).max(0.0).min(1.0)
    }
}

// ─── Card Placement ──────────────────────────────────────────────────────────

/// Roll weighted random placement for all 6 support cards.
pub fn roll_card_placement(
    deck_cards: &[&SupportCard],
    deck_levels: &[i32],
    rng: &mut impl Rng,
) -> [usize; 6] {
    let mut locations = [0usize; 6];
    let n_cards = deck_cards.len().min(6);

    for i in 0..n_cards {
        let card = deck_cards[i];
        let specialty_prio = card.specialty_priority(deck_levels[i]);

        // 5 facilities + 1 "vacation" (not appearing)
        let mut weights = [BASE_FACILITY_WEIGHT; 6];
        weights[5] = VACATION_WEIGHT;

        if let Some(spec_idx) = card.primary_stat_index() {
            weights[spec_idx] += specialty_prio;
        } else {
            // Friend/group cards: split priority evenly
            let split = specialty_prio / 5.0;
            for w in weights.iter_mut().take(5) {
                *w += split;
            }
        }

        let dist = match WeightedIndex::new(&weights) {
            Ok(d) => d,
            Err(_) => {
                locations[i] = rng.gen_range(0..6);
                continue;
            }
        };
        locations[i] = dist.sample(rng);
    }

    locations
}

// ─── Mandatory Race Schedule ─────────────────────────────────────────────────

/// Returns true if this calendar turn has a mandatory race for Unity Cup.
fn is_mandatory_race(_cal: &CalendarTurn, _config: &ScenarioConfig) -> bool {
    // Unity Cup mandatory races — we'll refine this as we map out the run.
    // For now, placeholder based on known URA/Unity race windows.
    // TODO: populate with actual Unity Cup schedule from user's walkthrough
    false
}

// ─── The Optimizer ───────────────────────────────────────────────────────────

pub struct MonteCarloV2Optimizer;

impl MonteCarloV2Optimizer {
    pub fn new() -> Self {
        Self
    }
}

impl Optimizer for MonteCarloV2Optimizer {
    fn id(&self) -> &str { "monte_carlo_v2" }
    fn name(&self) -> &str { "Monte Carlo Simulation v3" }
    fn description(&self) -> &str {
        "Calendar-aware Monte Carlo simulator with facility leveling, energy management, \
         mood tracking, training failure, inheritance events, summer camp, and skill hint \
         resolution. Runs 10,000 parallel simulations for accurate variance modeling."
    }

    fn score_deck(
        &self,
        trainee: &Trainee,
        deck_cards: &[&SupportCard],
        deck_levels: &[i32],
        config: &ScenarioConfig,
    ) -> DeckScore {
        let n_cards = deck_cards.len().min(6);

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1: PRE-RUN INITIALIZATION
        // ═══════════════════════════════════════════════════════════════════

        // 1a. Trainee base stats at star rank
        let mut initial_stats = trainee.starting_stats(config.star_rank);

        // 1b. Fixed legacy stat injection (deterministic).
        //     Blue factors from parents: 1★=+5, 2★=+12, 3★=+21
        //     Blue factors from grandparents: same values
        //     These are FIXED and don't vary between simulations.
        if let Some(ref legacy) = config.legacy {
            let parent_injection = legacy.fixed_stat_injection();
            let gp_injection = legacy.fixed_grandparent_injection();
            for s in 0..5 {
                initial_stats[s] += parent_injection[s] + gp_injection[s];
            }
        }

        // 1c. Support card initial stat bonuses
        for i in 0..n_cards {
            for stat_idx in 0..5 {
                initial_stats[stat_idx] += deck_cards[i].initial_stat(stat_idx, deck_levels[i]);
            }
        }

        // 1d. Initial friendship from support cards
        let initial_friendship: Vec<f64> = (0..n_cards)
            .map(|i| deck_cards[i].initial_friendship(deck_levels[i]))
            .collect();

        // 1e. Starting SP from "Introducing [Trainee]!" event
        let initial_sp = INTRO_EVENT_SP;

        // 1f. Pre-compute legacy factor lists for spark rolls (used in simulation loop)
        let blue_factors: Vec<(usize, u8, bool)> = config.legacy.as_ref()
            .map(|l| l.all_blue_factors())
            .unwrap_or_default();
        let skill_factors: Vec<(u32, u8)> = config.legacy.as_ref()
            .map(|l| l.all_skill_factors())
            .unwrap_or_default();
        let affinity_rate: f64 = config.legacy.as_ref()
            .map(|l| l.affinity.activation_rate())
            .unwrap_or(0.25);

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 2: MONTE CARLO — 11+72-TURN CALENDAR SIMULATION
        // ═══════════════════════════════════════════════════════════════════

        let total_final_stats: [f64; 5] = (0..NUM_SIMULATIONS)
            .into_par_iter()
            .map(|_| {
                let mut rng = thread_rng();
                let mut state = SimState::new(
                    initial_stats,
                    &initial_friendship,
                    initial_sp,
                );
                // Pre-debut: 11 generic training turns before the 72-turn calendar.
                // Keep `config.turns` representing the career calendar (72); do
                // not change it to 83. These pre-debut turns simulate early
                // training without calendar events (no sparks/races/summer logic).
                for _pre_turn in 0..11 {
                    // Roll card placement
                    let card_locations = roll_card_placement(
                        deck_cards, deck_levels, &mut rng,
                    );

                    // Evaluate facilities (no summer camp during pre-debut)
                    let facility_results: Vec<TrainingResult> = (0..5)
                        .map(|f| calculate_training_result(
                            f, &card_locations, deck_cards, deck_levels,
                            &state, trainee, false, config,
                        ))
                        .collect();

                    // Should we rest? use same heuristic but no summer bonus
                    let should_rest = state.energy < 40.0;
                    if should_rest {
                        // Roll rest outcome
                        let roll: f64 = rng.gen();
                        let mut cumulative = 0.0;
                        for &(prob, energy, _night_owl) in &REST_OUTCOMES {
                            cumulative += prob;
                            if roll < cumulative {
                                state.energy = (state.energy + energy).min(MAX_ENERGY);
                                break;
                            }
                        }
                        continue;
                    }

                    // Evaluate and pick best facility
                    let mut best_facility = 0;
                    let mut max_score = f64::NEG_INFINITY;

                    for facility_idx in 0..5 {
                        let result = &facility_results[facility_idx];

                        let weighted_stats: f64 = result.stat_gains.iter().enumerate()
                            .map(|(i, &g)| g * config.stat_weights[i])
                            .sum();

                        // Factor in energy: wisdom recovers energy, which has value
                        let energy_value = if result.energy_cost > 0.0 {
                            result.energy_cost * if state.energy < 60.0 { 0.5 } else { 0.1 }
                        } else {
                            0.0
                        };

                        let energy_after = state.energy + result.energy_cost;
                        let fail_rate = failure_rate(energy_after, facility_idx == 4);
                        let success_adjusted = weighted_stats * (1.0 - fail_rate);

                        let score = success_adjusted + energy_value + result.sp_gain * 0.5;

                        if score > max_score {
                            max_score = score;
                            best_facility = facility_idx;
                        }
                    }

                    // Roll for training failure
                    let chosen = &facility_results[best_facility];
                    let energy_after = state.energy + chosen.energy_cost;
                    let fail_chance = failure_rate(energy_after, best_facility == 4);

                    if fail_chance > 0.0 && rng.gen::<f64>() < fail_chance {
                        // Training failed; energy cost still applies
                        state.energy = energy_after.max(0.0);
                        if rng.gen::<f64>() < 0.3 {
                            state.mood = state.mood.saturating_sub(1);
                        }
                        continue;
                    }

                    // Execute training
                    for i in 0..5 {
                        state.stats[i] += chosen.stat_gains[i];
                    }
                    state.skill_points += chosen.sp_gain;

                    state.energy = (state.energy + chosen.energy_cost).clamp(0.0, MAX_ENERGY);
                    state.record_facility_train(best_facility);

                    // Update friendship for present cards
                    for (card_idx, &loc) in card_locations.iter().enumerate() {
                        if card_idx < n_cards && loc == best_facility {
                            state.friendship[card_idx] =
                                (state.friendship[card_idx] + FRIENDSHIP_GAIN_PER_TRAIN)
                                    .min(MAX_FRIENDSHIP);
                        }
                    }

                    // End-of-turn random events (small chance per present card)
                    for card_idx in 0..n_cards {
                        if card_locations[card_idx] == best_facility {
                            if rng.gen::<f64>() < 0.05 {
                                let recovery = deck_cards[card_idx]
                                    .event_recovery(deck_levels[card_idx]);
                                state.energy = (state.energy + recovery).min(MAX_ENERGY);
                                state.skill_points += 5.0;
                            }
                        }
                    }
                }

                for turn_num in 0..config.turns {
                    let cal = CalendarTurn::from_turn(turn_num);

                    // ── Pre-Turn: Fixed Calendar Events ──

                    // Spark of Inspiration — inheritance events
                    // Fires at: turn 0 (career start), April Classic, April Senior
                    let is_initial_spark = turn_num == 0;
                    let is_midrun_spark = cal.is_inheritance_event();

                    if is_initial_spark || is_midrun_spark {
                        // Roll each blue factor for stat gains.
                        // Initial spark: all factors activate (100% rate).
                        // Mid-run sparks: each factor activates with affinity-based probability.
                        let activation_rate = if is_initial_spark { 1.0 } else { affinity_rate };

                        for &(stat_idx, stars, _is_parent) in &blue_factors {
                            if rng.gen::<f64>() < activation_rate {
                                let (min, max) = Factor::spark_stat_range(stars);
                                let gain = min + rng.gen::<f64>() * (max - min);
                                state.stats[stat_idx] += gain;
                            }
                        }

                        // Roll each skill factor for hint level gains.
                        for &(skill_id, stars) in &skill_factors {
                            if rng.gen::<f64>() < activation_rate {
                                let (min_h, max_h) = Factor::spark_hint_range(stars);
                                let gained: u8 = if max_h > min_h {
                                    min_h + (rng.gen::<f64>() * (max_h - min_h + 1) as f64) as u8
                                } else {
                                    min_h
                                };
                                let current = state.hint_levels.entry(skill_id).or_insert(0);
                                *current = (*current + gained).min(5);
                            }
                        }

                        // Mid-run sparks also grant some SP
                        if is_midrun_spark {
                            state.skill_points += 20.0;
                        }
                    }

                    // New Year events (January of each year)
                    if cal.is_new_year_event() {
                        // Player typically picks energy recovery or SP
                        state.energy = (state.energy + 20.0).min(MAX_ENERGY);
                        state.skill_points += 15.0;
                    }

                    // ── Step 1: Roll Card Placement ──
                    let card_locations = roll_card_placement(
                        deck_cards, deck_levels, &mut rng,
                    );

                    // ── Step 2: Check for Mandatory Race ──
                    if is_mandatory_race(&cal, config) {
                        // Execute race: gain SP + some stats based on race bonus
                        let total_race_bonus: f64 = (0..n_cards)
                            .map(|i| deck_cards[i].race_bonus(deck_levels[i]))
                            .sum();

                        // Base race rewards (approximate)
                        let base_race_stats = 3.0;
                        let race_mult = 1.0 + total_race_bonus;
                        for s in 0..5 {
                            state.stats[s] += base_race_stats * race_mult;
                        }
                        state.skill_points += 45.0 * race_mult;
                        state.races_run += 1;
                        continue; // Race consumes the turn
                    }

                    // ── Step 3: Decision Heuristic ──
                    let is_summer = cal.is_summer_camp();

                    // Pre-evaluate all facilities to know what's available
                    let facility_results: Vec<TrainingResult> = (0..5)
                        .map(|f| calculate_training_result(
                            f, &card_locations, deck_cards, deck_levels,
                            &state, trainee, is_summer, config,
                        ))
                        .collect();

                    // Should we rest?
                    // During summer camp, rest gives guaranteed 35E + mood up.
                    // Otherwise, rest rolls: 25.5% +70, 58% +50, 13% +30, 3.5% +30+nightowl
                    let should_rest = if is_summer && state.energy < 70.0 {
                        true
                    } else {
                        // Rest if energy is low enough that most trainings have
                        // high failure risk
                        state.energy < 40.0
                    };

                    if should_rest {
                        if is_summer {
                            // Summer rest: guaranteed 35 energy + mood upgrade
                            state.energy = (state.energy + SUMMER_REST_ENERGY_GAIN).min(MAX_ENERGY);
                            state.mood = (state.mood + 1).min(4);
                        } else {
                            // Roll rest outcome
                            let roll: f64 = rng.gen();
                            let mut cumulative = 0.0;
                            for &(prob, energy, _night_owl) in &REST_OUTCOMES {
                                cumulative += prob;
                                if roll < cumulative {
                                    state.energy = (state.energy + energy).min(MAX_ENERGY);
                                    break;
                                }
                            }
                        }
                        continue;
                    }

                    // ── Step 4: Evaluate All Facilities ──
                    let mut best_facility = 0;
                    let mut max_score = f64::NEG_INFINITY;

                    for facility_idx in 0..5 {
                        let result = &facility_results[facility_idx];

                        let weighted_stats: f64 = result.stat_gains.iter().enumerate()
                            .map(|(i, &g)| g * config.stat_weights[i])
                            .sum();

                        // Factor in energy: wisdom recovers energy, which has value
                        let energy_value = if result.energy_cost > 0.0 {
                            // Wisdom gives energy back — bonus value when depleted
                            result.energy_cost * if state.energy < 60.0 { 0.5 } else { 0.1 }
                        } else {
                            0.0
                        };

                        // Factor in failure risk: check what energy would be after
                        let energy_after = state.energy + result.energy_cost;
                        let fail_rate = failure_rate(energy_after, facility_idx == 4);
                        let success_adjusted = weighted_stats * (1.0 - fail_rate);

                        let score = success_adjusted + energy_value + result.sp_gain * 0.5;

                        if score > max_score {
                            max_score = score;
                            best_facility = facility_idx;
                        }
                    }

                    // ── Step 5: Roll for Training Failure ──
                    let chosen = &facility_results[best_facility];
                    let energy_after = state.energy + chosen.energy_cost;
                    let fail_chance = failure_rate(energy_after, best_facility == 4);

                    if fail_chance > 0.0 && rng.gen::<f64>() < fail_chance {
                        // Training failed! Energy cost still applies.
                        state.energy = energy_after.max(0.0);
                        // Mood may drop on failure
                        if rng.gen::<f64>() < 0.3 {
                            state.mood = state.mood.saturating_sub(1);
                        }
                        continue;
                    }

                    // ── Step 6: Execute Training ──
                    // Apply stat gains
                    for i in 0..5 {
                        state.stats[i] += chosen.stat_gains[i];
                    }
                    state.skill_points += chosen.sp_gain;

                    // Apply energy change
                    state.energy = (state.energy + chosen.energy_cost).clamp(0.0, MAX_ENERGY);

                    // Level up the facility
                    state.record_facility_train(best_facility);

                    // Update friendship for present cards
                    for (card_idx, &loc) in card_locations.iter().enumerate() {
                        if card_idx < n_cards && loc == best_facility {
                            state.friendship[card_idx] =
                                (state.friendship[card_idx] + FRIENDSHIP_GAIN_PER_TRAIN)
                                    .min(MAX_FRIENDSHIP);
                        }
                    }

                    // ── Step 7: End-of-Turn Random Events ──
                    // Small chance of card events (energy recovery, hints, mood)
                    for card_idx in 0..n_cards {
                        if card_locations[card_idx] == best_facility {
                            // ~5% chance per present card per turn
                            if rng.gen::<f64>() < 0.05 {
                                let recovery = deck_cards[card_idx]
                                    .event_recovery(deck_levels[card_idx]);
                                state.energy = (state.energy + recovery).min(MAX_ENERGY);
                                state.skill_points += 5.0;
                            }
                        }
                    }

                } // ── End of 72-turn loop ──

                state.stats
            })
            .reduce(
                || [0.0; 5],
                |mut a, b| {
                    for i in 0..5 { a[i] += b[i]; }
                    a
                },
            );

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 3: AGGREGATE & SCORE
        // ═══════════════════════════════════════════════════════════════════

        let mut projected_stats = StatBlock::default();
        for i in 0..5 {
            projected_stats[i] = (total_final_stats[i] / NUM_SIMULATIONS as f64)
                .min(config.stat_caps[i]);
        }

        // Fitness calculation
        let mut fitness = 0.0;
        for s in 0..5 {
            fitness += projected_stats[s] * config.stat_weights[s];
        }

        // Stamina penalty
        let min_stamina = config.effective_min_stamina();
        if projected_stats.stamina < min_stamina {
            let ratio = projected_stats.stamina / min_stamina;
            fitness *= ratio * 0.5;
        }

        DeckScore {
            deck: Deck {
                cards: (0..n_cards).map(|i| (deck_cards[i].id, deck_levels[i])).collect(),
            },
            projected_stats,
            fitness,
            stat_sources: Default::default(),
            warnings: vec!["Monte Carlo v3 (Calendar-Aware)".to_string()],
            explanation: vec![format!(
                "Projected stats after {} calendar-aware simulations with facility leveling, \
                 energy/mood management, and training failure modeling.",
                NUM_SIMULATIONS
            )],
        }
    }

    fn simulate_turn(
        &self,
        trainee: &Trainee,
        deck_cards: &[&SupportCard],
        deck_levels: &[i32],
        config: &ScenarioConfig,
        state: &RunState,
    ) -> TurnResult {
        let cal = CalendarTurn::from_turn(state.turn);
        let is_summer = cal.is_summer_camp();

        let mut internal_state = SimState::new(
            [state.stats.speed, state.stats.stamina, state.stats.power, state.stats.guts, state.stats.wisdom],
            &state.friendship,
            state.skill_points,
        );
        internal_state.energy = state.energy;
        internal_state.mood = state.mood;
        for i in 0..5 {
            internal_state.facility_levels[i] = state.facility_levels[i];
            internal_state.facility_trains[i] = state.facility_trains[i];
        }
        for (i, &has_unity) in state.unity_bonus_cards.iter().enumerate().take(6) {
            internal_state.unity_bonuses[i] = has_unity;
        }

        let mut total_gains = vec![StatBlock::default(); 5];
        let mut total_costs = vec![0.0; 5];
        let mut total_fails = vec![0.0; 5];
        
        let mut base_gains_out = None;
        let mut special_gains_out = None;
        let mut base_sp_gains_out = None;
        let mut special_sp_gains_out = None;

        // If the caller provided observed card placements, use them directly (exact result).
        // Otherwise average over 1000 random samples to get the expected result.
        if !state.card_placements.is_empty() {
            // Build fixed card_locations from observed placements (-1 = away → 5)
            let mut card_locations = [5usize; 6];
            for (i, &p) in state.card_placements.iter().enumerate().take(6) {
                card_locations[i] = if p >= 0 { p as usize } else { 5 };
            }
            
            let mut base_gains = vec![StatBlock::default(); 5];
            let mut special_gains = vec![StatBlock::default(); 5];
            let mut base_sp_gains = vec![0.0; 5];
            let mut special_sp_gains = vec![0.0; 5];

            for f in 0..5 {
                let res = calculate_training_result(f, &card_locations, deck_cards, deck_levels, &internal_state, trainee, is_summer, config);
                total_gains[f].speed = res.stat_gains[0];
                total_gains[f].stamina = res.stat_gains[1];
                total_gains[f].power = res.stat_gains[2];
                total_gains[f].guts = res.stat_gains[3];
                total_gains[f].wisdom = res.stat_gains[4];
                
                base_gains[f].speed = res.base_stat_gains[0];
                base_gains[f].stamina = res.base_stat_gains[1];
                base_gains[f].power = res.base_stat_gains[2];
                base_gains[f].guts = res.base_stat_gains[3];
                base_gains[f].wisdom = res.base_stat_gains[4];
                
                special_gains[f].speed = res.special_stat_gains[0];
                special_gains[f].stamina = res.special_stat_gains[1];
                special_gains[f].power = res.special_stat_gains[2];
                special_gains[f].guts = res.special_stat_gains[3];
                special_gains[f].wisdom = res.special_stat_gains[4];
                
                base_sp_gains[f] = res.base_sp_gain;
                special_sp_gains[f] = res.special_sp_gain;

                total_costs[f] = res.energy_cost;
                total_fails[f] = failure_rate(internal_state.energy + res.energy_cost, f == 4);
            }
            
            base_gains_out = Some(base_gains);
            special_gains_out = Some(special_gains);
            base_sp_gains_out = Some(base_sp_gains);
            special_sp_gains_out = Some(special_sp_gains);
        } else {
            // Since card placement is random, we average over 1000 samples for the "expected" turn result
            let mut rng = rand::thread_rng();
            let samples = 1000;

            for _ in 0..samples {
                let card_locations = roll_card_placement(deck_cards, deck_levels, &mut rng);
                for f in 0..5 {
                    let res = calculate_training_result(f, &card_locations, deck_cards, deck_levels, &internal_state, trainee, is_summer, config);
                    total_gains[f].speed += res.stat_gains[0];
                    total_gains[f].stamina += res.stat_gains[1];
                    total_gains[f].power += res.stat_gains[2];
                    total_gains[f].guts += res.stat_gains[3];
                    total_gains[f].wisdom += res.stat_gains[4];
                    total_costs[f] += res.energy_cost;
                    total_fails[f] += failure_rate(internal_state.energy + res.energy_cost, f == 4);
                }
            }

            for f in 0..5 {
                total_gains[f].speed /= samples as f64;
                total_gains[f].stamina /= samples as f64;
                total_gains[f].power /= samples as f64;
                total_gains[f].guts /= samples as f64;
                total_gains[f].wisdom /= samples as f64;
                total_costs[f] /= samples as f64;
                total_fails[f] /= samples as f64;
            }
        }

        // Compute composite facility scores: stats + SP + friendship + hint value
        let facility_scores: Vec<f64> = (0..5).map(|f| {
            let stat_total = total_gains[f].total();
            let sp_total = base_sp_gains_out.as_ref().map_or(0.0, |v| v[f])
                + special_sp_gains_out.as_ref().map_or(0.0, |v| v[f]);

            // Friendship bonus: cards at this facility gain friendship.
            // Worth more when approaching the 80-point training bonus threshold.
            let friendship_bonus: f64 = state.card_placements.iter().enumerate()
                .filter(|&(_, &p)| p == f as i32)
                .map(|(card_idx, _)| {
                    let current = state.friendship.get(card_idx).copied().unwrap_or(0.0);
                    if current >= 70.0 && current < 80.0 { 8.0 }
                    else if current < 80.0 { 3.0 }
                    else { 1.0 }
                })
                .sum();

            // Hint bonus: cards at this facility with hint active (! icon).
            // A hint is worth ~15 equivalent stat points (unlocks/discounts a skill).
            let hint_bonus: f64 = state.card_placements.iter().enumerate()
                .filter(|&(_, &p)| p == f as i32)
                .filter(|&(card_idx, _)| state.hint_cards.get(card_idx).copied().unwrap_or(false))
                .map(|_| 15.0)
                .sum();

            stat_total + sp_total * 0.5 + friendship_bonus + hint_bonus
        }).collect();

        TurnResult {
            state: state.clone(),
            expected_gains: total_gains,
            expected_energy_costs: total_costs,
            failure_rates: total_fails,
            base_gains: base_gains_out,
            special_gains: special_gains_out,
            base_sp_gains: base_sp_gains_out,
            special_sp_gains: special_sp_gains_out,
            facility_scores,
        }
    }
}
