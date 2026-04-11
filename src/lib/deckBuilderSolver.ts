import { maxLevelForUncap } from './supportCardLevel'
import {
  addStatVectors,
  statVectorAtLevel,
  clampFriendTrainLevel,
  clampOwnedTrainLevel,
  type SupportCardEffectRow,
} from './deckBuilderStats'
import {
  compactInputFromJson,
  solveDeckCompact,
  type CompactDeckResult,
} from '../../shared/deckSolverCore'

export interface StatConstraint {
  effectTypeId: number
  min: number
  max: number
}

export interface OwnedDeckEntry {
  cardId: number
  name: string
  rarity: string
  /** speed | stamina | power | guts | intelligence | friend | group */
  card_type: string
  level: number
  uncap: number
  effects: SupportCardEffectRow[]
  /**
   * Training level used for effect totals in the solver (clamped to max for `uncap`).
   * If omitted, max level for uncap is used (same as before fixed-slot levels).
   */
  statTrainLevel?: number
}

export interface WildcardCandidate {
  cardId: number
  name: string
  rarity: string
  card_type: string
  effects: SupportCardEffectRow[]
  /** Training level for the friend slot (clamped to max at uncap 4). Omit = max level. */
  statTrainLevel?: number
}

export interface UpgradeHint {
  cardId: number
  name: string
  currentLevel: number
  targetLevel: number
}

export interface DeckSolution {
  owned: OwnedDeckEntry[]
  wildcard: WildcardCandidate
  total: Record<number, number>
  upgradeHints: UpgradeHint[]
  /** Sum of all effect values in `total` — higher means more overall bonus strength. */
  rankScore: number
}

function buildHints(owned: OwnedDeckEntry[]): UpgradeHint[] {
  const hints: UpgradeHint[] = []
  for (const o of owned) {
    const target = maxLevelForUncap(o.uncap, o.rarity)
    if (o.level < target) {
      hints.push({
        cardId: o.cardId,
        name: o.name,
        currentLevel: o.level,
        targetLevel: target,
      })
    }
  }
  return hints
}

/** Sum of all effect-type values in a vector (same metric as compact solver score). */
export function sumStatVectorValues(vec: Record<number, number>): number {
  let s = 0
  for (const v of Object.values(vec)) s += v
  return s
}

/** Merge duplicate effect ids to intersection of intervals; drop invalid. */
export function normalizeConstraints(constraints: StatConstraint[]): StatConstraint[] {
  const m = new Map<number, { min: number; max: number }>()
  for (const c of constraints) {
    const ex = m.get(c.effectTypeId)
    if (!ex) m.set(c.effectTypeId, { min: c.min, max: c.max })
    else {
      ex.min = Math.max(ex.min, c.min)
      ex.max = Math.min(ex.max, c.max)
    }
  }
  return [...m.entries()]
    .filter(([, v]) => v.min <= v.max)
    .map(([effectTypeId, { min, max }]) => ({ effectTypeId, min, max }))
}

function statVectorForOwnedSolver(o: OwnedDeckEntry): Record<number, number> {
  const lv =
    o.statTrainLevel != null
      ? clampOwnedTrainLevel(o.statTrainLevel, o.uncap, o.rarity)
      : maxLevelForUncap(o.uncap, o.rarity)
  return statVectorAtLevel(o.effects, lv)
}

function statVectorForWildcardSolver(w: WildcardCandidate): Record<number, number> {
  const lv =
    w.statTrainLevel != null
      ? clampFriendTrainLevel(w.statTrainLevel, w.rarity)
      : maxLevelForUncap(4, w.rarity)
  return statVectorAtLevel(w.effects, lv)
}

/** Default number of ranked decks to return (top by total stat sum). */
export const DEFAULT_MAX_DECK_SUGGESTIONS = 25

export interface SolveDeckArgs {
  owned: OwnedDeckEntry[]
  wildcardPool: WildcardCandidate[]
  constraints: StatConstraint[]
  maxTimeMs?: number
  /** How many valid decks to rank and return (1 = first match only, faster). */
  maxSolutions?: number
  /** Card ids that must appear among the five owned picks (subset of `owned`). */
  forcedOwnedCardIds?: number[]
  /** Friend slot must be this card id (must exist in `wildcardPool`). */
  forcedWildcardCardId?: number | null
}

export interface SolveDeckResult {
  solutions: DeckSolution[]
  iterations: number
  capped: boolean
}

