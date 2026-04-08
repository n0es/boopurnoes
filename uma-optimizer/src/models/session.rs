use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use super::deck::StatBlock;
use super::career::{CareerConfig, CareerInitialState, Mood, Scenario};

// ─── Calendar System ────────────────────────────────────────────────────────

/// The three years of a training career.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Year {
    Junior,
    Classic,
    Senior,
}

/// Which half of a month a turn falls on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Half {
    First,
    Second,
}

/// Which Spark of Inspiration occurrence (three per run — VIP Wiki / GameTora).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SparkPhase {
    CareerStart,
    AprilClassic,
    AprilSenior,
}

/// One aptitude grade change applied during a spark.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AptitudeDelta {
    pub key: String,
    pub from_grade: String,
    pub to_grade: String,
}

/// Hint levels gained during a spark (merged into `hint_levels`, max 5 per skill).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SparkHintDelta {
    pub skill_id: u32,
    pub levels: u8,
}

/// A specific turn mapped to its calendar position.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CalendarTurn {
    /// 0-indexed turn number (0–77).
    pub turn: u32,
    pub year: Year,
    /// Calendar month (1–12).
    pub month: u8,
    pub half: Half,
}

impl CalendarTurn {
    /// Convert a 0-indexed turn number into a calendar position.
    ///
    /// Turn layout (0-indexed):
    ///   Junior:  Turns 0–23  (Dec Y0 → Nov Y1) — 24 turns
    ///   Classic: Turns 24–47 (Dec Y1 → Nov Y2) — 24 turns
    ///   Senior:  Turns 48–71 (Dec Y2 → Nov Y3) — 24 turns
    ///   Finale:  Turns 72–77 (6 extra turns)
    ///
    /// Each year: Dec(2) + Jan(2) + … + Nov(2) = 12 months × 2 = 24 turns
    pub fn from_turn(turn: u32) -> Self {
        let year_idx = (turn / 24).min(2);
        let turn_in_year = turn % 24;

        let year = match year_idx {
            0 => Year::Junior,
            1 => Year::Classic,
            _ => Year::Senior,
        };

        // Month mapping: turn_in_year 0–1 = December, 2–3 = January, …, 22–23 = November
        let month_offset = turn_in_year / 2;
        let month = if month_offset == 0 {
            12 // December
        } else {
            month_offset as u8 // 1=Jan, 2=Feb, …, 11=Nov
        };

        let half = if turn_in_year % 2 == 0 {
            Half::First
        } else {
            Half::Second
        };

        CalendarTurn { turn, year, month, half }
    }

    /// Is this turn during summer training camp? (July–August, Classic & Senior only)
    pub fn is_summer_camp(&self) -> bool {
        (self.year == Year::Classic || self.year == Year::Senior)
            && (self.month == 7 || self.month == 8)
    }

    /// Is this an inheritance event turn? (First half of April, Classic and Senior)
    pub fn is_inheritance_event(&self) -> bool {
        (self.year == Year::Classic || self.year == Year::Senior)
            && self.month == 4
            && self.half == Half::First
    }

    /// Spark of Inspiration phase when [`is_inheritance_event`] is true.
    pub fn inheritance_spark_phase(&self) -> Option<SparkPhase> {
        if !self.is_inheritance_event() {
            return None;
        }
        match self.year {
            Year::Classic => Some(SparkPhase::AprilClassic),
            Year::Senior => Some(SparkPhase::AprilSenior),
            _ => None,
        }
    }

    /// Is this a New Year event turn? (First half of January)
    pub fn is_new_year_event(&self) -> bool {
        self.month == 1 && self.half == Half::First
    }

    /// Human-readable label, e.g. "Junior Dec (1st)"
    pub fn label(&self) -> String {
        let year_str = match self.year {
            Year::Junior => "Junior",
            Year::Classic => "Classic",
            Year::Senior => "Senior",
        };
        let month_str = match self.month {
            1 => "Jan", 2 => "Feb", 3 => "Mar", 4 => "Apr",
            5 => "May", 6 => "Jun", 7 => "Jul", 8 => "Aug",
            9 => "Sep", 10 => "Oct", 11 => "Nov", 12 => "Dec",
            _ => "???",
        };
        let half_str = match self.half {
            Half::First => "1st",
            Half::Second => "2nd",
        };
        format!("{year_str} {month_str} ({half_str})")
    }
}

