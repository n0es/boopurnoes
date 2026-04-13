/** Compare helpers for reference decks — library/tests; not wired to Deck Builder UI. */
import type { MantReferenceDeck, SupportTypeKey } from '../data/mantReferenceDecks'
import type { DeckSolution } from './deckBuilderSolver'
import { addStatVectors, vectorForWildcardCard, type SupportCardEffectRow } from './deckBuilderStats'

export interface TypePatternCompareResult {
  /** L1 distance: sum of absolute differences per training type */
  patternDistance: number
  /** Human-readable breakdown */
  breakdown: Partial<Record<SupportTypeKey, { expected: number; actual: number }>>
}

export interface JaccardCompareResult {
  /** |intersection| / |union| on six card ids */
  jaccard: number
  intersectionSize: number
  unionSize: number
}

export interface EffectDeltaRow {
  effectTypeId: number
  reference: number
  solution: number
  delta: number
}

export interface ReferenceCompareResult {
  referenceId: string
  typePattern: TypePatternCompareResult
  cards: JaccardCompareResult | null
  /** Only when reference totals were computed */
  effectDeltas: EffectDeltaRow[] | null
  /** Max |delta| across effects compared */
  maxAbsDelta: number | null
}

function normalizeTypeCounts(
  raw: Record<string, number>,
): Partial<Record<SupportTypeKey, number>> {
  const out: Partial<Record<SupportTypeKey, number>> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v <= 0) continue
    if (
      k === 'speed' ||
      k === 'stamina' ||
      k === 'power' ||
      k === 'guts' ||
      k === 'intelligence' ||
      k === 'friend' ||
      k === 'group'
    ) {
      out[k] = v
    }
  }
  return out
}

/**
 * Compare solution's `typeCounts` to a reference pattern (six cards total each side).
 */
export function compareTypePattern(
  solutionTypeCounts: Record<string, number>,
  ref: MantReferenceDeck,
): TypePatternCompareResult {
  const actual = normalizeTypeCounts(solutionTypeCounts)
  const expected = ref.typePattern
  const keys = new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
  ]) as Set<SupportTypeKey>

  let patternDistance = 0
  const breakdown: TypePatternCompareResult['breakdown'] = {}

  for (const k of keys) {
    const e = expected[k] ?? 0
    const a = actual[k] ?? 0
    patternDistance += Math.abs(e - a)
    if (e !== 0 || a !== 0) {
      breakdown[k] = { expected: e, actual: a }
    }
  }

  return { patternDistance, breakdown }
}

/**
 * Jaccard similarity on six card ids (order-free; owned vs friend ignored).
 */
export function jaccardCardOverlap(solution: DeckSolution, referenceCardIds: number[]): JaccardCompareResult {
  const a = new Set<number>()
  for (const o of solution.owned) a.add(o.cardId)
  a.add(solution.wildcard.cardId)
  const b = new Set(referenceCardIds)
  let inter = 0
  for (const id of a) {
    if (b.has(id)) inter++
  }
  const union = a.size + b.size - inter
  const jaccard = union === 0 ? 0 : inter / union
  return { jaccard, intersectionSize: inter, unionSize: union }
}

/**
 * Per-effect deltas: reference minus solution (positive ⇒ reference expects higher totals).
 */
export function effectDeltas(
  referenceTotal: Record<number, number>,
  solutionTotal: Record<number, number>,
  effectTypeIds?: number[],
): EffectDeltaRow[] {
  const ids = new Set<number>()
  if (effectTypeIds?.length) {
    for (const id of effectTypeIds) ids.add(id)
  } else {
    for (const k of Object.keys(referenceTotal)) ids.add(Number(k))
    for (const k of Object.keys(solutionTotal)) ids.add(Number(k))
  }
  const rows: EffectDeltaRow[] = []
  for (const id of [...ids].sort((a, b) => a - b)) {
    const r = referenceTotal[id] ?? 0
    const s = solutionTotal[id] ?? 0
    rows.push({ effectTypeId: id, reference: r, solution: s, delta: r - s })
  }
  return rows
}

/**
 * Build max-effect totals for six cards (all treated as friend-tier max uncap 4) for fair comparison to theorycraft.
 */
export function aggregateMaxEffectTotalsForCards(
  cards: Array<{ effects: SupportCardEffectRow[]; rarity: string }>,
): Record<number, number> {
  const vecs = cards.map(c => vectorForWildcardCard(c.effects, c.rarity))
  return addStatVectors(...vecs)
}

export function compareReferenceToSolution(
  ref: MantReferenceDeck,
  solution: DeckSolution,
  options?: { referenceEffectTotal?: Record<number, number> | null },
): ReferenceCompareResult {
  const typePattern = compareTypePattern(solution.typeCounts, ref)
  const cards =
    ref.cardIds && ref.cardIds.length >= 6 ? jaccardCardOverlap(solution, ref.cardIds) : null

  const rt = options?.referenceEffectTotal
  let deltaRows: EffectDeltaRow[] | null = null
  let maxAbsDelta: number | null = null
  if (rt && Object.keys(rt).length > 0) {
    deltaRows = effectDeltas(rt, solution.total)
    maxAbsDelta = Math.max(0, ...deltaRows.map(d => Math.abs(d.delta)))
  }

  return {
    referenceId: ref.id,
    typePattern,
    cards,
    effectDeltas: deltaRows,
    maxAbsDelta,
  }
}