/** JSON-safe payload for worker / POST /api/deck-solve */
export interface DeckSolveJsonPayload {
  k: number
  owned: number[][]
  pool: number[][]
  ownedIds: number[]
  poolIds: number[]
  targetMin: number[]
  targetMax: number[]
  maxTimeMs: number
  maxSolutions?: number
  ownedScore?: number[]
  poolScore?: number[]
  requiredOwnedIndices?: number[]
  forcedPoolIndex?: number
}

export function buildDeckSolvePayload(args: SolveDeckArgs): DeckSolveJsonPayload | null {
  const normalized = normalizeConstraints(args.constraints)
  if (normalized.length === 0 || args.owned.length < 5 || args.wildcardPool.length === 0) {
    return null
  }

  const colIds = normalized.map(c => c.effectTypeId)
  const k = colIds.length

  const ownedPre = args.owned.map(o => ({
    entry: o,
    vec: statVectorForOwnedSolver(o),
  }))
  const poolPre = args.wildcardPool.map(w => ({
    card: w,
    vec: statVectorForWildcardSolver(w),
  }))

  const owned: number[][] = ownedPre.map(({ vec }) =>
    colIds.map(id => vec[id] ?? 0),
  )
  const pool: number[][] = poolPre.map(({ vec }) => colIds.map(id => vec[id] ?? 0))

  const maxSolutions = args.maxSolutions ?? DEFAULT_MAX_DECK_SUGGESTIONS
  const ownedScore = ownedPre.map(({ vec }) => sumStatVectorValues(vec))
  const poolScore = poolPre.map(({ vec }) => sumStatVectorValues(vec))

  const payload: DeckSolveJsonPayload = {
    k,
    owned,
    pool,
    ownedIds: args.owned.map(o => o.cardId),
    poolIds: args.wildcardPool.map(w => w.cardId),
    targetMin: normalized.map(c => c.min),
    targetMax: normalized.map(c => c.max),
    maxTimeMs: args.maxTimeMs ?? 300_000,
    maxSolutions,
    ownedScore,
    poolScore,
  }

  const forcedOwned = args.forcedOwnedCardIds?.filter(id => Number.isFinite(id)) ?? []
  if (forcedOwned.length > 0) {
    const idToIdx = new Map(args.owned.map((o, i) => [o.cardId, i]))
    const idxSet = new Set<number>()
    for (const id of forcedOwned) {
      const ix = idToIdx.get(id)
      if (ix === undefined) return null
      idxSet.add(ix)
    }
    payload.requiredOwnedIndices = [...idxSet].sort((a, b) => a - b)
  }

  if (args.forcedWildcardCardId != null && Number.isFinite(args.forcedWildcardCardId)) {
    const pix = args.wildcardPool.findIndex(w => w.cardId === args.forcedWildcardCardId)
    if (pix < 0) return null
    payload.forcedPoolIndex = pix
  }

  return payload
}

function solutionFromIndices(
  args: SolveDeckArgs,
  ownedIdx: [number, number, number, number, number],
  poolIdx: number,
): DeckSolution {
  const [a, b, c, d, e] = ownedIdx
  const ownedEntries = [args.owned[a]!, args.owned[b]!, args.owned[c]!, args.owned[d]!, args.owned[e]!]
  const w = args.wildcardPool[poolIdx]!

  const vecs = [
    statVectorForOwnedSolver(ownedEntries[0]!),
    statVectorForOwnedSolver(ownedEntries[1]!),
    statVectorForOwnedSolver(ownedEntries[2]!),
    statVectorForOwnedSolver(ownedEntries[3]!),
    statVectorForOwnedSolver(ownedEntries[4]!),
    statVectorForWildcardSolver(w),
  ]
  const total = addStatVectors(...vecs)

  return {
    owned: ownedEntries,
    wildcard: w,
    total,
    upgradeHints: buildHints(ownedEntries),
    rankScore: sumStatVectorValues(total),
  }
}

export function solveDeck(args: SolveDeckArgs): SolveDeckResult {
  const payload = buildDeckSolvePayload(args)
  if (!payload) {
    return { solutions: [], iterations: 0, capped: false }
  }

  const compact = compactInputFromJson(payload)
  const cr = solveDeckCompact(compact)
  return reconstructDeckSolutions(args, cr)
}

/** After compact solve (worker/server), rebuild full solutions + totals on the client. */
export function reconstructDeckSolutions(args: SolveDeckArgs, cr: CompactDeckResult): SolveDeckResult {
  if (cr.solutions.length === 0) {
    return { solutions: [], iterations: cr.iterations, capped: cr.capped }
  }
  return {
    solutions: cr.solutions.map(s => solutionFromIndices(args, s.ownedIdx, s.poolIdx)),
    iterations: cr.iterations,
    capped: cr.capped,
  }
}
