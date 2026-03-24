use crate::models::{Deck, DeckScore, ScenarioConfig, SupportCard, Trainee};

/// The core trait that all optimizer algorithms must implement.
///
/// To add a new algorithm:
/// 1. Create a new file in `src/algorithms/` (e.g., `monte_carlo.rs`)
/// 2. Implement this trait
/// 3. Register it in `AlgorithmRegistry` (see `api/mod.rs`)
///
/// The trait is intentionally simple — just one method. All complexity
/// lives inside each implementation.
pub trait Optimizer: Send + Sync {
    /// Unique identifier for this algorithm.
    fn id(&self) -> &str;

    /// Human-readable name.
    fn name(&self) -> &str;

    /// Short description of the approach.
    fn description(&self) -> &str;

    /// Score a single deck for a given trainee and config.
    ///
    /// This is the fitness function called by the genetic search.
    /// It should be fast — it gets called thousands of times per optimization.
    ///
    /// # Arguments
    /// * `trainee` - The trainee being built
    /// * `deck_cards` - The 6 support cards in the deck (pre-resolved from IDs)
    /// * `deck_levels` - The level of each card (parallel with deck_cards)
    /// * `config` - Scenario config (distance, strategy, caps, etc.)
    ///
    /// # Returns
    /// A `DeckScore` with projected stats, fitness, and explanations.
    fn score_deck(
        &self,
        trainee: &Trainee,
        deck_cards: &[&SupportCard],
        deck_levels: &[i32],
        config: &ScenarioConfig,
    ) -> DeckScore;
}
