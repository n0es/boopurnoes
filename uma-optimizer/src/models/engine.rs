//! Career simulation engine — evaluates training, rest, events, and other
//! actions, producing deterministic results given explicit card placements.
//!
//! Unlike monte_carlo_v2 which runs thousands of stochastic simulations,
//! this engine works with a single career session where the player makes
//! explicit choices each turn. Card placements are observed (from the game)
//! rather than rolled randomly.
//!
//! Events and turns are separate timeline entries. Events (Spark of Inspiration,
//! New Year, Summer Camp, card events, etc.) are submitted independently and
//! appear as distinct entries in the rollback bar.

use std::collections::HashMap;

use rand::Rng;
use rand::SeedableRng;
use uuid::Uuid;

use super::career::Mood;
use super::config::{Factor, LegacyConfig, normalize_apt_key};
use super::deck::StatBlock;
use super::session::*;
use super::support_card::{EffectType, SupportCard};
use super::trainee::Trainee;

// ─── Training Result ────────────────────────────────────────────────────────

/// Full result of evaluating a training action at a specific facility.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FacilityPreview {
    /// Which facility this preview is for.
    pub facility: usize,
    /// Per-stat gains from training.
    pub stat_gains: [f64; 5],
    /// SP gained.
    pub sp_gain: f64,
    /// Energy change (negative = cost, positive = recovery for Wisdom).
    pub energy_change: f64,
    /// Training failure probability.
    pub failure_rate: f64,
    /// Which cards are present at this facility.
    pub present_cards: Vec<usize>,
    /// Friendship gain for each present card.
    pub friendship_gains: Vec<f64>,
}

/// Full turn preview: what would happen at each facility, plus pending events.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurnPreview {
    /// Turn number (counting only turns, not events).
    pub turn_number: u32,
    /// Calendar info for this turn.
    pub calendar: CalendarTurn,
    /// Events that should fire before this turn (player needs to submit these first).
    pub pending_events: Vec<GameEvent>,
    /// Preview of training at each of the 5 facilities.
    pub facility_previews: Vec<FacilityPreview>,
    /// Whether this is a summer camp turn (facilities forced to level 5).
    pub is_summer_camp: bool,
    /// Whether a mandatory race must be run this turn.
    pub is_mandatory_race: bool,
    /// Available actions the player can choose from.
    pub available_actions: Vec<String>,
}

// ─── Training Calculation ───────────────────────────────────────────────────

