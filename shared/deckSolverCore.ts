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
}

export interface CompactDeckSolutionEntry {
  ownedIdx: [number, number, number, number, number]
  poolIdx: number
  /** Sum of six per-card “total effect value” scores — higher means more overall bonuses. */
  score: number
}

export interface CompactDeckResult {
  /** Valid decks, sorted by score descending. Empty if none. */
  solutions: CompactDeckSolutionEntry[]
  iterations: number
  capped: boolean
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
      const v = poolFlat[i * k + j]
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
      ownedFlat[b0 + j] +
      ownedFlat[b1 + j] +
      ownedFlat[b2 + j] +
      ownedFlat[b3 + j] +
      ownedFlat[b4 + j]
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
    const needLo = targetMin[j] - sum5[j]
    const needHi = targetMax[j] - sum5[j]
    if (poolMax[j] < needLo || poolMin[j] > needHi) return false
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
  /** Emit after every N five-card combos (default 512). */
  progressEveryCombo?: number
  /** Emit when inner checks cross multiples of this (default 65536). */
  progressEveryIterations?: number
}

function pushTopK(buf: CompactDeckSolutionEntry[], K: number, entry: CompactDeckSolutionEntry): void {
  if (buf.length < K) {
    buf.push(entry)
    return
  }
  let minI = 0
  for (let i = 1; i < buf.length; i++) {
    if (buf[i].score < buf[minI].score) minI = i
  }
  if (entry.score > buf[minI].score) buf[minI] = entry
}

/**
 * Brute force with tight inner loops and periodic deadline checks only.
 * `maxSolutions === 1`: first valid deck (original behavior).
 * `maxSolutions > 1`: among all valid decks found before timeout, keep the top `maxSolutions` by score.
 */
export function solveDeckCompact(
  input: CompactDeckInput,
  opts?: SolveDeckCompactOptions,
): CompactDeckResult {
  const {
    k,
    ownedFlat,
    poolFlat,
    ownedIds,
    poolIds,
    targetMin,
    targetMax,
    maxTimeMs,
    deadlineCheckEvery = 4096,
    maxSolutions: maxSolutionsRaw,
    ownedScore,
    poolScore,
    requiredOwnedIndices,
    forcedPoolIndex: forcedPoolIndexRaw,
  } = input

  const onProgress = opts?.onProgress
  const progressEveryCombo = Math.max(1, opts?.progressEveryCombo ?? 512)
  const progressEveryIterations = Math.max(1, opts?.progressEveryIterations ?? 65_536)

  const maxSol = Math.min(100, Math.max(1, maxSolutionsRaw ?? 1))
  const useTopK = maxSol > 1

  const nOwned = ownedIds.length
  const nPool = poolIds.length

  const forcedPoolIndex = forcedPoolIndexRaw !== undefined && forcedPoolIndexRaw >= 0 ? forcedPoolIndexRaw : -1

  if (requiredOwnedIndices && requiredOwnedIndices.length > 5) {
    return { solutions: [], iterations: 0, capped: false }
  }
  if (forcedPoolIndex >= nPool) {
    return { solutions: [], iterations: 0, capped: false }
  }
  if (requiredOwnedIndices && requiredOwnedIndices.length > 0) {
    for (let i = 0; i < requiredOwnedIndices.length; i++) {
      const ix = requiredOwnedIndices[i]!
      if (ix < 0 || ix >= nOwned) {
        return { solutions: [], iterations: 0, capped: false }
      }
    }
  }

  if (k <= 0 || nOwned < 5 || nPool === 0) {
    return { solutions: [], iterations: 0, capped: false }
  }

  if (
    useTopK &&
    (!ownedScore ||
      !poolScore ||
      ownedScore.length !== nOwned ||
      poolScore.length !== nPool)
  ) {
    return { solutions: [], iterations: 0, capped: false }
  }

  const totalCombos = binomialChoose5(nOwned)

  const deadline = Date.now() + maxTimeMs
  const poolMin = new Float64Array(k)
  const poolMax = new Float64Array(k)
  poolColMinMax(poolFlat, nPool, k, poolMin, poolMax)

  const sum5 = new Float64Array(k)
  let iterations = 0
  let innerSinceCheck = 0
  let comboIdx = 0
  let lastProgressIter = 0
  const topBuf: CompactDeckSolutionEntry[] = []

  const emitProgress = () => {
    if (onProgress) onProgress({ comboIdx, totalCombos, iterations })
  }

  const n = nOwned
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            comboIdx++
            if (onProgress && (comboIdx === 1 || comboIdx % progressEveryCombo === 0)) {
              emitProgress()
            }
            if ((comboIdx & 1023) === 0 && Date.now() > deadline) {
              if (useTopK) {
                topBuf.sort((x, y) => y.score - x.score)
                return { solutions: topBuf, iterations, capped: true }
              }
              return { solutions: [], iterations, capped: true }
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

            const piLo = forcedPoolIndex >= 0 ? forcedPoolIndex : 0
            const piHi = forcedPoolIndex >= 0 ? forcedPoolIndex + 1 : nPool
            for (let pi = piLo; pi < piHi; pi++) {
              const pid = poolIds[pi]!
              if (pid === ida || pid === idb || pid === idc || pid === idd || pid === ide) continue

              innerSinceCheck++
              if (innerSinceCheck >= deadlineCheckEvery) {
                innerSinceCheck = 0
                if (Date.now() > deadline) {
                  if (useTopK) {
                    topBuf.sort((x, y) => y.score - x.score)
                    return { solutions: topBuf, iterations, capped: true }
                  }
                  return { solutions: [], iterations, capped: true }
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
                return {
                  solutions: [
                    {
                      ownedIdx: [a, b, c, d, e],
                      poolIdx: pi,
                      score: 0,
                    },
                  ],
                  iterations,
                  capped: false,
                }
              }

              const sc =
                ownedScore![a]! +
                ownedScore![b]! +
                ownedScore![c]! +
                ownedScore![d]! +
                ownedScore![e]! +
                poolScore![pi]!
              pushTopK(topBuf, maxSol, { ownedIdx: [a, b, c, d, e], poolIdx: pi, score: sc })
            }
          }

  if (useTopK) {
    topBuf.sort((x, y) => y.score - x.score)
    return { solutions: topBuf, iterations, capped: false }
  }
  return { solutions: [], iterations, capped: false }
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
  return out
}
