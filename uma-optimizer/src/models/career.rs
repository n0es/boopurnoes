use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::deck::StatBlock;
use super::config::LegacyConfig;
use super::support_card::SupportCard;
use super::trainee::Trainee;

// ─── Enums ──────────────────────────────────────────────────────────────────

/// Which scenario is being played.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scenario {
    UraFinals,
    UnityCup,
    Trackblazer,
}

impl Default for Scenario {
    fn default() -> Self {
        Scenario::UraFinals
    }
}

impl Scenario {
    /// Total player turns in a career (scenario-specific).
    /// URA / Unity Cup: 78 (Junior + Classic + Senior + finale).
    /// Trackblazer: 12 pre-debut + 72 regular + 6 Twinkle Star Climax.
    pub fn total_turns(&self) -> u32 {
        match self {
            Scenario::UraFinals | Scenario::UnityCup => 78,
            Scenario::Trackblazer => 90, // 12 + 72 + 6
        }
    }

    /// UI labels for timeline sections (inclusive `start_turn` / `end_turn`, 0-based).
    pub fn turn_phase_labels(&self) -> Vec<(&'static str, u32, u32)> {
        match self {
            Scenario::UraFinals | Scenario::UnityCup => {
                vec![("Career", 0, self.total_turns().saturating_sub(1))]
            }
            Scenario::Trackblazer => {
                vec![
                    ("Pre-debut", 0, 11),
                    ("Regular", 12, 83),
                    ("Twinkle Star Climax", 84, 89),
                ]
            }
        }
    }

    /// Base training value multiplier relative to URA (which has the highest bases).
    /// URA = 1.0, Unity Cup / Trackblazer = lower bases.
    pub fn base_training_multiplier(&self) -> f64 {
        match self {
            Scenario::UraFinals => 1.0,
            Scenario::UnityCup => 0.8,   // +8 vs +10 for Speed Lv1
            Scenario::Trackblazer => 0.8,
        }
    }
}

/// Mood level, affecting the mood multiplier in the training formula.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mood {
    VeryGood,
    Good,
    Normal,
    Bad,
    VeryBad,
}

impl Default for Mood {
    fn default() -> Self {
        Mood::Normal
    }
}

impl Mood {
    /// The base mood modifier (before Mood Effect Up amplification).
    pub fn base_modifier(&self) -> f64 {
        match self {
            Mood::VeryGood => 0.20,
            Mood::Good => 0.10,
            Mood::Normal => 0.00,
            Mood::Bad => -0.10,
            Mood::VeryBad => -0.20,
        }
    }

    /// The full mood multiplier given a sum of mood_effect_up percentages (as decimals).
    /// Formula: 1 + (base × (1 + Σ mood_effect_up))
    pub fn multiplier(&self, mood_effect_up_sum: f64) -> f64 {
        1.0 + (self.base_modifier() * (1.0 + mood_effect_up_sum))
    }
}

// ─── Career Configuration ───────────────────────────────────────────────────

/// Everything needed to initialize a career simulation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CareerConfig {
    /// Which scenario to simulate.
    #[serde(default)]
    pub scenario: Scenario,

    /// Trainee ID (looked up from DB).
    pub trainee_id: i32,

    /// Star rank of the trainee (1–5).
    #[serde(default = "default_star_rank")]
    pub star_rank: u8,

    /// Awakening level (1–5).
    #[serde(default = "default_awakening")]
    pub awakening_level: u8,

    /// The 6 support cards: (card_id, card_level).
    pub deck: Vec<(i32, i32)>,

    /// Legacy / inheritance configuration. If None, no inheritance bonuses.
    #[serde(default)]
    pub legacy: Option<LegacyConfig>,
}

fn default_star_rank() -> u8 { 5 }
fn default_awakening() -> u8 { 5 }

// ─── Initial State ──────────────────────────────────────────────────────────