/// Calculate the training result for a specific facility given the current state.
///
/// This is the core training formula:
/// ```text
/// stat_gain[s] = floor( floor(base[s] × mood × (1+TE) × friendship_product) × (1+growth) )
///              + flat_stat_bonus[s]
/// sp_gain = floor(base_sp × (1+TE)) + n_partners + card_sp_bonus
/// ```
pub fn calculate_training(
    facility_idx: usize,
    card_placements: &[usize; 6],
    cards: &[&SupportCard],
    card_levels: &[i32],
    snapshot: &TurnSnapshot,
    trainee: &Trainee,
    is_summer_camp: bool,
    mood_effect_up_sum: f64,
) -> FacilityPreview {
    let n_cards = cards.len().min(6);

    // Effective facility level (summer camp forces level 5)
    let effective_level = if is_summer_camp {
        MAX_FACILITY_LEVEL
    } else {
        snapshot.facility_levels[facility_idx]
    };
    let level_idx = (effective_level - 1) as usize;

    // Base data: [speed, stamina, power, guts, wisdom, SP, energy]
    let base = FACILITY_DATA[level_idx][facility_idx];
    let base_sp = base[5];
    let base_energy = base[6];

    // Identify present cards at this facility
    let present_cards: Vec<usize> = card_placements
        .iter()
        .enumerate()
        .filter(|&(i, &loc)| i < n_cards && loc == facility_idx)
        .map(|(i, _)| i)
        .collect();

    // Aggregate card effects from present cards
    let mut total_training_effectiveness = 0.0;
    let mut friendship_product = 1.0;
    let mut total_stat_bonuses = [0.0; 5];
    let mut total_energy_reduction = 0.0;
    let mut card_sp_bonus = 0.0;

    for &card_idx in &present_cards {
        let card = cards[card_idx];
        let level = card_levels[card_idx];

        total_training_effectiveness += card.training_effectiveness(level);

        if snapshot.friendship[card_idx] >= FRIENDSHIP_THRESHOLD {
            friendship_product *= 1.0 + card.friendship_bonus(level);
        }

        for stat_idx in 0..5 {
            total_stat_bonuses[stat_idx] += card.stat_bonus(stat_idx, level);
        }

        total_energy_reduction += card.energy_cost_reduction(level);
        card_sp_bonus += card.effect_value(EffectType::SkillPointBonus, level);
    }

    // Multiplier chain
    let mood_mult = snapshot.mood.multiplier(mood_effect_up_sum);
    let training_eff_mult = 1.0 + total_training_effectiveness;

    // Calculate per-stat gains
    let mut stat_gains = [0.0; 5];
    for s in 0..5 {
        let base_stat = base[s];
        if base_stat > 0.0 {
            // raw = base × mood × (1+TE) × friendship_product
            let raw = base_stat * mood_mult * training_eff_mult * friendship_product;

            // post_growth = floor(floor(raw) × (1 + growth_rate))
            let growth_rate = trainee.growth_rate(s);
            let raw_floored = raw.floor();
            let after_growth = (raw_floored * (1.0 + growth_rate)).floor();

            // Add flat stat bonuses from cards
            stat_gains[s] = after_growth + total_stat_bonuses[s];
        }
    }

    // SP gain: floor(base_sp × (1+TE)) + n_partners + card_sp_bonus
    let sp_gain = if base_sp > 0.0 {
        (base_sp * training_eff_mult).floor() + (present_cards.len() as f64) + card_sp_bonus
    } else {
        0.0
    };

    // Energy cost (base + card reductions)
    let energy_change = if base_energy < 0.0 {
        (base_energy + total_energy_reduction).min(-1.0)
    } else {
        base_energy
    };

    // Failure rate
    let energy_after = snapshot.energy + energy_change;
    let fail_rate = failure_rate(energy_after, facility_idx == 4);

    // Friendship gains for present cards
    let friendship_gains = present_cards
        .iter()
        .map(|&idx| {
            let current = snapshot.friendship[idx];
            let gain = FRIENDSHIP_GAIN_PER_TRAIN.min(MAX_FRIENDSHIP - current);
            gain.max(0.0)
        })
        .collect();

    FacilityPreview {
        facility: facility_idx,
        stat_gains,
        sp_gain,
        energy_change,
        failure_rate: fail_rate,
        present_cards,
        friendship_gains,
    }
}

/// Compute the mood_effect_up sum from all deck cards (not just present ones).
pub fn compute_mood_effect_up(cards: &[&SupportCard], card_levels: &[i32]) -> f64 {
    cards
        .iter()
        .enumerate()
        .map(|(i, card)| card.effect_value(EffectType::MoodEffect, card_levels[i]))
        .sum()
}

// ─── Event Application ──────────────────────────────────────────────────────

/// Which calendar events should fire before a given turn.
/// Returns a list of suggested GameEvents the player can confirm/modify.
pub fn pending_events_for_turn(
    session: &CareerSession,
    turn_number: u32,
    calendar: &CalendarTurn,
) -> Vec<GameEvent> {
    let mut events = Vec::new();

    // Spark of Inspiration: April Classic & Senior — server-rolled from legacy (see `umamusume.md`).
    if let Some(phase) = calendar.inheritance_spark_phase() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(spark_seed(session.id, turn_number as u64 + 9000));
        let ev = build_april_spark_event(
            session.config.legacy.as_ref(),
            session.latest_snapshot(),
            phase,
            &mut rng,
        );
        events.push(ev);
    }

    // New Year event (January of each year)
    if calendar.is_new_year_event() {
        events.push(GameEvent::NewYear {
            energy_gained: 20.0,
            sp_gained: 15.0,
        });
    }

    // Summer camp start (first turn of July in Classic/Senior)
    if calendar.is_summer_camp()
        && calendar.month == 7
        && calendar.half == Half::First
    {
        events.push(GameEvent::SummerCampStart);
    }

    events
}

