use crate::models::*;
use crate::models::deck::{StatSources, STAT_NAMES};
use crate::algorithms::traits::Optimizer;

/// V2 Expected Value Optimizer — energy-aware with facility allocation.
///
/// Improvements over V1:
///
/// 1. **Energy simulation**: Models the train→rest cycle turn by turn.
///    Cards with EnergyCostReduction lower the energy drain; cards with
///    EventRecovery add energy back over the career; FailureProtection
///    reduces wasted turns from training failures.
///
/// 2. **Training failure**: Failure probability rises as energy drops.
///    The model integrates expected failure rate across the energy curve
///    to compute effective (successful) training turns.
///
/// 3. **Facility allocation**: Instead of summing all 5 facilities'
///    EV simultaneously, allocates training turns across facilities
///    proportional to `stat_weights`. Stat bonuses only apply when
///    training at the facility that produces that stat.
///
/// 4. **Card events**: EventRecovery restores energy; EventEffectiveness
///    provides bonus stats from card story events (~3-4 per card/career).
///
/// 5. **Wisdom training**: Modeled with lower energy cost and partial
///    energy recovery, reducing the need for rest turns.
pub struct ExpectedValueV2Optimizer;

impl ExpectedValueV2Optimizer {
    pub fn new() -> Self { Self }
}

// ─── Constants ───────────────────────────────────────────────────────────────

/// Base primary stat gain per training at each facility (level 3 average).
/// [speed, stamina, power, guts, wisdom]
const BASE_PRIMARY: [f64; 5] = [10.0, 9.0, 9.0, 9.0, 8.0];

/// Base secondary stat gain for physical facilities.
const BASE_SECONDARY: f64 = 4.0;
/// Wisdom facility's secondary gain is slightly lower.
const WISDOM_SECONDARY: f64 = 3.0;

/// Energy system constants.
const MAX_ENERGY: f64 = 100.0;
/// Energy cost per training at physical facilities (speed/stamina/power/guts).
const PHYSICAL_ENERGY_COST: f64 = 21.0;
/// Net energy cost for wisdom training (lower cost + partial energy recovery).
const WISDOM_NET_ENERGY_COST: f64 = 10.0;
/// Energy recovered per rest turn.
const REST_RECOVERY: f64 = 50.0;
/// Energy threshold below which the player should rest.
const REST_THRESHOLD: f64 = 30.0;

/// Turns lost to mandatory scheduled races and scripted events.
const MANDATORY_TURNS: f64 = 5.0;

/// Expected number of story/card events fired per card across a 72-turn career.
/// Each event can give stats, energy, or mood. Typically 3-4 events per card.
const EVENTS_PER_CARD: f64 = 3.5;

/// Base stat gain from card events (before EventEffectiveness multiplier).
const EVENT_BASE_STAT_GAIN: f64 = 5.0;

/// Mood bonus: good mood adds ~20% to training gains.
/// We assume the player maintains good mood for most of the career.
const BASE_MOOD_FRACTION: f64 = 0.2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Training facility layout: which stats each facility provides.
fn facility_layout(facility: usize) -> (usize, &'static [usize]) {
    match facility {
        0 => (0, &[2]),    // Speed → primary=speed, secondary=power
        1 => (1, &[3]),    // Stamina → primary=stamina, secondary=guts
        2 => (2, &[1]),    // Power → primary=power, secondary=stamina
        3 => (3, &[2]),    // Guts → primary=guts, secondary=power
        4 => (4, &[0]),    // Wisdom → primary=wisdom, secondary=speed
        _ => (0, &[]),
    }
}

fn specialty_probability(specialty_priority: f64) -> f64 {
    let base = 100.0;
    let total = base * 5.0 + 50.0 + specialty_priority;
    (base + specialty_priority) / total
}

fn non_specialty_probability(specialty_priority: f64) -> f64 {
    let base = 100.0;
    let total = base * 5.0 + 50.0 + specialty_priority;
    base / total
}

fn turns_to_friendship(initial_friendship: f64) -> f64 {
    let remaining = (80.0 - initial_friendship).max(0.0);
    (remaining / (5.0 * 0.6)).ceil()
}

