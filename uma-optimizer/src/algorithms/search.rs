use rand::prelude::*;
use std::collections::HashMap;

use crate::algorithms::traits::Optimizer;
use crate::models::*;
use crate::models::config::SearchParams;

/// Genetic algorithm search that finds the best 6-card deck.
///
/// Uses any `Optimizer` implementation as the fitness function.
/// The search is agnostic to how scoring works — swap in a Monte Carlo
/// scorer and the search logic stays the same.
pub struct GeneticSearch;

/// A chromosome = a candidate deck (6 card indices into the card pool).
#[derive(Clone)]
struct Chromosome {
    /// Indices into the card pool (not card IDs).
    genes: Vec<usize>,
    fitness: f64,
}

impl GeneticSearch {
    /// Run the genetic algorithm to find optimal decks.
    ///
    /// # Arguments
    /// * `optimizer` - The scoring algorithm to use as fitness function
    /// * `trainee` - The trainee to optimize for
    /// * `card_pool` - All available cards (pre-filtered by ownership etc.)
    /// * `card_levels` - Level for each card in the pool (parallel indexing)
    /// * `locked` - Card pool indices that must appear in every deck
    /// * `config` - Scenario configuration
    /// * `params` - GA parameters (population size, generations, etc.)
    pub fn run(
        optimizer: &dyn Optimizer,
        trainee: &Trainee,
        card_pool: &[SupportCard],
        card_levels: &[i32],
        locked: &[usize],
        config: &ScenarioConfig,
        params: &SearchParams,
    ) -> Vec<DeckScore> {
        let deck_size = 6;
        let free_slots = deck_size - locked.len();

        if card_pool.len() < deck_size {
            return vec![];
        }

        let mut rng = thread_rng();

        // ─── Build index sets ───────────────────────────────────────────
        // Cards available for free slots (exclude locked cards)
        let free_indices: Vec<usize> = (0..card_pool.len())
            .filter(|i| !locked.contains(i))
            .collect();

        if free_indices.len() < free_slots {
            return vec![];
        }

        // ─── Greedy initialization ──────────────────────────────────────
        // Seed the initial population with heuristic-based decks
        // rather than purely random ones.
        let mut population: Vec<Chromosome> = Vec::with_capacity(params.population_size);

        // First: generate greedy-seeded decks based on card type distribution
        let type_groups = group_by_type(card_pool, &free_indices);
        let target_dist = archetype_template(&config.target_distance);

        // Create a few greedy decks using the archetype template
        for _ in 0..(params.population_size / 4).max(10) {
            if let Some(genes) = greedy_deck(
                &type_groups,
                &target_dist,
                locked,
                free_slots,
                card_pool,
                card_levels,
                &mut rng,
            ) {
                population.push(Chromosome { genes, fitness: 0.0 });
            }
        }

        // Fill remaining with random decks
        while population.len() < params.population_size {
            let genes = random_deck(locked, &free_indices, free_slots, &mut rng);
            population.push(Chromosome { genes, fitness: 0.0 });
        }

        // ─── Evaluate initial population ────────────────────────────────
        let mut total_evaluated = 0usize;
        for chromo in &mut population {
            chromo.fitness = evaluate(optimizer, trainee, card_pool, card_levels, &chromo.genes, config);
            total_evaluated += 1;
        }

        // ─── Evolution loop ─────────────────────────────────────────────
        let mut best_ever = population
            .iter()
            .max_by(|a, b| a.fitness.partial_cmp(&b.fitness).unwrap())
            .cloned()
            .unwrap();

        for _gen in 0..params.generations {
            // Sort by fitness (descending)
            population.sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap());

            let mut new_pop = Vec::with_capacity(params.population_size);

            // Elitism: keep top 10%
            let elite_count = (params.population_size / 10).max(2);
            new_pop.extend_from_slice(&population[..elite_count]);

            // Generate rest through crossover + mutation
            while new_pop.len() < params.population_size {
                // Tournament selection
                let parent_a = tournament_select(&population, 3, &mut rng);
                let parent_b = tournament_select(&population, 3, &mut rng);

                // Crossover
                let mut child = crossover(&parent_a, &parent_b, locked, &mut rng);

                // Mutation
                if rng.gen::<f64>() < params.mutation_rate {
                    mutate(&mut child, locked, &free_indices, &mut rng);
                }

                // Repair: ensure no duplicate cards
                repair_duplicates(&mut child, locked, &free_indices, &mut rng);

                // Evaluate
                child.fitness = evaluate(optimizer, trainee, card_pool, card_levels, &child.genes, config);
                total_evaluated += 1;

                if child.fitness > best_ever.fitness {
                    best_ever = child.clone();
                }

                new_pop.push(child);
            }

            population = new_pop;
        }