/// Apply a game event to a snapshot and produce an EventRecord.
///
/// This is a pure function — it clones the snapshot, applies the event, and
/// returns the record. The caller pushes it into the session timeline.
pub fn apply_event(
    session: &CareerSession,
    event: GameEvent,
) -> EventRecord {
    let turn_number = session.current_turn();
    let calendar = CalendarTurn::from_turn(turn_number);
    let mut snapshot = session.latest_snapshot().clone();

    match &event {
        GameEvent::SparkOfInspiration {
            stat_gains,
            sp_gained,
            hint_deltas,
            aptitude_deltas,
            ..
        } => {
            for s in 0..5 {
                snapshot.stats[s] += stat_gains[s];
            }
            snapshot.skill_points += sp_gained;
            for d in hint_deltas {
                let e = snapshot.hint_levels.entry(d.skill_id).or_insert(0);
                *e = (*e + d.levels).min(5);
            }
            for d in aptitude_deltas {
                snapshot.aptitudes.insert(d.key.clone(), d.to_grade.clone());
            }
        }
        GameEvent::NewYear { energy_gained, sp_gained } => {
            snapshot.energy = (snapshot.energy + energy_gained).min(MAX_ENERGY);
            snapshot.skill_points += sp_gained;
        }
        GameEvent::SummerCampStart => {
            // Summer camp itself doesn't change stats — it just flags that
            // facilities are level 5 for the duration (handled in training calc).
            // But we record it as a visible timeline entry.
        }
        GameEvent::CustomEvent {
            stat_gains,
            sp_gained,
            energy_gained,
            mood_change,
            ..
        } => {
            if let Some(gains) = stat_gains {
                for s in 0..5 {
                    snapshot.stats[s] += gains[s];
                }
            }
            if let Some(sp) = sp_gained {
                snapshot.skill_points += sp;
            }
            if let Some(energy) = energy_gained {
                snapshot.energy = (snapshot.energy + energy).min(MAX_ENERGY).max(0.0);
            }
            if let Some(change) = mood_change {
                snapshot.mood = apply_mood_change(snapshot.mood, *change);
            }
        }
        GameEvent::BuySkill { skill_id, name, level, sp_cost } => {
            snapshot.skill_points -= sp_cost;
            if let Some(existing) = snapshot.learned_skills.iter_mut().find(|s| s.skill_id == *skill_id) {
                existing.level = existing.level.max(*level);
            } else {
                snapshot.learned_skills.push(LearnedSkill {
                    skill_id: *skill_id,
                    name: name.clone(),
                    level: *level,
                });
            }
        }
        GameEvent::AcquireItem { item_id, name, quantity } => {
            if let Some(existing) = snapshot.items.iter_mut().find(|it| it.item_id == *item_id) {
                existing.quantity = existing.quantity.saturating_add(*quantity);
            } else {
                snapshot.items.push(HeldItem {
                    item_id: *item_id,
                    name: name.clone(),
                    quantity: *quantity,
                });
            }
        }
    }

    EventRecord {
        at_turn: turn_number,
        calendar,
        event,
        state_after: snapshot,
    }
}

/// Shift mood up or down by the given amount (-2 to +2).
fn apply_mood_change(mood: Mood, change: i8) -> Mood {
    let current = match mood {
        Mood::VeryBad => 0i8,
        Mood::Bad => 1,
        Mood::Normal => 2,
        Mood::Good => 3,
        Mood::VeryGood => 4,
    };
    let new_val = (current + change).max(0).min(4);
    match new_val {
        0 => Mood::VeryBad,
        1 => Mood::Bad,
        2 => Mood::Normal,
        3 => Mood::Good,
        _ => Mood::VeryGood,
    }
}

// ─── Turn Preview ───────────────────────────────────────────────────────────

