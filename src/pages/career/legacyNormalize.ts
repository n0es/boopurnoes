import type { Factor, LegacyMember, LegacySlot, LegacyTree } from './legacyTypes'

/** JSON / DB payloads may store stat_index or stars as strings; game only uses 0–4 and 1–3. */
export function coerceBlueStat(f: Extract<Factor, { type: 'BlueStat' }>): Extract<Factor, { type: 'BlueStat' }> {
  let idx = Math.round(Number(f.stat_index))
  if (!Number.isFinite(idx)) idx = 0
  idx = Math.min(4, Math.max(0, idx))
  let stars = Math.round(Number(f.stars))
  if (!Number.isFinite(stars) || stars < 1) stars = 1
  if (stars > 3) stars = 3
  return { type: 'BlueStat', stat_index: idx, stars }
}

function isBlueStatLike(f: Factor | Record<string, unknown>): boolean {
  if (!f || typeof f !== 'object') return false
  const t = 'type' in f && f.type != null ? String(f.type) : ''
  if (t === 'BlueStat' || t.replace(/_/g, '').toLowerCase() === 'bluestat') return true
  const o = f as Record<string, unknown>
  if ('skill_id' in o || 'apt_name' in o || 'race_name' in o) return false
  if (!('stat_index' in o) || !('stars' in o)) return false
  if ('name' in o && typeof o.name === 'string' && o.type !== 'BlueStat') return false
  return true
}

/** At most one blue, pink, and green per member; unlimited white. Drops extras (e.g. old UI state). */
export function normalizeMemberFactors(factors: Factor[]): Factor[] {
  let blue: Factor | null = null
  let pink: Factor | null = null
  let green: Factor | null = null
  const whites: Factor[] = []
  for (const f of factors) {
    const loose = f as Factor | Record<string, unknown>
    if (f.type === 'BlueStat' || isBlueStatLike(loose)) {
      if (!blue) {
        const o = loose as Record<string, unknown>
        blue = coerceBlueStat({
          type: 'BlueStat',
          stat_index: 'stat_index' in o ? (o.stat_index as number) : 0,
          stars: 'stars' in o ? (o.stars as number) : 1,
        })
      }
    } else if (f.type === 'Aptitude') {
      if (!pink) pink = f
    } else if (f.type === 'UniqueSkill') {
      if (!green) green = f
    } else if (f.type === 'SkillHint' || f.type === 'RaceBonus' || f.type === 'Scenario') {
      whites.push(f)
    }
  }
  return [...[blue, pink, green].filter(Boolean) as Factor[], ...whites]
}

function emptyLegacySlot(): LegacySlot {
  const m = (): LegacyMember => ({ name: '', factors: [], trainee_id: null })
  return { parent: m(), grandparent_1: m(), grandparent_2: m() }
}

/**
 * Normalize persisted / API-shaped trees: tolerate missing `factors`, partial slots, or bad members
 * so we don't wipe the whole tree in `coerceLegacy` catch blocks.
 */
export function normalizeLegacyTree(tree: LegacyTree | null | undefined): LegacyTree {
  const normMember = (m: LegacyMember | null | undefined): LegacyMember => {
    if (!m || typeof m !== 'object') return { name: '', factors: [], trainee_id: null }
    const raw = Array.isArray(m.factors) ? m.factors : []

    const base: LegacyMember = {
      name: typeof m.name === 'string' ? m.name : '',
      factors: normalizeMemberFactors(raw),
      trainee_id: m.trainee_id ?? null,
    }
    if (m.spark_affinity != null) return { ...base, spark_affinity: m.spark_affinity }
    return base
  }
  const normSlot = (s: LegacySlot | null | undefined): LegacySlot => {
    if (!s || typeof s !== 'object') return emptyLegacySlot()
    return {
      parent: normMember(s.parent),
      grandparent_1: normMember(s.grandparent_1),
      grandparent_2: normMember(s.grandparent_2),
    }
  }
  const root = tree && typeof tree === 'object' ? tree : undefined
  return {
    legacy_1: normSlot(root?.legacy_1),
    legacy_2: normSlot(root?.legacy_2),
  }
}
