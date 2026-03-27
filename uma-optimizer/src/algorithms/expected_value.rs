use crate::models::*;
use crate::models::deck::{StatSources, STAT_NAMES};
use crate::algorithms::traits::Optimizer;

/// Deterministic expected-value scorer.
///
/// This algorithm calculates the mathematically expected stat gains over
/// a 72-turn training simulation without any randomness. It uses the exact
/// formulas from the game:
///
/// For each training turn, the stat gain for facility `f` is:
///   result = (base_f + sum(stat_bonus_i)) * (1 + mood * (1 + sum(mood_effect_i)))
///            * (1 + sum(training_effectiveness_i))
///            * product(1 + friendship_bonus_i)  [for cards at ≥80% friendship]
///            * (1 + 0.05 * num_cards_present)
///            * (1 + growth_rate)
///
/// The expected value weights each turn's output by the probability of
/// each card appearing at that facility (via Specialty Priority).
pub struct ExpectedValueOptimizer;

impl ExpectedValueOptimizer {
    pub fn new() -> Self {
        Self
    }
}

/// Base stat gains per facility level. Index = stat (0-4), columns = [lv1, lv2, lv3, lv4, lv5].
/// These are approximate base values for the primary stat of each training facility.
const BASE_PRIMARY: [f64; 5] = [10.0, 10.0, 10.0, 10.0, 10.0]; // level 3 average
const BASE_SECONDARY: f64 = 4.0; // secondary stat gain at a facility

/// Training facility layout: which stats each facility provides.
/// Index = facility (0-4 = speed/stamina/power/guts/wisdom).
/// Returns (primary_stat_index, secondary_stat_indices).
fn facility_layout(facility: usize) -> (usize, Vec<usize>) {
    match facility {
        0 => (0, vec![2]),       // Speed facility: primary=speed, secondary=power
        1 => (1, vec![3]),       // Stamina facility: primary=stamina, secondary=guts
        2 => (2, vec![1]),       // Power facility: primary=power, secondary=stamina
        3 => (3, vec![2]),       // Guts facility: primary=guts, secondary=power
        4 => (4, vec![0]),       // Wisdom facility: primary=wisdom, secondary=speed
        _ => (0, vec![]),
    }
}

/// Calculate the probability of a card appearing at its specialty facility on any given turn.
/// Based on the weighted ratio system from the document.
fn specialty_probability(specialty_priority: f64) -> f64 {
    // Base weights: 100 per facility (5) + 50 for rest = 550 total
    let base_facility_weight = 100.0;
    let rest_weight = 50.0;
    let total_base = base_facility_weight * 5.0 + rest_weight; // 550

    let specialty_weight = base_facility_weight + specialty_priority;
    let total_weight = total_base + specialty_priority;

    specialty_weight / total_weight
}

/// Calculate the probability of a card appearing at a non-specialty facility.
fn non_specialty_probability(specialty_priority: f64) -> f64 {
    let base_facility_weight = 100.0;
    let rest_weight = 50.0;
    let total_weight = base_facility_weight * 5.0 + rest_weight + specialty_priority;

    base_facility_weight / total_weight
}

/// Estimate turns until a card reaches 80% friendship threshold.
/// Higher initial friendship = fewer turns needed.
fn turns_to_friendship(initial_friendship: f64) -> f64 {
    // Friendship gauge goes from 0 to 100 (80% = threshold).
    // Each interaction adds ~4-7 points. Initial friendship provides a head start.
    let remaining = (80.0 - initial_friendship).max(0.0);
    // Rough estimate: ~5 friendship per interaction, ~60% chance to interact per turn
    (remaining / (5.0 * 0.6)).ceil()
}