        // ─── Collect top N results ──────────────────────────────────────
        population.sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap());

        // Deduplicate (same card set = same deck)
        let mut seen = std::collections::HashSet::new();
        let mut results = Vec::new();

        for chromo in &population {
            let mut key = chromo.genes.clone();
            key.sort();
            if seen.insert(key) {
                let score = full_score(optimizer, trainee, card_pool, card_levels, &chromo.genes, config);
                results.push(score);
                if results.len() >= params.top_n {
                    break;
                }
            }
        }

        results
    }
}

// ─── Helper functions ───────────────────────────────────────────────────────

fn evaluate(
    optimizer: &dyn Optimizer,
    trainee: &Trainee,
    card_pool: &[SupportCard],
    card_levels: &[i32],
    genes: &[usize],
    config: &ScenarioConfig,
) -> f64 {
    let cards: Vec<&SupportCard> = genes.iter().map(|&i| &card_pool[i]).collect();
    let levels: Vec<i32> = genes.iter().map(|&i| card_levels[i]).collect();
    optimizer.score_deck(trainee, &cards, &levels, config).fitness
}

fn full_score(
    optimizer: &dyn Optimizer,
    trainee: &Trainee,
    card_pool: &[SupportCard],
    card_levels: &[i32],
    genes: &[usize],
    config: &ScenarioConfig,
) -> DeckScore {
    let cards: Vec<&SupportCard> = genes.iter().map(|&i| &card_pool[i]).collect();
    let levels: Vec<i32> = genes.iter().map(|&i| card_levels[i]).collect();
    optimizer.score_deck(trainee, &cards, &levels, config)
}

fn random_deck(
    locked: &[usize],
    free_indices: &[usize],
    free_slots: usize,
    rng: &mut impl Rng,
) -> Vec<usize> {
    let mut genes = locked.to_vec();
    let mut available = free_indices.to_vec();
    available.shuffle(rng);
    genes.extend(available.iter().take(free_slots));
    genes
}

fn tournament_select<'a>(
    population: &'a [Chromosome],
    tournament_size: usize,
    rng: &mut impl Rng,
) -> &'a Chromosome {
    let mut best: Option<&Chromosome> = None;
    for _ in 0..tournament_size {
        let idx = rng.gen_range(0..population.len());
        let candidate = &population[idx];
        if best.is_none() || candidate.fitness > best.unwrap().fitness {
            best = Some(candidate);
        }
    }
    best.unwrap()
}

fn crossover(
    parent_a: &Chromosome,
    parent_b: &Chromosome,
    locked: &[usize],
    rng: &mut impl Rng,
) -> Chromosome {
    // Uniform crossover: for each free slot, randomly pick from parent A or B
    let mut genes = locked.to_vec();
    let free_a: Vec<usize> = parent_a.genes.iter().filter(|g| !locked.contains(g)).copied().collect();
    let free_b: Vec<usize> = parent_b.genes.iter().filter(|g| !locked.contains(g)).copied().collect();

    let target = parent_a.genes.len() - locked.len();
    for i in 0..target {
        let gene = if rng.gen::<bool>() {
            free_a.get(i).or_else(|| free_b.get(i)).copied()
        } else {
            free_b.get(i).or_else(|| free_a.get(i)).copied()
        };
        if let Some(g) = gene {
            genes.push(g);
        }
    }

    Chromosome { genes, fitness: 0.0 }
}

fn mutate(
    chromo: &mut Chromosome,
    locked: &[usize],
    free_indices: &[usize],
    rng: &mut impl Rng,
) {
    // Replace one random free gene with a random card from the pool
    let free_positions: Vec<usize> = (0..chromo.genes.len())
        .filter(|i| !locked.contains(&chromo.genes[*i]))
        .collect();

    if free_positions.is_empty() || free_indices.is_empty() {
        return;
    }

    let pos = free_positions[rng.gen_range(0..free_positions.len())];
    let new_gene = free_indices[rng.gen_range(0..free_indices.len())];
    chromo.genes[pos] = new_gene;
}

