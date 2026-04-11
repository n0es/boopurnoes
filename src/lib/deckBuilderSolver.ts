import { maxLevelForUncap } from './supportCardLevel'
import {
  addStatVectors,
  vectorForOwnedCard,
  vectorForWildcardCard,
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
}

export interface WildcardCandidate {
  cardId: number
  name: string
  rarity: string
  card_type: string
  effects: SupportCardEffectRow[]
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

/** Default number of ranked decks to return (top by total stat sum). */
export const DEFAULT_MAX_DECK_SUGGESTIONS = 25

export interface SolveDeckArgs {
  owned: OwnedDeckEntry[]
  wildcardPool: WildcardCandidate[]
  constraints: StatConstraint[]
  maxTimeMs?: number
  /** How many valid decks to rank and return (1 = first match only, faster). */
  maxSolutions?: number
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
    vec: vectorForOwnedCard(o.effects, o.uncap, o.rarity),
  }))
  const poolPre = args.wildcardPool.map(w => ({
    card: w,
    vec: vectorForWildcardCard(w.effects, w.rarity),
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
    vectorForOwnedCard(ownedEntries[0]!.effects, ownedEntries[0]!.uncap, ownedEntries[0]!.rarity),
    vectorForOwnedCard(ownedEntries[1]!.effects, ownedEntries[1]!.uncap, ownedEntries[1]!.rarity),
    vectorForOwnedCard(ownedEntries[2]!.effects, ownedEntries[2]!.uncap, ownedEntries[2]!.rarity),
    vectorForOwnedCard(ownedEntries[3]!.effects, ownedEntries[3]!.uncap, ownedEntries[3]!.rarity),
    vectorForOwnedCard(ownedEntries[4]!.effects, ownedEntries[4]!.uncap, ownedEntries[4]!.rarity),
    vectorForWildcardCard(w.effects, w.rarity),
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