/// Training failure probability as a function of current energy level.
/// Returns 0.0 (no failures) at high energy, rises steeply below ~30.
fn base_failure_rate(energy: f64) -> f64 {
    if energy >= 70.0 {
        0.0
    } else if energy >= 50.0 {
        // 0-4% range
        0.02 + (70.0 - energy) * 0.001
    } else if energy >= 30.0 {
        // 4-28% range
        0.04 + (50.0 - energy) * 0.012
    } else {
        // 28%+ — steeply rising
        0.28 + (30.0 - energy) * 0.022
    }
}

/// Simulate the energy cycle over `available_turns` and return
/// the effective (successful) training turns, rest turns, and
/// per-facility allocation.
///
/// The simulation is deterministic: at each turn it decides train vs rest
/// based on current energy, then accumulates expected successful training
/// (1 - failure_rate) rather than rolling dice.
fn simulate_turn_budget(
    total_turns: f64,
    facility_fractions: &[f64; 5],
    energy_cost_reduction: f64,
    failure_protection_pct: f64,
    total_event_recovery: f64,
) -> TurnBudget {
    let available = (total_turns - MANDATORY_TURNS) as usize;

    // Weighted average energy cost based on facility allocation
    let phys_fraction: f64 = 1.0 - facility_fractions[4];
    let eff_phys_cost = (PHYSICAL_ENERGY_COST - energy_cost_reduction).max(5.0);
    let eff_wisdom_cost = (WISDOM_NET_ENERGY_COST - energy_cost_reduction * 0.5).max(2.0);
    let avg_cost = eff_phys_cost * phys_fraction + eff_wisdom_cost * facility_fractions[4];

    // Spread event recovery across all turns
    let recovery_per_turn = total_event_recovery / (available as f64).max(1.0);

    let mut energy = MAX_ENERGY;
    let mut effective_training = 0.0_f64;
    let mut rest_turns = 0.0_f64;

    for _ in 0..available {
        if energy <= REST_THRESHOLD {
            // Rest turn
            energy = (energy + REST_RECOVERY).min(MAX_ENERGY);
            rest_turns += 1.0;
        } else {
            // Training turn
            let raw_fail = base_failure_rate(energy);
            let fail = (raw_fail * (1.0 - failure_protection_pct / 100.0)).clamp(0.0, 1.0);
            effective_training += 1.0 - fail;
            energy -= avg_cost;
            energy += recovery_per_turn;
        }
    }

    // Distribute effective training turns across facilities
    let mut allocation = [0.0_f64; 5];
    for f in 0..5 {
        allocation[f] = effective_training * facility_fractions[f];
    }

    TurnBudget {
        effective_training_turns: effective_training,
        rest_turns,
        facility_allocation: allocation,
    }
}

struct TurnBudget {
    effective_training_turns: f64,
    rest_turns: f64,
    facility_allocation: [f64; 5],
}

// ─── V2 Optimizer ────────────────────────────────────────────────────────────

impl Optimizer for ExpectedValueV2Optimizer {
    fn id(&self) -> &str { "expected_value_v2" }
    fn name(&self) -> &str { "Expected Value V2" }
    fn description(&self) -> &str {
        "Energy-aware scoring with facility allocation. Models the train/rest \
         cycle, training failures, card events (energy + stats), and per-facility \
         stat bonuses. More accurate than V1 for comparing decks with different \
         energy management profiles."
    }