// ─── Turn Actions ───────────────────────────────────────────────────────────

/// The possible actions a player can take each turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TurnAction {
    /// Placeholder until the player commits an action for this turn.
    Pending,
    /// Train at a specific facility (0=Speed, 1=Stamina, 2=Power, 3=Guts, 4=Wisdom).
    Train { facility: usize },
    /// Rest to recover energy.
    Rest,
    /// Run a race (mandatory or optional).
    Race { race_id: Option<i32> },
    /// Visit the infirmary (attempt to cure negative conditions).
    Infirmary,
    /// Go on recreation (mood up + chance to cure conditions).
    Recreation,
}

// ─── Conditions ─────────────────────────────────────────────────────────────

/// Conditions that can affect a trainee during a career.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Condition {
    // Positive
    Charming,
    FastLearner,
    PracticePerfect,
    PracticePerfectEx,
    HotTopic,
    ShiningBrightly,
    PositiveThinking,
    LuckyConstitution,
    // Negative
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

// ─── Turn State Snapshot ────────────────────────────────────────────────────

/// A skill the player has purchased with SP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearnedSkill {
    pub skill_id: u32,
    pub name: String,
    pub level: u8,
}

/// An item held by the trainee (Trackblazer / Twinkle Star Climax only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeldItem {
    pub item_id: u32,
    pub name: String,
    pub quantity: u8,
}

/// A complete snapshot of the career state at a specific point in time.
/// Designed to be self-contained so the rollback bar can display any past state
/// without recomputation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnSnapshot {
    /// Stats at this point: [speed, stamina, power, guts, wisdom].
    pub stats: StatBlock,
    /// Skill points accumulated.
    pub skill_points: f64,
    /// Current energy (0–100).
    pub energy: f64,
    /// Current mood.
    pub mood: Mood,
    /// Per-card friendship gauges (0–100 each).
    pub friendship: Vec<f64>,
    /// Per-card spirit gauges (Unity Cup scenario, 0–100).
    pub spirit: Vec<f64>,
    /// Facility levels (1–5 each).
    pub facility_levels: [u32; 5],
    /// Number of times each facility has been trained.
    pub facility_trains: [u32; 5],
    /// Active conditions.
    pub conditions: Vec<Condition>,
    /// Hint levels acquired (skill_id → level 1–5).
    pub hint_levels: HashMap<u32, u8>,
    /// Aptitude letter grades after inheritance (S/A/…/G); keys: turf, mile, leading, …
    #[serde(default)]
    pub aptitudes: HashMap<String, String>,
    /// Skills the player has purchased with SP.
    #[serde(default)]
    pub learned_skills: Vec<LearnedSkill>,
    /// Items held (Trackblazer only; empty for other scenarios).
    #[serde(default)]
    pub items: Vec<HeldItem>,
    /// Total fans accumulated.
    pub total_fans: f64,
    /// Races completed.
    pub races_run: u32,
}

impl TurnSnapshot {
    /// Pre–first-spark baseline: trainee base stats and aptitudes only (blues apply in first Spark event).
    pub fn from_baseline(init: &CareerInitialState, n_cards: usize) -> Self {
        TurnSnapshot {
            stats: init.pre_spark_stats.clone(),
            skill_points: init.sp,
            energy: init.energy,
            mood: init.mood.clone(),
            friendship: init.friendship.clone(),
            spirit: vec![0.0; n_cards],
            facility_levels: [1; 5],
            facility_trains: [0; 5],
            conditions: Vec::new(),
            hint_levels: HashMap::new(),
            aptitudes: init.aptitudes.clone(),
            learned_skills: Vec::new(),
            items: Vec::new(),
            total_fans: 0.0,
            races_run: 0,
        }
    }
}

