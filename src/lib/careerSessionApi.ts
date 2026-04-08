/**
 * Client for the career session API (Rust optimizer server).
 *
 * The timeline is a flat list of entries that can be either turns or events.
 * Events (Spark of Inspiration scenes, New Year, Summer Camp, custom events) are
 * first-class timeline entries submitted separately from turn actions.
 * First Spark of Inspiration is auto-applied at session start (stats + aptitudes + hints).
 * April Classic/Senior sparks are suggested in turn preview (rolled server-side; submit to log).
 */

const OPTIMIZER_URL = import.meta.env.VITE_OPTIMIZER_URL || '/optimizer-api'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StatBlock {
  speed: number
  stamina: number
  power: number
  guts: number
  wisdom: number
}

export interface LearnedSkill {
  skill_id: number
  name: string
  level: number
}

export interface HeldItem {
  item_id: number
  name: string
  quantity: number
}

export interface TurnSnapshot {
  stats: StatBlock
  skill_points: number
  energy: number
  mood: string
  friendship: number[]
  spirit: number[]
  facility_levels: number[]
  facility_trains: number[]
  conditions: string[]
  hint_levels: Record<number, number>
  /** Aptitude letter grades (turf, mile, leading, …) after inheritance sparks */
  aptitudes?: Record<string, string>
  /** Skills purchased with SP */
  learned_skills?: LearnedSkill[]
  /** Items held (Trackblazer only) */
  items?: HeldItem[]
  total_fans: number
  races_run: number
}

export interface CalendarTurn {
  turn: number
  year: string
  month: number
  half: string
}

export interface FacilityPreview {
  facility: number
  stat_gains: number[]
  sp_gain: number
  energy_change: number
  failure_rate: number
  present_cards: number[]
  friendship_gains: number[]
}

// ─── Game Events ────────────────────────────────────────────────────────────

export type SparkPhase = 'career_start' | 'april_classic' | 'april_senior'

export interface SparkHintDelta {
  skill_id: number
  levels: number
}

export interface AptitudeDelta {
  key: string
  from_grade: string
  to_grade: string
}

/** All possible game events that can be submitted as timeline entries. */
export type GameEvent =
  | {
      type: 'spark_of_inspiration'
      phase: SparkPhase
      stat_gains: number[]
      sp_gained: number
      hint_deltas: SparkHintDelta[]
      aptitude_deltas: AptitudeDelta[]
    }
  | {
      type: 'new_year'
      energy_gained: number
      sp_gained: number
    }
  | {
      type: 'summer_camp_start'
    }
  | {
      type: 'buy_skill'
      skill_id: number
      name: string
      level: number
      sp_cost: number
    }
  | {
      type: 'acquire_item'
      item_id: number
      name: string
      quantity: number
    }
  | {
      type: 'custom_event'
      description: string
      stat_gains?: number[]
      sp_gained?: number
      energy_gained?: number
      mood_change?: number  // +1 = up, -1 = down
    }

// ─── Turn Preview ───────────────────────────────────────────────────────────

export interface TurnPreview {
  turn_number: number
  calendar: CalendarTurn
  /** Events the server suggests should fire before this turn. */
  pending_events: GameEvent[]
  facility_previews: FacilityPreview[]
  is_summer_camp: boolean
  is_mandatory_race: boolean
  available_actions: string[]
}

export interface TrainingDetail {
  stat_gains: number[]
  sp_gain: number
  energy_change: number
  failed: boolean
  failure_rate: number
  present_card_indices: number[]
  friendship_gains: number[]
}

// ─── Timeline ───────────────────────────────────────────────────────────────

/** Server-provided effect payload for a timeline entry (training breakdown, event parameters). */
export type TimelineEntryDetail =
  | { kind: 'training'; detail: TrainingDetail }
  | {
      kind: 'spark_of_inspiration'
      phase: SparkPhase
      stat_gains: number[]
      sp_gained: number
      hint_deltas: SparkHintDelta[]
      aptitude_deltas: AptitudeDelta[]
    }
  | { kind: 'new_year'; energy_gained: number; sp_gained: number }
  | { kind: 'summer_camp_start' }
  | { kind: 'buy_skill'; skill_id: number; name: string; level: number; sp_cost: number }
  | { kind: 'acquire_item'; item_id: number; name: string; quantity: number }
  | {
      kind: 'custom_event'
      description: string
      stat_gains: number[] | null
      sp_gained: number | null
      energy_gained: number | null
      mood_change: number | null
    }