/// The fully computed initial state of a career, before any turns are taken.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CareerInitialState {
    /// Starting stats (sum of character base + blue factors + support card initial bonuses).
    pub stats: StatBlock,

    /// Breakdown: character base stats at the given star rank.
    pub base_stats: StatBlock,

    /// Breakdown: total blue factor inheritance bonus.
    pub inheritance_stats: StatBlock,

    /// Breakdown: support-card initial stat bonuses (Career Simulator exposes this as zero; deck initial stats apply in training sims only).
    pub support_card_stats: StatBlock,

    /// Starting SP (always 120).
    pub sp: f64,

    /// Starting energy (always 100).
    pub energy: f64,

    /// Starting mood (always Normal).
    pub mood: Mood,

    /// Per-card starting friendship values (from Initial Bond Gauge effects).
    pub friendship: Vec<f64>,

    /// Per-card info for display purposes.
    pub card_info: Vec<CardSlotInfo>,

    /// Growth rates for this trainee [speed, stamina, power, guts, wisdom] as percentages.
    pub growth_rates: [f64; 5],

    /// Trainee base stats only (before the first Spark of Inspiration applies blue inheritance).
    pub pre_spark_stats: StatBlock,

    /// Trainee aptitude letter grades before first spark (keys: turf, mile, leading, …).
    pub aptitudes: HashMap<String, String>,
}

fn trainee_aptitude_map(trainee: &Trainee) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let ins = |map: &mut HashMap<String, String>, k: &str, v: &Option<String>| {
        if let Some(g) = v {
            let t = g.trim();
            if !t.is_empty() {
                map.insert(k.to_string(), t.to_uppercase());
            }
        }
    };
    ins(&mut m, "turf", &trainee.apt_turf);
    ins(&mut m, "dirt", &trainee.apt_dirt);
    ins(&mut m, "short", &trainee.apt_short);
    ins(&mut m, "mile", &trainee.apt_mile);
    ins(&mut m, "mid", &trainee.apt_mid);
    ins(&mut m, "long", &trainee.apt_long);
    ins(&mut m, "leading", &trainee.apt_leading);
    ins(&mut m, "stalking", &trainee.apt_stalking);
    ins(&mut m, "mid_pack", &trainee.apt_mid_pack);
    ins(&mut m, "chasing", &trainee.apt_chasing);
    m
}

/// Info about a single card slot (for UI display).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardSlotInfo {
    pub card_id: i32,
    pub level: i32,
    pub name: String,
    pub card_type: String,
    pub rarity: String,
}

// ─── Computation ────────────────────────────────────────────────────────────

/// Compute the initial state of a career from its configuration.
///
/// Career Simulator starting totals intentionally **exclude** support-card 「初期」 stat ups
/// (those apply during training in full sims). Starting stats are:
/// ```text
/// Starting_Stat[s] = CharacterBase[s][star_rank]
///                   + Σ(blue_factor_value[star] for each of 6 family members)
/// ```
pub fn compute_initial_state(
    trainee: &Trainee,
    cards: &[&SupportCard],
    levels: &[i32],
    config: &CareerConfig,
) -> CareerInitialState {
    // ① Character base stats at the given star rank
    let base_arr = trainee.starting_stats(config.star_rank);
    let base_stats = StatBlock {
        speed: base_arr[0],
        stamina: base_arr[1],
        power: base_arr[2],
        guts: base_arr[3],
        wisdom: base_arr[4],
    };

    // ② Blue factor inheritance (all 6 family members contribute fixed values at career start)
    let mut inheritance_arr = [0.0_f64; 5];
    if let Some(ref legacy) = config.legacy {
        // Parents contribute via fixed_stat_injection
        let parent_stats = legacy.fixed_stat_injection();
        // Grandparents also contribute fixed values at career start
        let grandparent_stats = legacy.fixed_grandparent_injection();
        for i in 0..5 {
            inheritance_arr[i] = parent_stats[i] + grandparent_stats[i];
        }
    }
    let inheritance_stats = StatBlock {
        speed: inheritance_arr[0],
        stamina: inheritance_arr[1],
        power: inheritance_arr[2],
        guts: inheritance_arr[3],
        wisdom: inheritance_arr[4],
    };

    // ③ Support-card initial stat line (always zero here; deck 初期 bonuses are not added to career-start totals).
    let support_card_stats = StatBlock::default();

    // Full starting stats = character base + fixed blue-factor inheritance (parent + grandparent).
    // This matches the character screen / career-start totals. "Spark of Inspiration" in the sim is
    // reserved for player-logged *spark scene* rolls (e.g. April inheritance turns), not this fixed row.
    let stats = StatBlock {
        speed: base_stats.speed + inheritance_stats.speed,
        stamina: base_stats.stamina + inheritance_stats.stamina,
        power: base_stats.power + inheritance_stats.power,
        guts: base_stats.guts + inheritance_stats.guts,
        wisdom: base_stats.wisdom + inheritance_stats.wisdom,
    };

    // Per-card friendship from "Initial Bond Gauge Up" effects
    let friendship: Vec<f64> = cards
        .iter()
        .enumerate()
        .map(|(i, card)| {
            let level = levels.get(i).copied().unwrap_or(1);
            card.initial_friendship(level)
        })
        .collect();

    // Card slot info for display
    let card_info: Vec<CardSlotInfo> = cards
        .iter()
        .enumerate()
        .map(|(i, card)| CardSlotInfo {
            card_id: card.id,
            level: levels.get(i).copied().unwrap_or(1),
            name: card.name.clone(),
            card_type: card.card_type.clone(),
            rarity: card.rarity.clone(),
        })
        .collect();

    // Growth rates
    let growth_rates = [
        trainee.growth_rate(0),
        trainee.growth_rate(1),
        trainee.growth_rate(2),
        trainee.growth_rate(3),
        trainee.growth_rate(4),
    ];

    CareerInitialState {
        stats,
        base_stats,
        inheritance_stats,
        support_card_stats,
        sp: 120.0,
        energy: 100.0,
        mood: Mood::Normal,
        friendship,
        card_info,
        growth_rates,
        pre_spark_stats: base_stats.clone(),
        aptitudes: trainee_aptitude_map(trainee),
    }
}