// ─── Timeline Entries ───────────────────────────────────────────────────────
//
// The career timeline is a flat list of entries that can be either:
//   • TurnRecord  — the player chose an action (train, rest, race, …)
//   • EventRecord — a calendar/game event fired (Spark of Inspiration, New Year, …)
//
// Both carry a `state_after` snapshot so the rollback bar can display any
// point in time without recomputation.  Events happen *between* turns: they
// are inserted before or after the turn they accompany.

/// A single entry in the career timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimelineEntry {
    Turn(TurnRecord),
    Event(EventRecord),
}

impl TimelineEntry {
    /// The snapshot after this entry was applied.
    pub fn state_after(&self) -> &TurnSnapshot {
        match self {
            TimelineEntry::Turn(t) => &t.state_after,
            TimelineEntry::Event(e) => &e.state_after,
        }
    }

    /// A short label for the rollback bar.
    pub fn label(&self) -> String {
        match self {
            TimelineEntry::Turn(t) => t.calendar.label(),
            TimelineEntry::Event(e) => e.event.label(),
        }
    }

    /// Whether this entry is a turn (counts toward the 78-turn total).
    pub fn is_turn(&self) -> bool {
        matches!(self, TimelineEntry::Turn(_))
    }
}

// ─── Turn Record ────────────────────────────────────────────────────────────

/// Records what happened on a single turn — the action taken, the calendar
/// context, and the resulting state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnRecord {
    /// The turn number (0-indexed, counting only turns, not events).
    pub turn_number: u32,
    /// Calendar position for this turn.
    pub calendar: CalendarTurn,
    /// What the player did this turn.
    pub action: TurnAction,
    /// Where each support card was placed this turn (facility 0–4, or 5=away).
    pub card_placements: [usize; 6],
    /// The state AFTER this action was applied.
    pub state_after: TurnSnapshot,
    /// Training result details (if action was Train).
    pub training_detail: Option<TrainingDetail>,
}

// ─── Event Record ───────────────────────────────────────────────────────────

/// A calendar or game event that modifies state between turns.
/// Events are first-class timeline entries, visible in the rollback bar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRecord {
    /// Which turn this event is associated with (the turn it fires before).
    pub at_turn: u32,
    /// Calendar position when the event fires.
    pub calendar: CalendarTurn,
    /// What happened.
    pub event: GameEvent,
    /// The state AFTER this event was applied.
    pub state_after: TurnSnapshot,
}

/// All the game events that can fire between turns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    /// Spark of Inspiration — first run event + two April events (Classic/Senior).
    /// Career-start applies fixed blue totals, deterministic red aptitudes, rolled skill hints;
    /// April sparks roll blue/red/green activations from legacy (see `engine` + `umamusume.md`).
    SparkOfInspiration {
        phase: SparkPhase,
        stat_gains: [f64; 5],
        sp_gained: f64,
        #[serde(default)]
        hint_deltas: Vec<SparkHintDelta>,
        #[serde(default)]
        aptitude_deltas: Vec<AptitudeDelta>,
    },
    /// New Year event — player picks energy recovery or other bonuses.
    NewYear {
        energy_gained: f64,
        sp_gained: f64,
    },
    /// Summer training camp started (facilities forced to level 5).
    SummerCampStart,
    /// Player purchased a skill with SP.
    BuySkill {
        skill_id: u32,
        name: String,
        level: u8,
        sp_cost: f64,
    },
    /// Player acquired an item (Trackblazer / Twinkle Star Climax only).
    AcquireItem {
        item_id: u32,
        name: String,
        #[serde(default = "default_quantity")]
        quantity: u8,
    },
    /// A generic story/card event the player wants to log.
    /// Covers support card events, random encounters, story scenes, etc.
    CustomEvent {
        description: String,
        stat_gains: Option<[f64; 5]>,
        sp_gained: Option<f64>,
        energy_gained: Option<f64>,
        mood_change: Option<i8>,  // +1 = mood up, -1 = mood down
    },
}

fn default_quantity() -> u8 { 1 }