/** Summary of a single timeline entry (turn or event) for the rollback bar. */
export interface TimelineEntrySummary {
  index: number
  kind: 'turn' | 'event'
  turn_number: number | null
  calendar_label: string
  /** e.g. "train_speed", "rest", "Spark of Inspiration", "New Year" */
  entry_type: string
  /** Custom color for events (null for turns — use action color map). */
  color: string | null
  stats_total: number
  energy: number
  /** When present, full effect log from the server (training formula, declared event gains, etc.). */
  detail?: TimelineEntryDetail
}

// ─── Responses ──────────────────────────────────────────────────────────────

export interface CareerCreateResponse {
  session_id: string
  initial_snapshot: TurnSnapshot
  initial_state: {
    stats: StatBlock
    base_stats: StatBlock
    inheritance_stats: StatBlock
    support_card_stats: StatBlock
    pre_spark_stats: StatBlock
    aptitudes: Record<string, string>
    sp: number
    energy: number
    mood: string
    friendship: number[]
    card_info: { card_id: number; level: number; name: string; card_type: string; rarity: string }[]
    growth_rates: number[]
  }
  total_turns: number
  timeline: TimelineEntrySummary[]
  /** Scenario sections for timeline labels (e.g. Trackblazer pre-debut / regular / climax). */
  turn_phases?: { label: string; start_turn: number; end_turn: number }[]
  /** Live state after creation (post–Spark when skeleton is present). */
  current_snapshot: TurnSnapshot
}

export interface CareerEventResponse {
  timeline_index: number
  event_label: string
  state_after: TurnSnapshot
}

export interface CareerAdvanceResponse {
  turn_number: number
  state_after: TurnSnapshot
  is_complete: boolean
  next_turn: number
  timeline_index: number
}

export interface CareerStateResponse {
  session_id: string
  current_turn: number
  total_turns: number
  is_complete: boolean
  snapshot: TurnSnapshot
  /** Snapshot before this entry (for computing deltas). Present when a specific index was requested. */
  previous_snapshot: TurnSnapshot | null
  timeline_length: number
}

export type TurnAction =
  | { type: 'train'; facility: number }
  | { type: 'rest' }
  | { type: 'race'; race_id?: number }
  | { type: 'infirmary' }
  | { type: 'recreation' }

// ─── API Functions ──────────────────────────────────────────────────────────

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${OPTIMIZER_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

/** Create a new career session. */
export async function createCareerSession(config: {
  scenario: string
  trainee_id: number
  star_rank: number
  awakening_level: number
  deck: [number, number][]
  legacy?: unknown
}): Promise<CareerCreateResponse> {
  return apiCall('/api/career/create', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

/** Preview the current turn (pending events + facility previews). */
export async function previewTurn(
  sessionId: string,
  cardPlacements: number[],
): Promise<TurnPreview> {
  return apiCall(`/api/career/${sessionId}/preview`, {
    method: 'POST',
    body: JSON.stringify({ card_placements: cardPlacements }),
  })
}

/**
 * Submit a game event (Spark of Inspiration, New Year, custom event, etc.)
 *
 * Events should be submitted BEFORE the turn they accompany.
 * Each event becomes its own entry in the timeline / rollback bar.
 */
export async function submitEvent(
  sessionId: string,
  event: GameEvent,
): Promise<CareerEventResponse> {
  return apiCall(`/api/career/${sessionId}/event`, {
    method: 'POST',
    body: JSON.stringify({ event }),
  })
}

/** Advance the career by one turn (events should already be submitted). */
export async function advanceTurn(
  sessionId: string,
  params: {
    action: TurnAction
    card_placements: number[]
    training_failed?: boolean
    rest_energy?: number
  },
): Promise<CareerAdvanceResponse> {
  return apiCall(`/api/career/${sessionId}/advance`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/** Get the career state (optionally at a specific timeline index for rollback). */
export async function getCareerState(
  sessionId: string,
  index?: number,
): Promise<CareerStateResponse> {
  const query = index !== undefined ? `?index=${index}` : ''
  return apiCall(`/api/career/${sessionId}/state${query}`)
}

/** Get the full timeline for the rollback bar. */
export async function getTimeline(
  sessionId: string,
): Promise<TimelineEntrySummary[]> {
  return apiCall(`/api/career/${sessionId}/timeline`)
}