fn repair_duplicates(
    chromo: &mut Chromosome,
    locked: &[usize],
    free_indices: &[usize],
    rng: &mut impl Rng,
) {
    // Ensure no duplicate card pool indices
    let mut seen = std::collections::HashSet::new();
    for i in 0..chromo.genes.len() {
        if !seen.insert(chromo.genes[i]) {
            // Duplicate found: replace with a random unused card
            for _ in 0..100 {
                let replacement = free_indices[rng.gen_range(0..free_indices.len())];
                if seen.insert(replacement) {
                    chromo.genes[i] = replacement;
                    break;
                }
            }
        }
    }
}

/// Group card pool indices by card type.
fn group_by_type(card_pool: &[SupportCard], indices: &[usize]) -> HashMap<String, Vec<usize>> {
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for &i in indices {
        groups
            .entry(card_pool[i].card_type.clone())
            .or_default()
            .push(i);
    }
    groups
}

/// Archetype template: how many cards of each type for a given distance.
/// Returns map of card_type -> desired count.
fn archetype_template(distance: &str) -> HashMap<String, usize> {
    let mut t = HashMap::new();
    match distance {
        "short" | "sprint" => {
            t.insert("speed".into(), 3);
            t.insert("power".into(), 2);
            t.insert("intelligence".into(), 1);
        }
        "mile" => {
            t.insert("speed".into(), 3);
            t.insert("power".into(), 1);
            t.insert("stamina".into(), 1);
            t.insert("intelligence".into(), 1);
        }
        "mid" | "medium" => {
            t.insert("speed".into(), 2);
            t.insert("stamina".into(), 2);
            t.insert("power".into(), 1);
            t.insert("intelligence".into(), 1);
        }
        "long" => {
            t.insert("speed".into(), 2);
            t.insert("stamina".into(), 3);
            t.insert("intelligence".into(), 1);
        }
        _ => {
            t.insert("speed".into(), 2);
            t.insert("stamina".into(), 2);
            t.insert("power".into(), 1);
            t.insert("intelligence".into(), 1);
        }
    }
    t
}

/// Generate a greedy-seeded deck following the archetype template.
/// Picks the highest-value card of each required type.
fn greedy_deck(
    type_groups: &HashMap<String, Vec<usize>>,
    template: &HashMap<String, usize>,
    locked: &[usize],
    free_slots: usize,
    card_pool: &[SupportCard],
    card_levels: &[i32],
    rng: &mut impl Rng,
) -> Option<Vec<usize>> {
    let mut genes = locked.to_vec();
    let mut used: std::collections::HashSet<usize> = locked.iter().copied().collect();

    // Fill according to template
    for (card_type, &count) in template {
        if let Some(indices) = type_groups.get(card_type) {
            // Sort by a quick heuristic: friendship_bonus + training_effectiveness + specialty_priority
            let mut sorted: Vec<usize> = indices.iter()
                .filter(|i| !used.contains(i))
                .copied()
                .collect();
            sorted.sort_by(|&a, &b| {
                let score_a = quick_score(&card_pool[a], card_levels[a]);
                let score_b = quick_score(&card_pool[b], card_levels[b]);
                score_b.partial_cmp(&score_a).unwrap()
            });

            let mut picked = 0;
            for &idx in &sorted {
                if picked >= count || genes.len() - locked.len() >= free_slots {
                    break;
                }
                genes.push(idx);
                used.insert(idx);
                picked += 1;
            }
        }
    }

    // Fill remaining slots randomly
    let all_available: Vec<usize> = (0..card_pool.len())
        .filter(|i| !used.contains(i))
        .collect();
    let mut shuffled = all_available;
    shuffled.shuffle(rng);

    while genes.len() < locked.len() + free_slots {
        if let Some(idx) = shuffled.pop() {
            genes.push(idx);
        } else {
            break;
        }
    }

    if genes.len() == locked.len() + free_slots {
        Some(genes)
    } else {
        None
    }
}

/// Quick heuristic score for greedy initialization (not the full fitness function).
fn quick_score(card: &SupportCard, level: i32) -> f64 {
    card.friendship_bonus(level) * 100.0
        + card.training_effectiveness(level) * 80.0
        + card.specialty_priority(level) * 0.5
        + card.race_bonus(level) * 30.0
}
