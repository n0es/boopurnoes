use rand::distributions::{Distribution, WeightedIndex};
use rand::prelude::*;
use rayon::prelude::*;
use crate::models::*;
use crate::algorithms::traits::Optimizer;

const NUM_SIMULATIONS: i32 = 1000;
const FRIENDSHIP_THRESHOLD: f64 = 80.0;
const MAX_ENERGY: f64 = 100.0;
const REST_ENERGY_GAIN: f64 = 50.0;
const BASE_TRAINING_ENERGY_COST: f64 = 20.0;
const BASE_WISDOM_ENERGY_RECOVERY: f64 = 7.0;

// Base stat gains per facility level (level 5).
const BASE_PRIMARY: [f64; 5] = [11.0, 11.0, 11.0, 11.0, 11.0];
const BASE_SECONDARY: f64 = 5.0;

pub struct MonteCarloOptimizer;

impl MonteCarloOptimizer {
    pub fn new() -> Self {
        Self
    }
}

/// Holds the dynamic state for a single simulation run.
#[derive(Clone, Copy)]
struct SimulationState {
    stats: [f64; 5],
    energy: f64,
    // Friendship gauge for each of the 6 deck cards
    friendship: [f64; 6],
}

impl SimulationState {
    fn new(initial_stats: [f64; 5], initial_friendship: &[f64]) -> Self {
        let mut friendship = [0.0; 6];
        friendship.copy_from_slice(initial_friendship);
        Self {
            stats: initial_stats,
            energy: MAX_ENERGY,
            friendship,
        }
    }
}

/// Calculates the stat gain for a given training, using the exact game formulas.
fn calculate_potential_gain(
    facility_idx: usize,
    card_locations: &[usize; 6],
    deck_cards: &[&SupportCard],
    deck_levels: &[i32],
    sim_state: &SimulationState,
    trainee: &Trainee,
) -> [f64; 5] {
    let mut gains = [0.0; 5];
    let (primary_stat, secondary_stats) = facility_layout(facility_idx);

    // Get cards present at this facility
    let present_cards: Vec<usize> = card_locations.iter().enumerate()
        .filter(|&(_, &loc)| loc == facility_idx)
        .map(|(i, _)| i)
        .collect();

    // --- Calculate multipliers ---
    let mut total_training_effectiveness = 0.0;
    let mut friendship_product = 1.0;
    let mut total_stat_bonuses = [0.0; 5];
    
    for &card_idx in &present_cards {
        let card_level = deck_levels[card_idx];
        total_training_effectiveness += deck_cards[card_idx].training_effectiveness(card_level);
        
        if sim_state.friendship[card_idx] >= FRIENDSHIP_THRESHOLD {
            friendship_product *= 1.0 + deck_cards[card_idx].friendship_bonus(card_level);
        }

        for stat_idx in 0..5 {
            total_stat_bonuses[stat_idx] += deck_cards[card_idx].stat_bonus(stat_idx, card_level);
        }
    }
    
    // Mood is assumed to be good (20% bonus)
    let mood_multiplier = 1.20;
    let training_eff_multiplier = 1.0 + total_training_effectiveness;
    let presence_bonus = 1.0 + 0.05 * present_cards.len() as f64;

    // --- Apply to primary stat ---
    let primary_base = BASE_PRIMARY[primary_stat] + total_stat_bonuses[primary_stat];
    let growth_mult = 1.0 + trainee.growth_rate(primary_stat);
    gains[primary_stat] = primary_base
        * mood_multiplier
        * training_eff_multiplier
        * friendship_product
        * presence_bonus
        * growth_mult;

    // --- Apply to secondary stats ---
    for sec_stat in secondary_stats {
        let sec_base = BASE_SECONDARY + total_stat_bonuses[sec_stat];
        let sec_growth = 1.0 + trainee.growth_rate(sec_stat);
        gains[sec_stat] = sec_base
            * mood_multiplier
            * training_eff_multiplier
            * friendship_product
            * presence_bonus
            * sec_growth;
    }
    
    gains
}

/// Helper to map facility index to stats.
fn facility_layout(facility: usize) -> (usize, Vec<usize>) {
    match facility {
        0 => (0, vec![2]), // Speed facility: primary=speed, secondary=power
        1 => (1, vec![3]), // Stamina facility: primary=stamina, secondary=guts
        2 => (2, vec![1]), // Power facility: primary=power, secondary=stamina
        3 => (3, vec![2]), // Guts facility: primary=guts, secondary=power
        4 => (4, vec![0]), // Wisdom facility: primary=wisdom, secondary=speed
        _ => (0, vec![]),
    }
}

impl Optimizer for MonteCarloOptimizer {
    fn id(&self) -> &str { "monte_carlo" }
    fn name(&self) -> &str { "Monte Carlo Simulation" }
    fn description(&self) -> &str {
        "Runs thousands of randomized training simulations in parallel to accurately model
         non-linear, combinatorial effects like Friendship Bonus stacking. More accurate
         than expected value, and much faster on multi-core CPUs."
    }