impl GameEvent {
    /// Short label for timeline display.
    pub fn label(&self) -> String {
        match self {
            GameEvent::SparkOfInspiration { phase, .. } => match phase {
                SparkPhase::CareerStart => "Spark of Inspiration (Start)".to_string(),
                SparkPhase::AprilClassic => "Spark of Inspiration (Apr · Classic)".to_string(),
                SparkPhase::AprilSenior => "Spark of Inspiration (Apr · Senior)".to_string(),
            },
            GameEvent::NewYear { .. } => "New Year".to_string(),
            GameEvent::SummerCampStart => "Summer Camp".to_string(),
            GameEvent::BuySkill { name, .. } => {
                if name.len() > 20 {
                    format!("Skill: {}…", &name[..18])
                } else {
                    format!("Skill: {name}")
                }
            }
            GameEvent::AcquireItem { name, .. } => {
                if name.len() > 20 {
                    format!("Item: {}…", &name[..18])
                } else {
                    format!("Item: {name}")
                }
            }
            GameEvent::CustomEvent { description, .. } => {
                if description.len() > 20 {
                    format!("{}…", &description[..18])
                } else {
                    description.clone()
                }
            }
        }
    }

    /// Color for the timeline bar.
    pub fn color(&self) -> &'static str {
        match self {
            GameEvent::SparkOfInspiration { .. } => "#c084fc", // purple
            GameEvent::NewYear { .. } => "#fde68a",            // amber
            GameEvent::SummerCampStart => "#67e8f9",           // cyan
            GameEvent::BuySkill { .. } => "#38bdf8",           // sky blue
            GameEvent::AcquireItem { .. } => "#fb923c",        // orange
            GameEvent::CustomEvent { .. } => "#94a3b8",        // slate
        }
    }
}

/// Breakdown of a training action's gains for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingDetail {
    /// Per-stat gains from training formula.
    pub stat_gains: [f64; 5],
    /// SP gained.
    pub sp_gain: f64,
    /// Energy change (negative = cost).
    pub energy_change: f64,
    /// Whether training failed.
    pub failed: bool,
    /// Failure rate at the time.
    pub failure_rate: f64,
    /// Cards that were present at the trained facility.
    pub present_card_indices: Vec<usize>,
    /// Friendship gains for present cards.
    pub friendship_gains: Vec<f64>,
}

// ─── Career Session ─────────────────────────────────────────────────────────

/// A full career session, holding configuration and the complete timeline.
///
/// The timeline is a flat list of `TimelineEntry` values — interleaved turns
/// and events. The rollback bar indexes into this list: scrubbing changes which
/// snapshot is displayed, but new entries always append at the end.
///
/// `current_turn()` counts only `Turn` entries (not events) because the game's
/// 78-turn structure only counts player actions, not calendar events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CareerSession {
    /// Unique session identifier.
    pub id: Uuid,
    /// The configuration this career was started with.
    pub config: CareerConfig,
    /// The computed initial state (turn 0, before any actions).
    pub initial_state: CareerInitialState,
    /// The initial snapshot (derived from initial_state).
    pub initial_snapshot: TurnSnapshot,
    /// Ordered timeline of turns and events.
    pub timeline: Vec<TimelineEntry>,
    /// The current view cursor (for the rollback bar).
    /// Points to the index in `timeline` that the UI is viewing.
    /// None means viewing the initial state (before any entries).
    pub view_cursor: Option<usize>,
}

impl CareerSession {
    /// Create a new session from a computed initial state.
    pub fn new(config: CareerConfig, initial_state: CareerInitialState) -> Self {
        let n_cards = initial_state.card_info.len();
        let initial_snapshot = TurnSnapshot::from_baseline(&initial_state, n_cards);
        CareerSession {
            id: Uuid::new_v4(),
            config,
            initial_state,
            initial_snapshot,
            timeline: Vec::new(),
            view_cursor: None,
        }
    }

