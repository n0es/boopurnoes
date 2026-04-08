pub mod trainee;
pub mod support_card;
pub mod deck;
pub mod config;
pub mod career;
pub mod session;
pub mod engine;

pub use trainee::Trainee;
pub use support_card::{SupportCard, SupportCardEffect, EffectType};
pub use deck::{Deck, DeckScore, StatBlock, RunState, TurnResult};
pub use config::{
    ScenarioConfig, Factor,
};
pub use career::{CareerConfig, CareerInitialState, Scenario, Mood};
pub use session::{
    CareerSession, TurnSnapshot, TurnRecord, TurnAction, TimelineEntry,
    EventRecord, GameEvent, CalendarTurn, Condition, TrainingDetail, Year, Half,
};
pub use engine::{FacilityPreview, TurnPreview};
