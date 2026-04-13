/**
 * Hot path for deck search: dense numeric matrices only (no per-iteration object alloc).
 * Used from the browser (main thread or worker) and from the Node server.
 */

export interface CompactDeckInput {
  /** Number of constrained stat dimensions. */
  k: number
  /** Row-major: owned[i * k + j] */
  ownedFlat: Float64Array
  /** Row-major: pool[i * k + j] */
  poolFlat: Float64Array
  ownedIds: Int32Array
  poolIds: Int32Array
  /** Per-column total must be in [targetMin[j], targetMax[j]] for all j. */
  targetMin: Float64Array
  targetMax: Float64Array
  maxTimeMs: number
  /** Check clock every N inner candidates (reduces Date.now overhead). */
  deadlineCheckEvery?: number
  /**
   * Return up to this many valid decks. When 1, stops at the first match (fast).
   * When &gt; 1, keeps the best decks by per-card score sum (requires ownedScore / poolScore).
   */
  maxSolutions?: number
  /** Sum of all effect values at max level for each owned row — used when maxSolutions &gt; 1. */
  ownedScore?: Float64Array
  /** Same for each pool / wildcard row. */
  poolScore?: Float64Array
  /**
   * Indices into `ownedIds` that must appear in every 5-card combo (sorted, unique, length 0–5).
   * Omitted or empty = no restriction.
   */
  requiredOwnedIndices?: Int32Array
  /** If set (&gt;= 0), only this pool row may be the friend slot. */
  forcedPoolIndex?: number
  /**
   * Optional constraint relaxation tiers.  Each entry is a pair [targetMin, targetMax]
   * representing progressively looser constraints.  If the primary constraints yield
   * no results the solver retries with each tier in order without re-walking the combo
   * space from scratch — it just resets the result buffer and continues.
   *
   * Length should be small (0–3 tiers).  Omit for no auto-relaxation.
   */
  relaxTiers?: Array<{ targetMin: Float64Array; targetMax: Float64Array }>
  /**
   * Card training-type ID per owned card (e.g. 0=speed, 1=stamina, …).
   * Used for synergy scoring — same-type pairs get a bonus.
   */
  ownedTypes?: Int8Array
  /** Card training-type ID per pool card. */
  poolTypes?: Int8Array
  /**
   * Score bonus per pair of same-type cards in a 6-card deck.
   * E.g. 3 speed cards → 3 pairs → bonus = 3 × synergyWeight.
   * Default 0 (disabled).
   */
  synergyWeight?: number
}

export interface CompactDeckSolutionEntry {
  ownedIdx: [number, number, number, number, number]
  poolIdx: number
  /** Sum of six per-card "total effect value" scores — higher means more overall bonuses. */
  score: number
}

export interface CompactDeckResult {
  /** Valid decks, sorted by score descending. Empty if none. */
  solutions: CompactDeckSolutionEntry[]
  iterations: number
  capped: boolean
  /** 0 = original constraints; 1+ = which relaxation tier produced results. */
  relaxTierUsed: number
}