/// Generate a full turn preview: pending events + facility previews.
pub fn preview_turn(
    session: &CareerSession,
    card_placements: &[usize; 6],
    cards: &[&SupportCard],
    card_levels: &[i32],
    trainee: &Trainee,
) -> TurnPreview {
    let turn_number = session.current_turn();
    let calendar = CalendarTurn::from_turn(turn_number);
    let snapshot = session.latest_snapshot();
    let is_summer = calendar.is_summer_camp();

    // Compute mood effect up from full deck
    let mood_effect_up = compute_mood_effect_up(cards, card_levels);

    // Which events should fire before this turn
    let pending_events = pending_events_for_turn(session, turn_number, &calendar);

    // Evaluate all 5 facilities
    let facility_previews: Vec<FacilityPreview> = (0..5)
        .map(|f| {
            calculate_training(
                f,
                card_placements,
                cards,
                card_levels,
                snapshot,
                trainee,
                is_summer,
                mood_effect_up,
            )
        })
        .collect();

    // Available actions
    let available_actions = vec![
        "train".to_string(),
        "rest".to_string(),
        "race".to_string(),
        "infirmary".to_string(),
        "recreation".to_string(),
    ];

    TurnPreview {
        turn_number,
        calendar,
        pending_events,
        facility_previews,
        is_summer_camp: is_summer,
        is_mandatory_race: false, // TODO: implement mandatory race schedule
        available_actions,
    }
}

// ─── Turn Execution ─────────────────────────────────────────────────────────

/// Execute a turn action and produce a TurnRecord.
///
/// This is a pure function — it clones the latest snapshot, applies the action,
/// and returns the record. The caller pushes it into the session timeline.
///
/// IMPORTANT: Events should be submitted as separate EventRecords BEFORE this
/// turn is executed. This function does NOT auto-apply pre-turn events.
pub fn execute_turn(
    session: &CareerSession,
    action: TurnAction,
    card_placements: [usize; 6],
    cards: &[&SupportCard],
    card_levels: &[i32],
    trainee: &Trainee,
    training_failed: bool,       // Did the training fail? (player reports this)
    rest_energy: Option<f64>,    // How much energy was recovered from rest
) -> TurnRecord {
    let turn_number = session.current_turn();
    let calendar = CalendarTurn::from_turn(turn_number);
    let mut snapshot = session.latest_snapshot().clone();
    let is_summer = calendar.is_summer_camp();
    let n_cards = cards.len().min(6);

    // Compute mood effect up from full deck
    let mood_effect_up = compute_mood_effect_up(cards, card_levels);
    let mut training_detail = None;

    match &action {
        TurnAction::Pending => {
            panic!("execute_turn called with Pending action");
        }
        TurnAction::Train { facility } => {
            let facility_idx = *facility;
            let preview = calculate_training(
                facility_idx,
                &card_placements,
                cards,
                card_levels,
                &snapshot,
                trainee,
                is_summer,
                mood_effect_up,
            );

            if training_failed {
                // Failed training: energy cost applies, mood may drop, no stat gains
                snapshot.energy = (snapshot.energy + preview.energy_change).max(0.0);
                training_detail = Some(TrainingDetail {
                    stat_gains: [0.0; 5],
                    sp_gain: 0.0,
                    energy_change: preview.energy_change,
                    failed: true,
                    failure_rate: preview.failure_rate,
                    present_card_indices: preview.present_cards,
                    friendship_gains: vec![],
                });
            } else {
                // Successful training: apply all gains
                for s in 0..5 {
                    snapshot.stats[s] += preview.stat_gains[s];
                }
                snapshot.skill_points += preview.sp_gain;
                snapshot.energy =
                    (snapshot.energy + preview.energy_change).clamp(0.0, MAX_ENERGY);

                // Level up facility
                snapshot.facility_trains[facility_idx] += 1;
                let new_level =
                    (snapshot.facility_trains[facility_idx] / TRAINS_PER_FACILITY_LEVEL) + 1;
                snapshot.facility_levels[facility_idx] =
                    new_level.min(MAX_FACILITY_LEVEL);

                // Update friendship for present cards
                let mut f_gains = Vec::new();
                for &card_idx in &preview.present_cards {
                    if card_idx < n_cards {
                        let gain = FRIENDSHIP_GAIN_PER_TRAIN
                            .min(MAX_FRIENDSHIP - snapshot.friendship[card_idx]);
                        snapshot.friendship[card_idx] += gain.max(0.0);
                        f_gains.push(gain.max(0.0));
                    }
                }

                training_detail = Some(TrainingDetail {
                    stat_gains: preview.stat_gains,
                    sp_gain: preview.sp_gain,
                    energy_change: preview.energy_change,
                    failed: false,
                    failure_rate: preview.failure_rate,
                    present_card_indices: preview.present_cards,
                    friendship_gains: f_gains,
                });
            }
        }

        TurnAction::Rest => {
            if is_summer {
                // Summer rest: guaranteed 35 energy + mood upgrade
                snapshot.energy =
                    (snapshot.energy + SUMMER_REST_ENERGY_GAIN).min(MAX_ENERGY);
                snapshot.mood = apply_mood_change(snapshot.mood, 1);
            } else if let Some(energy) = rest_energy {
                // Player reports how much energy was recovered
                snapshot.energy = (snapshot.energy + energy).min(MAX_ENERGY);
            } else {
                // Default: assume 50 energy (most common outcome)
                snapshot.energy = (snapshot.energy + 50.0).min(MAX_ENERGY);
            }
        }

        TurnAction::Race { .. } => {
            // Race rewards are variable — player will input specific gains.
            // For now, apply base race effects.
            snapshot.skill_points += 45.0;
            snapshot.races_run += 1;
        }

        TurnAction::Infirmary => {
            // Remove all negative conditions
            snapshot.conditions.retain(|c| {
                !matches!(
                    c,
                    Condition::PracticePoor
                        | Condition::Migraine
                        | Condition::SkinOutbreak
                        | Condition::NightOwl
                        | Condition::SlowMetabolism
                        | Condition::Slacker
                        | Condition::UnderTheWeather
                        | Condition::NotReady
                        | Condition::LegsOfGlass
                )
            });
            snapshot.energy = (snapshot.energy + 10.0).min(MAX_ENERGY);
        }

        TurnAction::Recreation => {
            snapshot.mood = apply_mood_change(snapshot.mood, 1);
            snapshot.energy = (snapshot.energy + 5.0).min(MAX_ENERGY);
        }
    }

    TurnRecord {
        turn_number,
        calendar,
        action,
        card_placements,
        state_after: snapshot,
        training_detail,
    }
}