    /// Number of turns fully played (excludes `Pending` placeholders).
    pub fn current_turn(&self) -> u32 {
        self.timeline
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    TimelineEntry::Turn(t) if !matches!(t.action, TurnAction::Pending)
                )
            })
            .count() as u32
    }

    /// Total turns in this scenario.
    pub fn total_turns(&self) -> u32 {
        self.config.scenario.total_turns()
    }

    /// Timeline index of the first `Pending` turn, if any.
    pub fn first_pending_index(&self) -> Option<usize> {
        self.timeline.iter().position(|e| {
            matches!(
                e,
                TimelineEntry::Turn(t) if matches!(t.action, TurnAction::Pending)
            )
        })
    }

    /// Recompute `state_after` on every `Pending` turn from the running snapshot
    /// (state carried forward through events and completed turns only).
    pub fn refresh_pending_snapshots(&mut self) {
        let mut current = self.initial_snapshot.clone();
        for entry in &mut self.timeline {
            match entry {
                TimelineEntry::Event(e) => {
                    current = e.state_after.clone();
                }
                TimelineEntry::Turn(t) => {
                    if matches!(t.action, TurnAction::Pending) {
                        t.state_after = current.clone();
                    } else {
                        current = t.state_after.clone();
                    }
                }
            }
        }
    }

    /// Append one `Pending` slot per scenario turn after the current timeline tail (e.g. after Spark).
    pub fn append_pending_turn_slots(&mut self) {
        let n = self.config.scenario.total_turns();
        for turn_num in 0..n {
            let calendar = CalendarTurn::from_turn(turn_num);
            let snap = self.initial_snapshot.clone();
            self.timeline.push(TimelineEntry::Turn(TurnRecord {
                turn_number: turn_num,
                calendar,
                action: TurnAction::Pending,
                card_placements: [0; 6],
                state_after: snap,
                training_detail: None,
            }));
        }
        self.refresh_pending_snapshots();
    }

    /// Replace the first `Pending` turn with a completed `TurnRecord` and refresh snapshots.
    pub fn replace_first_pending_turn(&mut self, record: TurnRecord) -> Option<usize> {
        let idx = self.first_pending_index()?;
        self.timeline[idx] = TimelineEntry::Turn(record);
        self.refresh_pending_snapshots();
        Some(idx)
    }

    /// Insert an event immediately before the first pending turn (player-submitted calendar events).
    pub fn insert_event_before_first_pending(&mut self, record: EventRecord) -> usize {
        let idx = self.first_pending_index().unwrap_or(self.timeline.len());
        self.timeline.insert(idx, TimelineEntry::Event(record));
        self.refresh_pending_snapshots();
        idx
    }

    /// Is the career finished?
    pub fn is_complete(&self) -> bool {
        self.current_turn() >= self.total_turns()
    }

    /// Get the snapshot at a specific timeline index, or the initial snapshot for None.
    pub fn snapshot_at(&self, idx: Option<usize>) -> &TurnSnapshot {
        match idx {
            None => &self.initial_snapshot,
            Some(i) => {
                if i < self.timeline.len() {
                    self.timeline[i].state_after()
                } else {
                    self.latest_snapshot()
                }
            }
        }
    }

    /// Get the snapshot the user is currently viewing (based on view_cursor).
    pub fn viewed_snapshot(&self) -> &TurnSnapshot {
        self.snapshot_at(self.view_cursor)
    }

    /// Get the latest snapshot (the most recent state, ignoring view cursor).
    pub fn latest_snapshot(&self) -> &TurnSnapshot {
        self.timeline
            .last()
            .map(|e| e.state_after())
            .unwrap_or(&self.initial_snapshot)
    }

    /// Append a timeline entry. The view cursor moves to this new entry.
    pub fn push_entry(&mut self, entry: TimelineEntry) {
        let idx = self.timeline.len();
        self.timeline.push(entry);
        self.view_cursor = Some(idx);
    }

    /// Convenience: push a turn record.
    pub fn push_turn(&mut self, record: TurnRecord) {
        self.push_entry(TimelineEntry::Turn(record));
    }

    /// Convenience: push an event record.
    pub fn push_event(&mut self, record: EventRecord) {
        self.push_entry(TimelineEntry::Event(record));
    }

    /// Set the view cursor for the rollback bar.
    /// None = view initial state, Some(n) = view state after timeline[n].
    pub fn set_view_cursor(&mut self, cursor: Option<usize>) {
        self.view_cursor = cursor;
    }

    /// Total entries in the timeline (turns + events).
    pub fn timeline_len(&self) -> usize {
        self.timeline.len()
    }
}