function poolColMinMax(
  poolFlat: Float64Array,
  poolRows: number,
  k: number,
  outMin: Float64Array,
  outMax: Float64Array,
): void {
  for (let j = 0; j < k; j++) {
    let mn = Number.POSITIVE_INFINITY
    let mx = Number.NEGATIVE_INFINITY
    for (let i = 0; i < poolRows; i++) {
      const v = poolFlat[i * k + j]!
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    outMin[j] = mn
    outMax[j] = mx
  }
}

function sum5Owned(
  ownedFlat: Float64Array,
  k: number,
  i0: number,
  i1: number,
  i2: number,
  i3: number,
  i4: number,
  out: Float64Array,
): void {
  const b0 = i0 * k
  const b1 = i1 * k
  const b2 = i2 * k
  const b3 = i3 * k
  const b4 = i4 * k
  for (let j = 0; j < k; j++) {
    out[j] =
      ownedFlat[b0 + j]! +
      ownedFlat[b1 + j]! +
      ownedFlat[b2 + j]! +
      ownedFlat[b3 + j]! +
      ownedFlat[b4 + j]!
  }
}

function canWildcardWork(
  sum5: Float64Array,
  k: number,
  targetMin: Float64Array,
  targetMax: Float64Array,
  poolMin: Float64Array,
  poolMax: Float64Array,
): boolean {
  for (let j = 0; j < k; j++) {
    const needLo = targetMin[j]! - sum5[j]!
    const needHi = targetMax[j]! - sum5[j]!
    if (poolMax[j]! < needLo || poolMin[j]! > needHi) return false
  }
  return true
}

function comboIncludesAllRequired(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  required: Int32Array,
): boolean {
  for (let i = 0; i < required.length; i++) {
    const x = required[i]!
    if (x !== a && x !== b && x !== c && x !== d && x !== e) return false
  }
  return true
}

/** Number of ways to choose 5 cards from n (search outer loop size). */
export function binomialChoose5(n: number): number {
  if (n < 5) return 0
  let r = 1
  for (let i = 1; i <= 5; i++) {
    r = (r * (n - 5 + i)) / i
  }
  return Math.round(r)
}

export interface DeckSolveProgress {
  comboIdx: number
  totalCombos: number
  iterations: number
}

export interface SolveDeckCompactOptions {
  onProgress?: (p: DeckSolveProgress) => void
  /** Emit after every N five-card combos (default 4096). */
  progressEveryCombo?: number
  /** Emit when inner checks cross multiples of this (default 131072). */
  progressEveryIterations?: number
}

/** Minimum-tracking top-K buffer. */
class TopKBuffer {
  private buf: CompactDeckSolutionEntry[] = []
  private readonly K: number
  minScore = -Infinity

  constructor(k: number) {
    this.K = k
  }

  get length() { return this.buf.length }
  get full() { return this.buf.length >= this.K }

  push(entry: CompactDeckSolutionEntry): void {
    if (this.buf.length < this.K) {
      this.buf.push(entry)
      if (this.buf.length === this.K) this._recomputeMin()
      return
    }
    if (entry.score <= this.minScore) return
    // Replace the current minimum
    let minI = 0
    for (let i = 1; i < this.buf.length; i++) {
      if (this.buf[i]!.score < this.buf[minI]!.score) minI = i
    }
    this.buf[minI] = entry
    this._recomputeMin()
  }

  private _recomputeMin(): void {
    let m = Infinity
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i]!.score < m) m = this.buf[i]!.score
    }
    this.minScore = m
  }

  sorted(): CompactDeckSolutionEntry[] {
    return this.buf.sort((a, b) => b.score - a.score)
  }

  clear(): void {
    this.buf.length = 0
    this.minScore = -Infinity
  }
}

/**
 * Brute force with branch-and-bound pruning and optional constraint relaxation.
 *
 * **Branch-and-bound** (top-K mode only): owned cards are sorted by score
 * descending.  At each loop level an upper-bound check prunes subtrees that
 * cannot beat the weakest entry already in the top-K buffer — often eliminating
 * 80–95 % of the combo space.
 *
 * **Relaxation tiers**: if `input.relaxTiers` is provided and the primary
 * constraints yield no results, the solver automatically retries with each tier
 * in order *without* re-creating a Web Worker or re-building the payload.
 */