impl Optimizer for ExpectedValueOptimizer {
    fn id(&self) -> &str { "expected_value" }
    fn name(&self) -> &str { "Expected Value" }
    fn description(&self) -> &str {
        "Deterministic scoring using exact training formulas. \
         Calculates weighted expected stat gains over 72 turns based on \
         Specialty Priority probabilities and multiplicative Friendship Bonuses. \
         Fast and consistent — no randomness."
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

        // ─── Phase 1: Collect initial stats from cards ─────────────────────
        let mut initial_stats = StatBlock::default();
        for i in 0..n {
            for s in 0..5 {
                initial_stats[s] += deck_cards[i].initial_stat(s, deck_levels[i]);
            }
        }

        // Add trainee starting stats based on their star rank
        let starting = trainee.starting_stats(config.star_rank);
        for s in 0..5 {
            initial_stats[s] += starting[s];
        }

        // ─── Phase 2: Compute expected training value per turn ─────────────
        //
        // For each facility, calculate the expected stat gain per turn,
        // weighted by the probability of each card being present.
        let mut training_ev = StatBlock::default();

        // Pre-compute per-card properties at their levels
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
            })
            .collect();

        // Estimate turns of friendship availability for each card
        let friendship_turns: Vec<f64> = card_props
            .iter()
            .map(|p| turns_to_friendship(p.initial_friendship))
            .collect();

        // For each facility, compute expected gain
        for facility in 0..5 {
            let (primary_stat, secondary_stats) = facility_layout(facility);

            // Which cards have this facility as their specialty?
            let specialty_cards: Vec<usize> = (0..n)
                .filter(|&i| card_props[i].card_type_idx == Some(facility))
                .collect();

            // Probability each card is present at this facility
            let presence_prob: Vec<f64> = (0..n)
                .map(|i| {
                    if card_props[i].card_type_idx == Some(facility) {
                        specialty_probability(card_props[i].specialty_priority)
                    } else if card_props[i].card_type_idx.is_some() {
                        non_specialty_probability(card_props[i].specialty_priority)
                    } else {
                        // friend/group cards: roughly 1/6 chance per facility
                        1.0 / 6.0
                    }
                })
                .collect();

            // Expected number of cards at this facility
            let expected_cards_present: f64 = presence_prob.iter().sum();

            // Expected flat stat bonuses from present cards
            let expected_stat_bonus = |stat: usize| -> f64 {
                (0..n).map(|i| presence_prob[i] * card_props[i].stat_bonuses[stat]).sum::<f64>()
            };

            // Expected training effectiveness (additive, from present cards)
            let expected_te: f64 = (0..n)
                .map(|i| presence_prob[i] * card_props[i].training_effectiveness)
                .sum();

            // Expected mood effect
            let expected_mood_effect: f64 = (0..n)
                .map(|i| presence_prob[i] * card_props[i].mood_effect)
                .sum();
            // Mood scalar: base 0.2 * (1 + sum of mood effects)
            let mood_multiplier = 1.0 + 0.2 * (1.0 + expected_mood_effect);

            // Friendship bonus — multiplicative, but we need to estimate the
            // expected product. For specialty cards at this facility with high
            // presence probability, use the log-expected-product approximation.
            let _friendship_active_turns = turns as f64 * 0.65; // ~65% of career has friendship
            let expected_friendship_product: f64 = {
                let mut product = 1.0;
                for &i in &specialty_cards {
                    // Weight: probability of being present AND having friendship
                    let active_fraction =
                        ((turns - friendship_turns[i]) / turns).clamp(0.0, 1.0);
                    let p_present_and_active = presence_prob[i] * active_fraction;
                    // E[product of (1+fb)] ≈ product of (1 + p * fb)
                    // This is a first-order approximation; good enough for deterministic scoring.
                    product *= 1.0 + p_present_and_active * card_props[i].friendship_bonus;
                }
                product
            };

            // Per-card presence bonus: 5% per card present
            let presence_bonus = 1.0 + 0.05 * expected_cards_present;

            // Combine all multipliers for primary stat
            let primary_base = BASE_PRIMARY[facility] + expected_stat_bonus(primary_stat);
            let growth_mult = 1.0 + trainee.growth_rate(primary_stat);

            let primary_gain = primary_base
                * mood_multiplier
                * (1.0 + expected_te)
                * expected_friendship_product
                * presence_bonus
                * growth_mult;

            training_ev[primary_stat] += primary_gain;

            // Secondary stat gains
            for &sec_stat in &secondary_stats {
                let sec_base = BASE_SECONDARY + expected_stat_bonus(sec_stat);
                let sec_growth = 1.0 + trainee.growth_rate(sec_stat);
                let sec_gain = sec_base
                    * mood_multiplier
                    * (1.0 + expected_te)
                    * expected_friendship_product
                    * presence_bonus
                    * sec_growth;
                training_ev[sec_stat] += sec_gain;
            }
        }

        // ─── Phase 3: Project over simulation turns ─────────────────────────
        // Not all turns are training turns. Estimate ~55 training turns out of 72
        // (rest are races, events, rest, etc.).
        let training_turns = (turns * 0.76).floor(); // ~55 turns of training
        let mut projected_stats = StatBlock::default();
        for s in 0..5 {
            let raw = initial_stats[s] + training_ev[s] * training_turns;
            projected_stats[s] = raw.min(config.stat_caps[s]);
        }

        // ─── Phase 4: Apply race bonus stats (for Trackblazer etc.) ─────────
        let total_race_bonus: f64 = (0..n)
            .map(|i| deck_cards[i].race_bonus(deck_levels[i]))
            .sum();

        let race_bonus_stats = if total_race_bonus > 0.0 {
            // In Trackblazer, ~30 races × race_bonus × base_race_gain
            let race_turns = if config.scenario == "trackblazer" { 30.0 } else { 8.0 };
            let base_race_gain = 5.0; // approximate stat per race per stat
            let mut rbs = StatBlock::default();
            for s in 0..5 {
                rbs[s] = race_turns * base_race_gain * total_race_bonus;
            }
            // Add to projected stats
            for s in 0..5 {
                projected_stats[s] = (projected_stats[s] + rbs[s]).min(config.stat_caps[s]);
            }
            rbs
        } else {
            StatBlock::default()
        };

        // ─── Phase 5: Constraint checks ─────────────────────────────────────
        let min_stamina = config.effective_min_stamina();
        let stamina_ok = projected_stats.stamina >= min_stamina;
        if !stamina_ok {
            warnings.push(format!(
                "Stamina {:.0} is below the {:.0} threshold for {} {}",
                projected_stats.stamina, min_stamina,
                config.target_distance, config.target_strategy
            ));
        }

        // Race bonus check for Trackblazer
        if let Some(min_rb) = config.min_race_bonus {
            if total_race_bonus < min_rb {
                warnings.push(format!(
                    "Race Bonus {:.0}% is below the {:.0}% threshold for Trackblazer",
                    total_race_bonus * 100.0, min_rb * 100.0
                ));
            }
        }

        // ─── Phase 6: Compute fitness score ─────────────────────────────────
        let mut fitness = 0.0;
        for s in 0..5 {
            fitness += projected_stats[s] * config.stat_weights[s];
        }

        // Penalties
        if !stamina_ok {
            // Harsh penalty: scale fitness by how far below threshold
            let ratio = projected_stats.stamina / min_stamina;
            fitness *= ratio * 0.5; // heavy penalty
        }

        if let Some(min_rb) = config.min_race_bonus {
            if total_race_bonus < min_rb {
                let ratio = total_race_bonus / min_rb;
                fitness *= ratio * 0.7;
            }
        }

        // Bonus for balanced decks that cover multiple stats
        let stat_variance = {
            let mean = projected_stats.total() / 5.0;
            let var: f64 = (0..5).map(|s| (projected_stats[s] - mean).powi(2)).sum::<f64>() / 5.0;
            var.sqrt()
        };
        // Slight bonus for lower variance (more balanced), but don't penalize specialization heavily
        fitness += (1000.0 - stat_variance).max(0.0) * 0.05;

        // ─── Build explanation ──────────────────────────────────────────────
        explanation.push(format!("Total projected stats: {:.0}", projected_stats.total()));
        for s in 0..5 {
            explanation.push(format!(
                "  {}: {:.0} (initial: {:.0}, training EV: {:.0}×{:.0} turns)",
                STAT_NAMES[s], projected_stats[s], initial_stats[s],
                training_ev[s], training_turns
            ));
        }
        explanation.push(format!("Friendship product amplifiers by facility:"));
        for facility in 0..5 {
            let specialty_count = (0..n)
                .filter(|&i| card_props[i].card_type_idx == Some(facility))
                .count();
            explanation.push(format!("  {} facility: {} specialty cards", STAT_NAMES[facility], specialty_count));
        }
        explanation.push(format!("Total Race Bonus: {:.0}%", total_race_bonus * 100.0));

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
        panic!("simulate_turn not implemented for expected_value")
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
}