// ─── Facility Data (datamined) ──────────────────────────────────────────────

/// Base training gains per facility per level.
/// Format: [speed, stamina, power, guts, wisdom, SP, energy_change]
/// Indexed as FACILITY_DATA[level-1][facility_idx]
pub const FACILITY_DATA: [[[f64; 7]; 5]; 5] = [
    // Level 1
    [
        [ 8.0, 0.0, 4.0, 0.0, 0.0,  2.0, -19.0], // Speed
        [ 0.0, 7.0, 0.0, 3.0, 0.0,  2.0, -17.0], // Stamina
        [ 0.0, 4.0, 6.0, 0.0, 0.0,  2.0, -18.0], // Power
        [ 3.0, 0.0, 3.0, 6.0, 0.0,  2.0, -20.0], // Guts
        [ 2.0, 0.0, 0.0, 0.0, 6.0,  3.0,   5.0], // Wisdom
    ],
    // Level 2
    [
        [10.0, 0.0, 5.0, 0.0, 0.0,  2.0, -20.0],
        [ 0.0, 9.0, 0.0, 4.0, 0.0,  2.0, -18.0],
        [ 0.0, 5.0, 8.0, 0.0, 0.0,  2.0, -19.0],
        [ 3.0, 0.0, 3.0, 8.0, 0.0,  2.0, -21.0],
        [ 2.0, 0.0, 0.0, 0.0, 7.0,  3.0,   5.0],
    ],
    // Level 3
    [
        [12.0, 0.0, 6.0, 0.0, 0.0,  2.0, -21.0],
        [ 0.0,11.0, 0.0, 5.0, 0.0,  2.0, -19.0],
        [ 0.0, 6.0,10.0, 0.0, 0.0,  2.0, -20.0],
        [ 4.0, 0.0, 4.0,10.0, 0.0,  2.0, -22.0],
        [ 3.0, 0.0, 0.0, 0.0, 8.0,  3.0,   5.0],
    ],
    // Level 4
    [
        [14.0, 0.0, 7.0, 0.0, 0.0,  2.0, -23.0],
        [ 0.0,13.0, 0.0, 6.0, 0.0,  2.0, -21.0],
        [ 0.0, 7.0,12.0, 0.0, 0.0,  2.0, -22.0],
        [ 5.0, 0.0, 5.0,12.0, 0.0,  2.0, -24.0],
        [ 4.0, 0.0, 0.0, 0.0, 9.0,  3.0,   5.0],
    ],
    // Level 5
    [
        [16.0, 0.0, 8.0, 0.0, 0.0,  2.0, -25.0],
        [ 0.0,15.0, 0.0, 7.0, 0.0,  2.0, -23.0],
        [ 0.0, 8.0,14.0, 0.0, 0.0,  2.0, -24.0],
        [ 6.0, 0.0, 6.0,14.0, 0.0,  2.0, -26.0],
        [ 5.0, 0.0, 0.0, 0.0,10.0,  3.0,   5.0],
    ],
];

/// Rest recovery probability distribution.
/// (probability, energy_gained, gains_night_owl_condition)
pub const REST_OUTCOMES: [(f64, f64, bool); 4] = [
    (0.255, 70.0, false),
    (0.580, 50.0, false),
    (0.130, 30.0, false),
    (0.035, 30.0, true), // Night Owl condition
];

// ─── Training Constants ─────────────────────────────────────────────────────

pub const MAX_ENERGY: f64 = 100.0;
pub const FRIENDSHIP_THRESHOLD: f64 = 80.0;
pub const FRIENDSHIP_GAIN_PER_TRAIN: f64 = 7.0;
pub const MAX_FRIENDSHIP: f64 = 100.0;
pub const MAX_FACILITY_LEVEL: u32 = 5;
pub const TRAINS_PER_FACILITY_LEVEL: u32 = 4;
pub const SUMMER_REST_ENERGY_GAIN: f64 = 35.0;

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