export function solveDeckCompact(
  input: CompactDeckInput,
  opts?: SolveDeckCompactOptions,
): CompactDeckResult {
  const {
    k,
    ownedFlat: rawOwnedFlat,
    poolFlat,
    ownedIds: rawOwnedIds,
    poolIds,
    targetMin: primaryTargetMin,
    targetMax: primaryTargetMax,
    maxTimeMs,
    deadlineCheckEvery = 4096,
    maxSolutions: maxSolutionsRaw,
    ownedScore: rawOwnedScore,
    poolScore,
    requiredOwnedIndices: rawRequired,
    forcedPoolIndex: forcedPoolIndexRaw,
    relaxTiers,
    ownedTypes: rawOwnedTypes,
    poolTypes: rawPoolTypes,
    synergyWeight: synergyWeightRaw,
  } = input

  const useSynergy = (synergyWeightRaw ?? 0) > 0 && rawOwnedTypes != null && rawPoolTypes != null
  const synergyWeight = useSynergy ? synergyWeightRaw! : 0

  const onProgress = opts?.onProgress
  const progressEveryCombo = Math.max(1, opts?.progressEveryCombo ?? 4096)
  const progressEveryIterations = Math.max(1, opts?.progressEveryIterations ?? 131_072)

  const maxSol = Math.min(100, Math.max(1, maxSolutionsRaw ?? 1))
  const useTopK = maxSol > 1

  const nOwned = rawOwnedIds.length
  const nPool = poolIds.length

  const forcedPoolIndex = forcedPoolIndexRaw !== undefined && forcedPoolIndexRaw >= 0 ? forcedPoolIndexRaw : -1

  if (rawRequired && rawRequired.length > 5) {
    return { solutions: [], iterations: 0, capped: false, relaxTierUsed: 0 }
  }
  if (forcedPoolIndex >= nPool) {
    return { solutions: [], iterations: 0, capped: false, relaxTierUsed: 0 }
  }
  if (rawRequired && rawRequired.length > 0) {
    for (let i = 0; i < rawRequired.length; i++) {
      const ix = rawRequired[i]!
      if (ix < 0 || ix >= nOwned) {
        return { solutions: [], iterations: 0, capped: false, relaxTierUsed: 0 }
      }
    }
  }

  if (k <= 0 || nOwned < 5 || nPool === 0) {
    return { solutions: [], iterations: 0, capped: false, relaxTierUsed: 0 }
  }

  if (
    useTopK &&
    (!rawOwnedScore ||
      !poolScore ||
      rawOwnedScore.length !== nOwned ||
      poolScore.length !== nPool)
  ) {
    return { solutions: [], iterations: 0, capped: false, relaxTierUsed: 0 }
  }

  // ── Sort owned cards by score descending for branch-and-bound ────────
  // Build a permutation so the highest-score cards come first.  When the
  // top-K buffer fills, upper-bound checks at each loop level can break
  // early because all subsequent combos have lower-or-equal total score.

  const sortOrder = Array.from<number>({ length: nOwned }).fill(0).map((_, i) => i)
  if (useTopK && rawOwnedScore) {
    sortOrder.sort((x, y) => rawOwnedScore[y]! - rawOwnedScore[x]!)
  }

  // Build remapped owned arrays following sortOrder
  const ownedFlat = new Float64Array(nOwned * k)
  const ownedIds = new Int32Array(nOwned)
  const ownedScore = rawOwnedScore ? new Float64Array(nOwned) : undefined
  for (let i = 0; i < nOwned; i++) {
    const src = sortOrder[i]!
    ownedIds[i] = rawOwnedIds[src]!
    if (ownedScore && rawOwnedScore) ownedScore[i] = rawOwnedScore[src]!
    const dstBase = i * k
    const srcBase = src * k
    for (let j = 0; j < k; j++) ownedFlat[dstBase + j] = rawOwnedFlat[srcBase + j]!
  }

  // Remap owned types following sorted order
  let ownedTypes: Int8Array | undefined
  if (useSynergy && rawOwnedTypes) {
    ownedTypes = new Int8Array(nOwned)
    for (let i = 0; i < nOwned; i++) ownedTypes[i] = rawOwnedTypes[sortOrder[i]!]!
  }
  const poolTypes = rawPoolTypes // pool is not re-sorted

  // Max synergy bonus: 6 cards all same type → C(6,2) = 15 pairs
  const maxSynergyBonus = useSynergy ? 15 * synergyWeight : 0

  // Remap required-owned indices into sorted space
  let requiredOwnedIndices: Int32Array | undefined
  if (rawRequired && rawRequired.length > 0) {
    const reverseMap = new Int32Array(nOwned)
    for (let i = 0; i < nOwned; i++) reverseMap[sortOrder[i]!] = i
    requiredOwnedIndices = new Int32Array(rawRequired.length)
    for (let i = 0; i < rawRequired.length; i++) {
      requiredOwnedIndices[i] = reverseMap[rawRequired[i]!]!
    }
  }

  // Max pool card score (for upper-bound computation).
  // Includes max possible synergy so the bound is still valid.
  let maxPoolScore = 0
  if (poolScore) {
    for (let i = 0; i < poolScore.length; i++) {
      if (poolScore[i]! > maxPoolScore) maxPoolScore = poolScore[i]!
    }
  }
  maxPoolScore += maxSynergyBonus

  // ── Constraint tiers: primary + any relaxation tiers ─────────────────
  const constraintTiers: Array<{ targetMin: Float64Array; targetMax: Float64Array }> = [
    { targetMin: primaryTargetMin, targetMax: primaryTargetMax },
  ]
  if (relaxTiers) {
    for (const tier of relaxTiers) constraintTiers.push(tier)
  }

  const totalCombos = binomialChoose5(nOwned)
  const deadline = Date.now() + maxTimeMs
  const poolMin = new Float64Array(k)
  const poolMax = new Float64Array(k)
  poolColMinMax(poolFlat, nPool, k, poolMin, poolMax)
  const sum5 = new Float64Array(k)

  let totalIterations = 0
  // Scratch array for type counting (reused across combos to avoid alloc)
  const synTypeCounts = new Int32Array(8)

  for (let tier = 0; tier < constraintTiers.length; tier++) {
    const { targetMin, targetMax } = constraintTiers[tier]!

    let iterations = 0
    let innerSinceCheck = 0
    let comboIdx = 0
    let lastProgressIter = 0
    const topBuf = new TopKBuffer(maxSol)

    const emitProgress = () => {
      if (onProgress) onProgress({ comboIdx, totalCombos, iterations: totalIterations + iterations })
    }

    const n = nOwned
    let capped = false

    outer_a:
    for (let a = 0; a < n - 4; a++) {
      // Branch-and-bound: upper bound for all combos starting with a
      if (useTopK && ownedScore && topBuf.full) {
        // Best possible: score[a] + next 4 best (a+1..a+4) + maxPoolScore
        const ub = ownedScore[a]! + ownedScore[a + 1]! + ownedScore[a + 2]! + ownedScore[a + 3]! + ownedScore[a + 4]! + maxPoolScore
        if (ub <= topBuf.minScore) break outer_a
      }
      for (let b = a + 1; b < n - 3; b++) {
        if (useTopK && ownedScore && topBuf.full) {
          const ub = ownedScore[a]! + ownedScore[b]! + ownedScore[b + 1]! + ownedScore[b + 2]! + ownedScore[b + 3]! + maxPoolScore
          if (ub <= topBuf.minScore) break
        }
        for (let c = b + 1; c < n - 2; c++) {
          if (useTopK && ownedScore && topBuf.full) {
            const ub = ownedScore[a]! + ownedScore[b]! + ownedScore[c]! + ownedScore[c + 1]! + ownedScore[c + 2]! + maxPoolScore
            if (ub <= topBuf.minScore) break
          }
          for (let d = c + 1; d < n - 1; d++) {
            if (useTopK && ownedScore && topBuf.full) {
              const ub = ownedScore[a]! + ownedScore[b]! + ownedScore[c]! + ownedScore[d]! + ownedScore[d + 1]! + maxPoolScore
              if (ub <= topBuf.minScore) break
            }
            for (let e = d + 1; e < n; e++) {
              comboIdx++
              if (onProgress && comboIdx % progressEveryCombo === 0) {
                emitProgress()
              }
              if ((comboIdx & 4095) === 0 && Date.now() > deadline) {
                capped = true
                break outer_a
              }

              // Branch-and-bound: full combo score check
              if (useTopK && ownedScore && topBuf.full) {
                const ub = ownedScore[a]! + ownedScore[b]! + ownedScore[c]! + ownedScore[d]! + ownedScore[e]! + maxPoolScore
                if (ub <= topBuf.minScore) continue
              }

              if (
                requiredOwnedIndices &&
                requiredOwnedIndices.length > 0 &&
                !comboIncludesAllRequired(a, b, c, d, e, requiredOwnedIndices)
              ) {
                continue
              }

              sum5Owned(ownedFlat, k, a, b, c, d, e, sum5)

              if (!canWildcardWork(sum5, k, targetMin, targetMax, poolMin, poolMax)) continue

              const ida = ownedIds[a]!
              const idb = ownedIds[b]!
              const idc = ownedIds[c]!
              const idd = ownedIds[d]!
              const ide = ownedIds[e]!

              // Precompute 5-card type distribution and base synergy for this combo.
              // synergy = number of same-type pairs = Σ C(n_t, 2) for each type t.
              // Incrementally: adding pool card of type T adds typeCounts5[T] new pairs.
              let baseSynergy5 = 0
              // Reuse a fixed-size scratch array (8 types max: 0–7).
              const tc0 = synTypeCounts
              tc0[0] = 0; tc0[1] = 0; tc0[2] = 0; tc0[3] = 0
              tc0[4] = 0; tc0[5] = 0; tc0[6] = 0; tc0[7] = 0
              if (useSynergy && ownedTypes) {
                tc0[ownedTypes[a]!]++
                tc0[ownedTypes[b]!]++
                tc0[ownedTypes[c]!]++
                tc0[ownedTypes[d]!]++
                tc0[ownedTypes[e]!]++
                for (let t = 0; t < 8; t++) {
                  const nt = tc0[t]!
                  baseSynergy5 += (nt * (nt - 1)) >> 1 // C(n,2)
                }
              }

              const piLo = forcedPoolIndex >= 0 ? forcedPoolIndex : 0
              const piHi = forcedPoolIndex >= 0 ? forcedPoolIndex + 1 : nPool
              for (let pi = piLo; pi < piHi; pi++) {
                const pid = poolIds[pi]!
                if (pid === ida || pid === idb || pid === idc || pid === idd || pid === ide) continue

                innerSinceCheck++
                if (innerSinceCheck >= deadlineCheckEvery) {
                  innerSinceCheck = 0
                  if (Date.now() > deadline) {
                    capped = true
                    break outer_a
                  }
                }

                iterations++
                if (
                  onProgress &&
                  iterations - lastProgressIter >= progressEveryIterations
                ) {
                  lastProgressIter = iterations
                  emitProgress()
                }
                const row = pi * k
                let ok = true
                for (let j = 0; j < k; j++) {
                  const t = sum5[j]! + poolFlat[row + j]!
                  if (t < targetMin[j]! || t > targetMax[j]!) {
                    ok = false
                    break
                  }
                }
                if (!ok) continue

                if (!useTopK) {
                  totalIterations += iterations
                  // Map sorted index → original index
                  return {
                    solutions: [
                      {
                        ownedIdx: [sortOrder[a]!, sortOrder[b]!, sortOrder[c]!, sortOrder[d]!, sortOrder[e]!] as [number, number, number, number, number],
                        poolIdx: pi,
                        score: 0,
                      },
                    ],
                    iterations: totalIterations,
                    capped: false,
                    relaxTierUsed: tier,
                  }
                }

                let sc =
                  ownedScore![a]! +
                  ownedScore![b]! +
                  ownedScore![c]! +
                  ownedScore![d]! +
                  ownedScore![e]! +
                  poolScore![pi]!
                // Add synergy bonus: base 5-card pairs + new pairs from pool card's type
                if (useSynergy && poolTypes) {
                  const poolT = poolTypes[pi]!
                  sc += (baseSynergy5 + tc0[poolT]!) * synergyWeight
                }
                topBuf.push({
                  ownedIdx: [sortOrder[a]!, sortOrder[b]!, sortOrder[c]!, sortOrder[d]!, sortOrder[e]!] as [number, number, number, number, number],
                  poolIdx: pi,
                  score: sc,
                })
              }
            }
          }
        }
      }
    }

    totalIterations += iterations

    if (useTopK && topBuf.length > 0) {
      return { solutions: topBuf.sorted(), iterations: totalIterations, capped, relaxTierUsed: tier }
    }
    if (capped) {
      // Timed out — return whatever we have (even empty) without trying further tiers
      if (useTopK) {
        return { solutions: topBuf.sorted(), iterations: totalIterations, capped: true, relaxTierUsed: tier }
      }
      return { solutions: [], iterations: totalIterations, capped: true, relaxTierUsed: tier }
    }

    // No solutions found at this tier — try the next one
    // (progress will continue from where totalIterations left off)
  }

  return { solutions: [], iterations: totalIterations, capped: false, relaxTierUsed: constraintTiers.length - 1 }
}

