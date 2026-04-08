import type { SupabaseClient } from '@supabase/supabase-js'
import { getGametoraManifestJson } from './gametoraCache'

/** Serialized key for API / Rust `AffinityLevel`. */
export type SparkAffinityLevel = 'triangle' | 'circle' | 'double_circle' | 'max'

export const SPARK_AFFINITY_SYMBOL: Record<SparkAffinityLevel, string> = {
  triangle: '△',
  circle: '○',
  double_circle: '◎',
  max: '◎◎',
}

export function successionPairKey(runnerTraineeId: number, memberTraineeId: number): string {
  return `${runnerTraineeId}:${memberTraineeId}`
}

/**
 * GameTora `succession_relation` / wiki-style total score → discrete mid-run spark tier.
 * Approximate bands ( community calculators use ~60 / 90 / 120 as UI breakpoints ).
 */
export function successionScoreToAffinity(totalScore: number): SparkAffinityLevel {
  if (totalScore >= 150) return 'max'
  if (totalScore >= 120) return 'double_circle'
  if (totalScore >= 90) return 'circle'
  return 'triangle'
}

/** Parsed GameTora succession masters (`succession_relation` + `succession_relation_member`). */
export interface SuccessionData {
  /** relation_type → relation_point (points per matching trait). */
  relationPointByType: Map<number, number>
  /** card_id / trainee id → relation types that character participates in. */
  typesByChara: Map<number, Set<number>>
}

function coerceInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10)
  return null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function extractRowArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(x => asRecord(x)) as Record<string, unknown>[]
  }
  const o = asRecord(data)
  if (!o) return []
  for (const k of ['items', 'data', 'rows', 'list', 'entries']) {
    const v = o[k]
    if (Array.isArray(v)) return v.filter(x => asRecord(x)) as Record<string, unknown>[]
  }
  return []
}

function parseRelationRows(data: unknown): Map<number, number> {
  const out = new Map<number, number>()
  for (const row of extractRowArray(data)) {
    const t = coerceInt(row.relation_type ?? row['relation_type'])
    const p = coerceInt(row.relation_point ?? row['relation_point'])
    if (t != null && p != null) out.set(t, p)
  }
  return out
}

function parseMemberRows(data: unknown): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>()
  for (const row of extractRowArray(data)) {
    const cid = coerceInt(row.chara_id ?? row['chara_id'])
    const rt = coerceInt(row.relation_type ?? row['relation_type'])
    if (cid == null || rt == null) continue
    let set = out.get(cid)
    if (!set) {
      set = new Set<number>()
      out.set(cid, set)
    }
    set.add(rt)
  }
  return out
}

function sumSharedPoints(
  relationPointByType: Map<number, number>,
  charIds: number[],
  typesByChara: Map<number, Set<number>>,
): number | null {
  const sets: Set<number>[] = []
  for (const id of charIds) {
    const s = typesByChara.get(id)
    if (!s || s.size === 0) return null
    sets.push(s)
  }
  if (sets.length === 0) return null
  let shared = new Set(sets[0]!)
  for (let i = 1; i < sets.length; i++) {
    shared = new Set([...shared].filter(t => sets[i]!.has(t)))
  }
  let score = 0
  for (const t of shared) {
    score += relationPointByType.get(t) ?? 0
  }
  return score
}

/**
 * @param parentTraineeId — For grandparents, pass the slot parent’s trainee id so we use the
 *   game’s 3-way rule (runner ∩ parent ∩ grandparent). Omit for parents.
 */
export function lookupSparkAffinity(
  data: SuccessionData,
  runnerTraineeId: number,
  memberTraineeId: number,
  parentTraineeId?: number | null,
): SparkAffinityLevel | undefined {
  const ids =
    parentTraineeId != null
      ? [runnerTraineeId, parentTraineeId, memberTraineeId]
      : [runnerTraineeId, memberTraineeId]
  const score = sumSharedPoints(data.relationPointByType, ids, data.typesByChara)
  if (score === null) return undefined
  return successionScoreToAffinity(score)
}

const RELATION_MANIFEST_KEYS = ['en/db-files/succession_relation', 'db-files/succession_relation'] as const
const MEMBER_MANIFEST_KEYS = ['en/db-files/succession_relation_member', 'db-files/succession_relation_member'] as const

let cachedData: SuccessionData | null = null
let inflight: Promise<SuccessionData | null> | null = null

async function loadManifestJson(
  supabase: SupabaseClient,
  keys: readonly string[],
): Promise<unknown | null> {
  for (const key of keys) {
    try {
      return await getGametoraManifestJson(supabase, key)
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * Load succession masters from GameTora (Supabase cache when configured).
 * Returns null if manifest keys are missing or payloads cannot be parsed.
 */
export async function getSuccessionData(supabase: SupabaseClient): Promise<SuccessionData | null> {
  if (cachedData) return cachedData
  if (inflight) return inflight

  inflight = (async () => {
    const [relRaw, memRaw] = await Promise.all([
      loadManifestJson(supabase, RELATION_MANIFEST_KEYS),
      loadManifestJson(supabase, MEMBER_MANIFEST_KEYS),
    ])
    if (!relRaw || !memRaw) {
      cachedData = null
      return null
    }
    const relationPointByType = parseRelationRows(relRaw)
    const typesByChara = parseMemberRows(memRaw)
    if (relationPointByType.size === 0 || typesByChara.size === 0) {
      cachedData = null
      return null
    }
    cachedData = { relationPointByType, typesByChara }
    return cachedData
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