#[cfg(test)]
mod tests {
    use super::CareerConfig;

    /// Frontend sends extra `trainee_id` on legacy members; serde must still apply blue factors.
    #[test]
    fn career_config_deserializes_legacy_with_member_trainee_id_and_blue_stats() {
        let j = r#"{
            "scenario": "ura_finals",
            "trainee_id": 10601,
            "star_rank": 5,
            "awakening_level": 5,
            "deck": [[1,50],[2,50],[3,50],[4,50],[5,50],[6,50]],
            "legacy": {
                "legacy_1": {
                    "parent": {
                        "name": "Parent A",
                        "trainee_id": 1001,
                        "factors": [{"type":"BlueStat","stat_index":0,"stars":3}]
                    },
                    "grandparent_1": { "name": "", "factors": [] },
                    "grandparent_2": { "name": "", "factors": [] }
                },
                "legacy_2": {
                    "parent": { "name": "", "factors": [] },
                    "grandparent_1": { "name": "", "factors": [] },
                    "grandparent_2": { "name": "", "factors": [] }
                },
                "affinity": "circle"
            }
        }"#;
        let cfg: CareerConfig = serde_json::from_str(j).expect("CareerConfig JSON");
        let leg = cfg.legacy.as_ref().expect("legacy");
        let p = leg.fixed_stat_injection();
        let g = leg.fixed_grandparent_injection();
        assert_eq!(p[0], 21.0, "parent 3★ speed = 21");
        assert_eq!(g.iter().sum::<f64>(), 0.0, "no grandparent blues");
    }

    #[test]
    fn blue_stat_deserializes_camel_case_stat_index() {
        let j = r#"{"type":"BlueStat","statIndex":1,"stars":2}"#;
        let f: crate::models::config::Factor = serde_json::from_str(j).expect("Factor");
        match f {
            crate::models::config::Factor::BlueStat { stat_index, stars } => {
                assert_eq!(stat_index, 1);
                assert_eq!(stars, 2);
            }
            _ => panic!("expected BlueStat"),
        }
    }

    #[test]
    fn spark_affinity_on_member_deserializes() {
        let j = r#"{
            "trainee_id": 1,
            "deck": [[1,50],[2,50],[3,50],[4,50],[5,50],[6,50]],
            "legacy": {
                "legacy_1": {
                    "parent": {
                        "name": "P",
                        "factors": [{"type":"BlueStat","stat_index":2,"stars":1}],
                        "spark_affinity": "double_circle"
                    },
                    "grandparent_1": { "name": "", "factors": [] },
                    "grandparent_2": { "name": "", "factors": [] }
                },
                "legacy_2": {
                    "parent": { "name": "", "factors": [] },
                    "grandparent_1": { "name": "", "factors": [] },
                    "grandparent_2": { "name": "", "factors": [] }
                }
            }
        }"#;
        let cfg: CareerConfig = serde_json::from_str(j).expect("parse");
        let leg = cfg.legacy.as_ref().unwrap();
        let p = leg.fixed_stat_injection();
        assert_eq!(p[2], 5.0, "parent 1★ power");
    }
}