/** Build typed arrays from JSON-safe nested number arrays (worker / HTTP). */
export function compactInputFromJson(raw: {
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
  relaxTiers?: Array<{ targetMin: number[]; targetMax: number[] }>
  ownedTypes?: number[]
  poolTypes?: number[]
  synergyWeight?: number
}): CompactDeckInput {
  const k = raw.k
  const nO = raw.owned.length
  const nP = raw.pool.length
  const ownedFlat = new Float64Array(nO * k)
  const poolFlat = new Float64Array(nP * k)
  for (let i = 0; i < nO; i++) {
    const row = raw.owned[i]!
    for (let j = 0; j < k; j++) ownedFlat[i * k + j] = row[j] ?? 0
  }
  for (let i = 0; i < nP; i++) {
    const row = raw.pool[i]!
    for (let j = 0; j < k; j++) poolFlat[i * k + j] = row[j] ?? 0
  }
  const out: CompactDeckInput = {
    k,
    ownedFlat,
    poolFlat,
    ownedIds: Int32Array.from(raw.ownedIds),
    poolIds: Int32Array.from(raw.poolIds),
    targetMin: Float64Array.from(raw.targetMin),
    targetMax: Float64Array.from(raw.targetMax),
    maxTimeMs: raw.maxTimeMs,
  }
  if (raw.maxSolutions != null) out.maxSolutions = raw.maxSolutions
  if (raw.ownedScore != null) out.ownedScore = Float64Array.from(raw.ownedScore)
  if (raw.poolScore != null) out.poolScore = Float64Array.from(raw.poolScore)
  if (raw.requiredOwnedIndices != null && raw.requiredOwnedIndices.length > 0) {
    out.requiredOwnedIndices = Int32Array.from(raw.requiredOwnedIndices)
  }
  if (raw.forcedPoolIndex != null && raw.forcedPoolIndex >= 0) {
    out.forcedPoolIndex = raw.forcedPoolIndex
  }
  if (raw.relaxTiers != null && raw.relaxTiers.length > 0) {
    out.relaxTiers = raw.relaxTiers.map(t => ({
      targetMin: Float64Array.from(t.targetMin),
      targetMax: Float64Array.from(t.targetMax),
    }))
  }
  if (raw.ownedTypes != null) out.ownedTypes = Int8Array.from(raw.ownedTypes)
  if (raw.poolTypes != null) out.poolTypes = Int8Array.from(raw.poolTypes)
  if (raw.synergyWeight != null) out.synergyWeight = raw.synergyWeight
  return out
}