// ─── Spark of Inspiration (inheritance events; see `umamusume.md`) ───────────

const GRADE_LADDER: [&str; 8] = ["G", "F", "E", "D", "C", "B", "A", "S"];

pub fn spark_seed(session_id: Uuid, salt: u64) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in session_id.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h ^ salt.wrapping_mul(0x9e3779b97f4a7c15)
}

fn grade_to_index(g: &str) -> usize {
    let u = g.trim().to_uppercase();
    GRADE_LADDER
        .iter()
        .position(|x| *x == u.as_str())
        .unwrap_or(0)
}

/// Raise aptitude by `steps` rungs; `max_index` 6 = cap A at career start, 7 = allow S mid-career.
pub fn raise_aptitude_grade(current: &str, steps: u32, max_index: usize) -> String {
    let mut i = grade_to_index(current);
    let cap = max_index.min(GRADE_LADDER.len() - 1);
    i = (i + steps as usize).min(cap);
    GRADE_LADDER[i].to_string()
}

fn career_start_aptitude_steps(total_points: u32) -> u32 {
    match total_points {
        0 => 0,
        1..=3 => 1,
        4..=6 => 2,
        7..=9 => 3,
        _ => 4,
    }
}

fn apt_grade(snapshot: &TurnSnapshot, key: &str) -> String {
    snapshot
        .aptitudes
        .get(key)
        .cloned()
        .unwrap_or_else(|| "G".to_string())
}

