/**
 * Recommended deck-builder constraint targets based on a trainee's aptitudes /
 * stat-growth profile and the chosen training scenario.
 *
 * The engine works in two layers:
 *   1. **Scenario layer** — each scenario defines base priorities for non-stat
 *      effects (Race Bonus, Training Effectiveness, Friendship Bonus, etc.).
 *   2. **Trainee layer** — the trainee's best distance aptitude and stat growth
 *      rates determine which stat bonuses (Speed / Stamina / Power / Guts / Wit)
 *      to enable and at what minimum.
 *
 * The output is a `Record<number, DeckConstraintRow>` that can replace the
 * existing constraints state wholesale (auto-fill).
 */

import { SUPPORT_CARD_EFFECT_META } from './supportCardEffectMeta'
import { defaultDeckConstraintState, type DeckConstraintRow } from './deckBuilderConstraintsStorage'

// ─── Scenario definitions ────────────────────────────────────────────────────

export type ScenarioSlug = 'ura-finale' | 'unity-cup' | 'twinkle-star-climax'

export interface ScenarioMeta {
  slug: ScenarioSlug
  name: string
}

export const SCENARIOS: ScenarioMeta[] = [
  { slug: 'ura-finale', name: 'Ura Finale' },
  { slug: 'unity-cup', name: 'Unity Cup' },
  { slug: 'twinkle-star-climax', name: 'Twinkle Star Climax' },
]

/**
 * Effect-type targets per scenario.  Value is the recommended minimum for a
 * six-card deck at max unlock.  `0` means "enable but don't set a floor" (the
 * solver will still factor the effect into its ranking score).  Omitted IDs are
 * left disabled.
 */
const SCENARIO_TARGETS: Record<ScenarioSlug, Partial<Record<number, number>>> = {
  'ura-finale': {
    // UAF leans on cross-training bonuses and friendship stacking.
    // Race Bonus breakpoint at 34 %  ⇒ +4 per race stat instead of +3.
    1:  60,  // Friendship Bonus %    – aim for solid bond momentum
    8:  20,  // Training Effectiveness – multiplier on all stat gains
    15: 34,  // Race Bonus %          – 34 % breakpoint
    25:  0,  // Event Recovery         – nice to have
    26:  0,  // Event Effectiveness    – nice to have
  },
  'unity-cup': {
    // Unity Cup (Aoharu / Grand Masters) – Spirit Burst energy management is
    // critical.  Race Bonus 34 % breakpoint still applies.
    1:  60,  // Friendship Bonus %
    8:  20,  // Training Effectiveness
    15: 34,  // Race Bonus %           – 34 % breakpoint
    25:  0,  // Event Recovery          – helps comfort / HP management
    28:  0,  // Energy Cost Reduction   – critical for Spirit Burst
  },
  'twinkle-star-climax': {
    // Climax / Make a New Track – optional race farming is the primary stat
    // builder.  50 % Race Bonus is the key breakpoint; 60 %+ ideal.
    // Friendship at 40% balances bond momentum vs race-heavy MANT guides that
    // prioritize Race Bonus — users can raise Race (see strong preset) without
    // auto-fill forcing a friendship change.
    1:  40,  // Friendship Bonus %     – still useful but less central
    8:  15,  // Training Effectiveness  – multiplier still valuable
    15: 50,  // Race Bonus %           – 50 % breakpoint for race farming
    30:  0,  // Skill Point Bonus      – races reward skill points
  },
}

/** Race Bonus effect id (`SUPPORT_CARD_EFFECT_META`). */
const RACE_BONUS_EFFECT_ID = 15

/** Auto-fill default for MANT / TSC — matches uma.guide “stay at or above 50%”. */
export const TSC_RACE_BONUS_DEFAULT_MIN = 50

/** Stricter floor cited for high-investment / MLB-style MANT decks (~60%+). */
export const TSC_RACE_BONUS_STRONG_MIN = 60

/**
 * Set Race Bonus minimum to [`TSC_RACE_BONUS_STRONG_MIN`] (keeps other rows as-is).
 * Exposed for programmatic use (e.g. tooling/tests); the Deck Builder has no preset button — users edit Race Bonus in the grid.
 */
export function applyTwinkleStarStrongRaceFloor(
  state: Record<number, DeckConstraintRow>,
): Record<number, DeckConstraintRow> {
  return {
    ...state,
    [RACE_BONUS_EFFECT_ID]: { enabled: true, minStr: String(TSC_RACE_BONUS_STRONG_MIN) },
  }
}

// ─── Trainee helpers ─────────────────────────────────────────────────────────

/** Aptitude grade → numeric value (higher = better). */
const GRADE_VALUE: Record<string, number> = {
  S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1, G: 0,
}

function gradeVal(g: string | null | undefined): number {
  return GRADE_VALUE[(g ?? '').toUpperCase()] ?? 0
}

export interface TraineeProfile {
  /** Distance aptitudes */
  apt_short?: string | null
  apt_mile?: string | null
  apt_mid?: string | null
  apt_long?: string | null
  /** Running style aptitudes */
  apt_leading?: string | null
  apt_stalking?: string | null
  apt_mid_pack?: string | null
  apt_chasing?: string | null
  /**
   * Stat-growth array [speed, stamina, power, guts, wit] — percentage bonuses
   * to natural stat gains from training.  Higher growth ⇒ less need for that
   * stat's support card bonus.
   */
  stat_growth?: number[] | null
}