    fn score_deck(
        &self,
        trainee: &Trainee,
        deck_cards: &[&SupportCard],
        deck_levels: &[i32],
        config: &ScenarioConfig,
    ) -> DeckScore {
        let n_cards = deck_cards.len();

        let initial_stats = {
            let mut s = trainee.starting_stats(config.star_rank);
            for i in 0..n_cards {
                for stat_idx in 0..5 {
                    s[stat_idx] += deck_cards[i].initial_stat(stat_idx, deck_levels[i]);
                }
            }
            s
        };

        let initial_friendship: Vec<f64> = (0..n_cards)
            .map(|i| deck_cards[i].initial_friendship(deck_levels[i]))
            .collect();

        let total_final_stats: [f64; 5] = (0..NUM_SIMULATIONS)
            .into_par_iter()
            .map(|_| {
                // Each thread needs its own RNG
                let mut rng = thread_rng();
                let mut sim = SimulationState::new(initial_stats, &initial_friendship);

                for _turn in 0..config.turns {
                    // 1. Card Placement Step
                    let mut card_locations: [usize; 6] = [0; 6];
                    for i in 0..n_cards {
                        let card = deck_cards[i];
                        let specialty_prio = card.specialty_priority(deck_levels[i]);
                        
                        let mut weights = [100.0; 6];
                        weights[5] = 50.0;

                        if let Some(spec_idx) = card.primary_stat_index() {
                            weights[spec_idx] += specialty_prio;
                        } else {
                            let even_split = specialty_prio / 5.0;
                            for w in weights.iter_mut().take(5) { *w += even_split; }
                        }

                        let dist = match WeightedIndex::new(&weights) {
                            Ok(d) => d,
                            Err(_) => {
                                card_locations[i] = rng.gen_range(0..6);
                                continue;
                            }
                        };
                        card_locations[i] = dist.sample(&mut rng);
                    }

                    // 2. Player Heuristic Step
                    let should_rest = sim.energy < 40.0;

                    if should_rest {
                        sim.energy = (sim.energy + REST_ENERGY_GAIN).min(MAX_ENERGY);
                        continue;
                    }

                    let mut best_facility = 0;
                    let mut max_weighted_gain = -1.0;

                    for facility_idx in 0..5 {
                        let potential_gain = calculate_potential_gain(
                            facility_idx, &card_locations, deck_cards, deck_levels, &sim, trainee,
                        );
                        let weighted_gain: f64 = potential_gain.iter().enumerate()
                            .map(|(i, &g)| g * config.stat_weights[i])
                            .sum();

                        if weighted_gain > max_weighted_gain {
                            max_weighted_gain = weighted_gain;
                            best_facility = facility_idx;
                        }
                    }
                    
                    // 3. Execute Training Step
                    let actual_gain = calculate_potential_gain(
                        best_facility, &card_locations, deck_cards, deck_levels, &sim, trainee,
                    );

                    for i in 0..5 { sim.stats[i] += actual_gain[i]; }

                    let energy_cost = if best_facility == 4 {
                        (BASE_TRAINING_ENERGY_COST / 2.0).max(1.0) - BASE_WISDOM_ENERGY_RECOVERY
                    } else {
                        BASE_TRAINING_ENERGY_COST
                    };
                    sim.energy = (sim.energy - energy_cost).max(0.0);

                    for (card_idx, &loc) in card_locations.iter().enumerate() {
                        if loc == best_facility {
                            sim.friendship[card_idx] = (sim.friendship[card_idx] + 10.0).min(100.0);
                        }
                    }
                } // End of turn loop
                sim.stats
            }) // End of map
            .reduce(
                || [0.0; 5], // Identity: array of zeros
                |mut a, b| { // Reducer: sum the arrays
                    for i in 0..5 { a[i] += b[i]; }
                    a
                },
            ); // End of reduce

        // Average the stats
        let mut projected_stats = StatBlock::default();
        for i in 0..5 {
            projected_stats[i] = (total_final_stats[i] / NUM_SIMULATIONS as f64).min(config.stat_caps[i]);
        }
        
        // --- Fitness Calculation (similar to V1/V2) ---
        let mut fitness = 0.0;
        for s in 0..5 {
            fitness += projected_stats[s] * config.stat_weights[s];
        }

        let min_stamina = config.effective_min_stamina();
        if projected_stats.stamina < min_stamina {
            fitness *= 0.5; // Penalty
        }

        DeckScore {
            deck: Deck {
                cards: (0..n_cards).map(|i| (deck_cards[i].id, deck_levels[i])).collect(),
            },
            projected_stats,
            fitness,
            stat_sources: Default::default(),
            warnings: vec!["Monte Carlo V2 (Parallel)".to_string()],
            explanation: vec![format!(
                "Projected stats after {} parallel simulations.", NUM_SIMULATIONS
            )],
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
        panic!("simulate_turn not implemented for monte_carlo")
    }
}