/// First spark: fixed blues from `inheritance_stats`, deterministic red aptitudes (max A), rolled hints.
pub fn build_career_start_spark_event(
    legacy: Option<&LegacyConfig>,
    inheritance_stats: &StatBlock,
    baseline_aptitudes: &HashMap<String, String>,
    rng: &mut impl Rng,
) -> GameEvent {
    let stat_gains = [
        inheritance_stats.speed,
        inheritance_stats.stamina,
        inheritance_stats.power,
        inheritance_stats.guts,
        inheritance_stats.wisdom,
    ];
    let mut hint_deltas: Vec<SparkHintDelta> = Vec::new();
    let mut hint_acc: HashMap<u32, u8> = HashMap::new();
    if let Some(leg) = legacy {
        for (skill_id, stars) in leg.all_skill_factors() {
            let (min, max) = Factor::spark_hint_range(stars);
            let lv = if max > 0 { rng.gen_range(min..=max) } else { 0 };
            if lv > 0 {
                let e = hint_acc.entry(skill_id).or_insert(0);
                *e = (*e + lv).min(5);
            }
        }
        for (skill_id, levels) in hint_acc {
            hint_deltas.push(SparkHintDelta { skill_id, levels });
        }
    }
    let mut aptitude_deltas = Vec::new();
    if let Some(leg) = legacy {
        let mut pts_by: HashMap<String, u32> = HashMap::new();
        for slot in [&leg.legacy_1, &leg.legacy_2] {
            for member in [&slot.parent, &slot.grandparent_1, &slot.grandparent_2] {
                for factor in &member.factors {
                    if let Factor::Aptitude { apt_name, stars } = factor {
                        let k = normalize_apt_key(apt_name);
                        *pts_by.entry(k).or_insert(0) += (*stars).min(3) as u32;
                    }
                }
            }
        }
        for (key, pts) in pts_by {
            let steps = career_start_aptitude_steps(pts);
            if steps == 0 {
                continue;
            }
            let from = baseline_aptitudes
                .get(&key)
                .cloned()
                .unwrap_or_else(|| "G".to_string());
            let to = raise_aptitude_grade(&from, steps, 6);
            if to != from {
                aptitude_deltas.push(AptitudeDelta {
                    key,
                    from_grade: from,
                    to_grade: to,
                });
            }
        }
    }
    GameEvent::SparkOfInspiration {
        phase: SparkPhase::CareerStart,
        stat_gains,
        sp_gained: 0.0,
        hint_deltas,
        aptitude_deltas,
    }
}

/// April Classic / Senior: stochastic blues, skill hints, red aptitude (+N grades).
pub fn build_april_spark_event(
    legacy: Option<&LegacyConfig>,
    snapshot: &TurnSnapshot,
    phase: SparkPhase,
    rng: &mut impl Rng,
) -> GameEvent {
    let mut stat_gains = [0.0_f64; 5];
    let mut hint_deltas: Vec<SparkHintDelta> = Vec::new();
    let mut hint_acc: HashMap<u32, u8> = HashMap::new();
    let mut aptitude_deltas = Vec::new();
    if let Some(leg) = legacy {
        for &(stat_idx, stars, rate) in &leg.all_blue_spark_rolls() {
            if stat_idx < 5 && rng.gen_bool(rate) {
                let (lo, hi) = Factor::spark_stat_range(stars);
                let lo_i = lo.floor() as i32;
                let hi_i = hi.floor() as i32;
                if hi_i >= lo_i {
                    stat_gains[stat_idx] += rng.gen_range(lo_i..=hi_i) as f64;
                }
            }
        }
        for &(skill_id, stars, rate) in &leg.all_skill_spark_rolls() {
            if rng.gen_bool(rate) {
                let (min, max) = Factor::spark_hint_range(stars);
                if max > 0 {
                    let lv = rng.gen_range(min..=max);
                    if lv > 0 {
                        let cur = snapshot.hint_levels.get(&skill_id).copied().unwrap_or(0);
                        let add = lv.min(5u8.saturating_sub(cur));
                        if add > 0 {
                            let e = hint_acc.entry(skill_id).or_insert(0);
                            *e = (*e + add).min(5);
                        }
                    }
                }
            }
        }
        for (skill_id, lv) in hint_acc {
            if lv > 0 {
                hint_deltas.push(SparkHintDelta { skill_id, levels: lv });
            }
        }
        let mut apt_procs: HashMap<String, u32> = HashMap::new();
        for (key, _stars, rate) in leg.all_aptitude_spark_rolls() {
            if rng.gen_bool(rate) {
                *apt_procs.entry(key).or_insert(0) += 1;
            }
        }
        for (key, n) in apt_procs {
            let from = apt_grade(snapshot, &key);
            let to = raise_aptitude_grade(&from, n, 7);
            if to != from {
                aptitude_deltas.push(AptitudeDelta {
                    key,
                    from_grade: from,
                    to_grade: to,
                });
            }
        }
    }
    GameEvent::SparkOfInspiration {
        phase,
        stat_gains,
        sp_gained: 20.0,
        hint_deltas,
        aptitude_deltas,
    }
}