type Distance = 'short' | 'mile' | 'mid' | 'long'

function bestDistance(t: TraineeProfile): Distance {
  const dists: { d: Distance; v: number }[] = [
    { d: 'short', v: gradeVal(t.apt_short) },
    { d: 'mile', v: gradeVal(t.apt_mile) },
    { d: 'mid', v: gradeVal(t.apt_mid) },
    { d: 'long', v: gradeVal(t.apt_long) },
  ]
  dists.sort((a, b) => b.v - a.v)
  return dists[0]!.d
}

/**
 * Distance-based stat priorities.  Index order: [speed, stamina, power, guts, wit].
 * Higher weight ⇒ more important to enable and set a higher floor.
 */
const DISTANCE_STAT_WEIGHTS: Record<Distance, [number, number, number, number, number]> = {
  short: [1.0, 0.2, 0.8, 0.4, 0.6],
  mile:  [1.0, 0.4, 0.7, 0.3, 0.7],
  mid:   [0.8, 0.7, 0.6, 0.4, 0.7],
  long:  [0.6, 1.0, 0.5, 0.4, 0.6],
}

/**
 * Running-style adjustments added on top of distance weights.
 * Index order: [speed, stamina, power, guts, wit].
 */
function styleAdjust(t: TraineeProfile): [number, number, number, number, number] {
  const styles: { d: string; v: number; adj: [number, number, number, number, number] }[] = [
    { d: 'leading', v: gradeVal(t.apt_leading), adj: [0.1, 0, 0.15, 0, 0] },
    { d: 'stalking', v: gradeVal(t.apt_stalking), adj: [0.1, 0, 0.05, 0, 0.1] },
    { d: 'mid_pack', v: gradeVal(t.apt_mid_pack), adj: [0, 0.1, 0, 0, 0.1] },
    { d: 'chasing', v: gradeVal(t.apt_chasing), adj: [0, 0, 0.05, 0.15, 0.05] },
  ]
  styles.sort((a, b) => b.v - a.v)
  return styles[0]?.adj ?? [0, 0, 0, 0, 0]
}

// Stat bonus effect IDs in [speed, stamina, power, guts, wit] order.
const STAT_EFFECT_IDS = [3, 4, 5, 6, 7] as const

/**
 * Compute the trainee-adjusted stat bonus weights.  Growth rates inversely
 * modulate the weight: if you already grow a stat quickly, you need less
 * support card bonus for it.
 */
function traineeStatWeights(t: TraineeProfile): Record<number, number> {
  const dist = bestDistance(t)
  const base = [...DISTANCE_STAT_WEIGHTS[dist]]
  const sAdj = styleAdjust(t)
  for (let i = 0; i < 5; i++) base[i] += sAdj[i]!

  // Growth-rate modulation: higher growth ⇒ slightly lower priority.
  // Growth values are typically 0–30; we normalise so the strongest growth
  // reduces weight by ~25 % and zero growth adds nothing.
  const growth = t.stat_growth
  if (growth && growth.length >= 5) {
    const maxG = Math.max(...growth.slice(0, 5), 1)
    for (let i = 0; i < 5; i++) {
      const g = growth[i] ?? 0
      // Inverse scale: 0 growth → factor 1.0; maxG growth → factor 0.75.
      base[i]! *= 1 - 0.25 * (g / maxG)
    }
  }

  const out: Record<number, number> = {}
  for (let i = 0; i < 5; i++) out[STAT_EFFECT_IDS[i]] = base[i]!
  return out
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Weight above which a stat effect is enabled in the output constraints. */
const STAT_ENABLE_THRESHOLD = 0.35

/**
 * Convert a stat weight (0–~1.3) into a recommended minimum bonus total for a
 * six-card deck.  Typical per-card stat bonuses at max SSR are 1–2, so a
 * six-card deck sums to roughly 6–12.  We scale the floor linearly within a
 * conservative range so the constraint is achievable but still filters junk.
 *
 * weight 0.35 →  1   (bare minimum, just enabled)
 * weight 1.00 →  4   (solid)
 * weight 1.30 →  5   (very high priority)
 */
function statMinFromWeight(w: number): number {
  const clamped = Math.max(0.35, Math.min(w, 1.3))
  const v = 1 + ((clamped - 0.35) / (1.3 - 0.35)) * 4
  return Math.round(v)
}

/**
 * Generate recommended constraints for a given trainee profile and training
 * scenario.  Returns a state object compatible with the constraint storage
 * format (can be passed directly to `setConstraints`).
 */
export function recommendedConstraints(
  trainee: TraineeProfile,
  scenario: ScenarioSlug,
): Record<number, DeckConstraintRow> {
  const state = defaultDeckConstraintState()

  // 1. Scenario-level non-stat targets
  const scenarioTargets = SCENARIO_TARGETS[scenario]
  for (const [idStr, min] of Object.entries(scenarioTargets)) {
    const id = Number(idStr)
    if (!(id in SUPPORT_CARD_EFFECT_META)) continue
    state[id] = { enabled: true, minStr: String(min) }
  }

  // 2. Trainee-influenced stat bonus targets
  const weights = traineeStatWeights(trainee)
  for (const eid of STAT_EFFECT_IDS) {
    const w = weights[eid] ?? 0
    if (w >= STAT_ENABLE_THRESHOLD) {
      state[eid] = { enabled: true, minStr: String(statMinFromWeight(w)) }
    }
  }

  return state
}