    fn score_deck(
        &self,
        trainee: &Trainee,
        deck_cards: &[&SupportCard],
        deck_levels: &[i32],
        config: &ScenarioConfig,
    ) -> DeckScore {
        let n = deck_cards.len();
        let turns = config.turns as f64;
        let mut warnings = Vec::new();
        let mut explanation = Vec::new();

        // ─── Phase 1: Collect card properties ────────────────────────────────
        let card_props: Vec<CardProps> = (0..n)
            .map(|i| CardProps {
                card_type_idx: deck_cards[i].primary_stat_index(),
                friendship_bonus: deck_cards[i].friendship_bonus(deck_levels[i]),
                training_effectiveness: deck_cards[i].training_effectiveness(deck_levels[i]),
                mood_effect: deck_cards[i].mood_effect(deck_levels[i]),
                specialty_priority: deck_cards[i].specialty_priority(deck_levels[i]),
                initial_friendship: deck_cards[i].initial_friendship(deck_levels[i]),
                stat_bonuses: [
                    deck_cards[i].stat_bonus(0, deck_levels[i]),
                    deck_cards[i].stat_bonus(1, deck_levels[i]),
                    deck_cards[i].stat_bonus(2, deck_levels[i]),
                    deck_cards[i].stat_bonus(3, deck_levels[i]),
                    deck_cards[i].stat_bonus(4, deck_levels[i]),
                ],
                event_recovery: deck_cards[i].event_recovery(deck_levels[i]),
                event_effectiveness: deck_cards[i].event_effectiveness(deck_levels[i]),
                failure_protection: deck_cards[i].failure_protection(deck_levels[i]),
                energy_cost_reduction: deck_cards[i].energy_cost_reduction(deck_levels[i]),
            })
            .collect();

        let friendship_turns: Vec<f64> = card_props
            .iter()
            .map(|p| turns_to_friendship(p.initial_friendship))
            .collect();

        // ─── Phase 2: Initial stats from cards + trainee ─────────────────────
        let mut initial_stats = StatBlock::default();
        for i in 0..n {
            for s in 0..5 {
                initial_stats[s] += deck_cards[i].initial_stat(s, deck_levels[i]);
            }
        }
        let starting = trainee.starting_stats(config.star_rank);
        for s in 0..5 {
            initial_stats[s] += starting[s];
        }

        // ─── Phase 3: Compute energy-related deck totals ─────────────────────
        let total_energy_cost_reduction: f64 = card_props.iter()
            .map(|p| p.energy_cost_reduction).sum();
        let total_failure_protection: f64 = card_props.iter()
            .map(|p| p.failure_protection).sum();
        let total_event_recovery: f64 = card_props.iter()
            .map(|p| p.event_recovery * EVENTS_PER_CARD).sum();
        let total_event_effectiveness: f64 = card_props.iter()
            .map(|p| p.event_effectiveness).sum();

        // ─── Phase 4: Determine facility allocation ──────────────────────────
        // Distribute training time proportional to stat weights.
        let weight_sum: f64 = config.stat_weights.iter().sum();
        let mut facility_fractions = [0.0_f64; 5];
        for f in 0..5 {
            facility_fractions[f] = config.stat_weights[f] / weight_sum;
        }

        // ─── Phase 5: Simulate energy cycle → turn budget ────────────────────
        let budget = simulate_turn_budget(
            turns,
            &facility_fractions,
            total_energy_cost_reduction,
            total_failure_protection,
            total_event_recovery,
        );

        explanation.push(format!(
            "Turn budget: {:.1} effective training, {:.0} rest, {:.0} mandatory (of {:.0} total)",
            budget.effective_training_turns, budget.rest_turns, MANDATORY_TURNS, turns
        ));
        for f in 0..5 {
            explanation.push(format!(
                "  {} facility: {:.1} turns ({:.0}%)",
                STAT_NAMES[f], budget.facility_allocation[f],
                facility_fractions[f] * 100.0
            ));
        }

        // ─── Phase 6: Per-facility training EV ───────────────────────────────
        // For each facility, compute the expected stat gain PER TURN at that
        // facility, then multiply by allocated turns.
        let mut training_ev = StatBlock::default();

        for facility in 0..5 {
            let (primary_stat, secondary_stats) = facility_layout(facility);
            let allocated_turns = budget.facility_allocation[facility];
            if allocated_turns < 0.01 { continue; }

            // Probability each card is present at this facility
            let presence_prob: Vec<f64> = (0..n)
                .map(|i| {
                    if card_props[i].card_type_idx == Some(facility) {
                        specialty_probability(card_props[i].specialty_priority)
                    } else if card_props[i].card_type_idx.is_some() {
                        non_specialty_probability(card_props[i].specialty_priority)
                    } else {
                        1.0 / 6.0 // friend/group cards
                    }
                })
                .collect();

            let expected_cards_present: f64 = presence_prob.iter().sum();

            // Expected flat stat bonus — ONLY for stats this facility produces
            let expected_primary_bonus: f64 = (0..n)
                .map(|i| presence_prob[i] * card_props[i].stat_bonuses[primary_stat])
                .sum();

            // Training effectiveness (additive)
            let expected_te: f64 = (0..n)
                .map(|i| presence_prob[i] * card_props[i].training_effectiveness)
                .sum();

            // Mood effect
            let expected_mood_effect: f64 = (0..n)
                .map(|i| presence_prob[i] * card_props[i].mood_effect)
                .sum();
            let mood_multiplier = 1.0 + BASE_MOOD_FRACTION * (1.0 + expected_mood_effect);

            // Friendship bonus — multiplicative product for specialty cards at this facility
            let expected_friendship_product: f64 = {
                let mut product = 1.0;
                for i in 0..n {
                    // Only cards at this facility can contribute friendship bonus
                    let active_fraction =
                        ((turns - friendship_turns[i]) / turns).clamp(0.0, 1.0);
                    let p_active = presence_prob[i] * active_fraction;
                    if p_active > 0.001 && card_props[i].friendship_bonus > 0.0 {
                        product *= 1.0 + p_active * card_props[i].friendship_bonus;
                    }
                }
                product
            };

            // Per-card presence bonus: 5% per card present
            let presence_bonus = 1.0 + 0.05 * expected_cards_present;

            // Growth rate
            let growth_mult = 1.0 + trainee.growth_rate(primary_stat);

            // Primary stat gain per turn at this facility
            let primary_base = BASE_PRIMARY[facility] + expected_primary_bonus;
            let primary_per_turn = primary_base
                * mood_multiplier
                * (1.0 + expected_te)
                * expected_friendship_product
                * presence_bonus
                * growth_mult;

            training_ev[primary_stat] += primary_per_turn * allocated_turns;

            // Secondary stat gains
            let sec_base_value = if facility == 4 { WISDOM_SECONDARY } else { BASE_SECONDARY };
            for &sec_stat in secondary_stats {
                let expected_sec_bonus: f64 = (0..n)
                    .map(|i| presence_prob[i] * card_props[i].stat_bonuses[sec_stat])
                    .sum();
                let sec_growth = 1.0 + trainee.growth_rate(sec_stat);
                let sec_per_turn = (sec_base_value + expected_sec_bonus)
                    * mood_multiplier
                    * (1.0 + expected_te)
                    * expected_friendship_product
                    * presence_bonus
                    * sec_growth;
                training_ev[sec_stat] += sec_per_turn * allocated_turns;
            }
        }

        // ─── Phase 7: Card event stat contributions ──────────────────────────
        // Cards fire ~3.5 events each, which give base stats boosted by
        // EventEffectiveness. Distribute across all 5 stats evenly (events
        // tend to give the card's specialty stat, but this is a simplification).
        let mut event_stats = StatBlock::default();
        let event_multiplier = 1.0 + total_event_effectiveness;
        for s in 0..5 {
            // Each card contributes some event stats, weighted toward their specialty
            for i in 0..n {
                let events = EVENTS_PER_CARD;
                let base_gain = EVENT_BASE_STAT_GAIN * event_multiplier;
                if card_props[i].card_type_idx == Some(s) {
                    // Specialty card: more event stats for this stat
                    event_stats[s] += events * base_gain * 0.6;
                } else {
                    // Non-specialty: smaller contribution
                    event_stats[s] += events * base_gain * 0.1;
                }
            }
        }

        // ─── Phase 8: Project final stats ────────────────────────────────────
        let mut projected_stats = StatBlock::default();
        for s in 0..5 {
            let raw = initial_stats[s] + training_ev[s] + event_stats[s];
            projected_stats[s] = raw.min(config.stat_caps[s]);
        }

        // ─── Phase 9: Race bonus stats ───────────────────────────────────────
        let total_race_bonus: f64 = (0..n)
            .map(|i| deck_cards[i].race_bonus(deck_levels[i]))
            .sum();

        let race_bonus_stats = if total_race_bonus > 0.0 {
            let race_turns = if config.scenario == "trackblazer" { 30.0 } else { 8.0 };
            let base_race_gain = 5.0;
            let mut rbs = StatBlock::default();
            for s in 0..5 {
                rbs[s] = race_turns * base_race_gain * total_race_bonus;
                projected_stats[s] = (projected_stats[s] + rbs[s]).min(config.stat_caps[s]);
            }
            rbs
        } else {
            StatBlock::default()
        };

        // ─── Phase 10: Constraint checks ─────────────────────────────────────
        let min_stamina = config.effective_min_stamina();
        let stamina_ok = projected_stats.stamina >= min_stamina;
        if !stamina_ok {
            warnings.push(format!(
                "Stamina {:.0} below {:.0} threshold for {} {}",
                projected_stats.stamina, min_stamina,
                config.target_distance, config.target_strategy
            ));
        }

        if let Some(min_rb) = config.min_race_bonus {
            if total_race_bonus < min_rb {
                warnings.push(format!(
                    "Race Bonus {:.0}% below {:.0}% threshold for Trackblazer",
                    total_race_bonus * 100.0, min_rb * 100.0
                ));
            }
        }

        // ─── Phase 11: Compute fitness ───────────────────────────────────────
        let mut fitness = 0.0;
        for s in 0..5 {
            fitness += projected_stats[s] * config.stat_weights[s];
        }

        // Penalties
        if !stamina_ok {
            let ratio = projected_stats.stamina / min_stamina;
            fitness *= ratio * 0.5;
        }
        if let Some(min_rb) = config.min_race_bonus {
            if total_race_bonus < min_rb {
                let ratio = total_race_bonus / min_rb;
                fitness *= ratio * 0.7;
            }
        }

        // Bonus for energy efficiency: decks that need fewer rest turns
        // get more training time. This is already captured in the turn budget,
        // but we add a small explicit bonus to help the GA distinguish.
        let rest_efficiency = 1.0 - (budget.rest_turns / turns);
        fitness *= 1.0 + rest_efficiency * 0.02; // up to ~2% bonus for efficient decks

        // Balance bonus (same as V1)
        let stat_variance = {
            let mean = projected_stats.total() / 5.0;
            let var: f64 = (0..5).map(|s| (projected_stats[s] - mean).powi(2)).sum::<f64>() / 5.0;
            var.sqrt()
        };
        fitness += (1000.0 - stat_variance).max(0.0) * 0.05;

        // ─── Build explanation ────────────────────────────────────────────────
        explanation.push(format!("Total projected stats: {:.0}", projected_stats.total()));
        for s in 0..5 {
            explanation.push(format!(
                "  {}: {:.0} (initial {:.0} + training {:.0} + events {:.0})",
                STAT_NAMES[s], projected_stats[s], initial_stats[s],
                training_ev[s], event_stats[s]
            ));
        }
        explanation.push(format!(
            "Energy mgmt: cost reduction {:.0}, failure protection {:.0}%, event recovery {:.0}",
            total_energy_cost_reduction, total_failure_protection, total_event_recovery
        ));
        explanation.push(format!("Race Bonus: {:.0}%", total_race_bonus * 100.0));

        DeckScore {
            deck: Deck {
                cards: (0..n).map(|i| (deck_cards[i].id, deck_levels[i])).collect(),
            },
            projected_stats,
            fitness,
            stat_sources: StatSources {
                initial_stats,
                training_expected_value: training_ev,
                race_bonus_stats,
            },
            warnings,
            explanation,
        }
    }

    fn simulate_turn(
        &self,
        _trainee: &Trainee,
        _deck_cards: &[&SupportCard],
        _deck_levels: &[i32],
        _config: &ScenarioConfig,
        _state: &RunState,
    ) -> TurnResult {
        panic!("simulate_turn not implemented for expected_value_v2")
    }
}

/// Pre-computed card properties for fast access during scoring.
struct CardProps {
    card_type_idx: Option<usize>,
    friendship_bonus: f64,
    training_effectiveness: f64,
    mood_effect: f64,
    specialty_priority: f64,
    initial_friendship: f64,
    stat_bonuses: [f64; 5],
    // V2 additions
    event_recovery: f64,
    event_effectiveness: f64,
    failure_protection: f64,
    energy_cost_reduction: f64,
}
