import { normalizeMemberFactors } from '../pages/career/legacyNormalize'
import type { LegacyMember, LegacySlot, LegacyTree } from '../pages/career/legacyTypes'

export interface StatBlock {
  speed: number
  stamina: number
  power: number
  guts: number
  wisdom: number
}

const EMPTY: StatBlock = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 }

function normalizeSlot(s: LegacySlot): LegacySlot {
  const norm = (m: LegacyMember): LegacyMember => ({
    ...m,
    factors: normalizeMemberFactors(m.factors),
  })
  return {
    parent: norm(s.parent),
    grandparent_1: norm(s.grandparent_1),
    grandparent_2: norm(s.grandparent_2),
  }
}

export function normalizeLegacyTreeStats(tree: LegacyTree): LegacyTree {
  return {
    legacy_1: normalizeSlot(tree.legacy_1),
    legacy_2: normalizeSlot(tree.legacy_2),
  }
}

/** Matches `uma-optimizer` `Factor::initial_stat_gain`: 1★=5, 2★=12, 3★=21 */
export function blueStarsToStartingPoints(stars: number | string): number {
  const n = Math.round(Number(stars))
  if (n === 1) return 5
  if (n === 2) return 12
  if (n === 3) return 21
  return 0
}

function statBlockSum(s: StatBlock): number {
  return s.speed + s.stamina + s.power + s.guts + s.wisdom
}

export function roundStatBlock(s: StatBlock): StatBlock {
  return {
    speed: Math.round(s.speed),
    stamina: Math.round(s.stamina),
    power: Math.round(s.power),
    guts: Math.round(s.guts),
    wisdom: Math.round(s.wisdom),
  }
}

/** Sum blue-factor inheritance at career start (all six family members). */
export function sumBlueFactorInheritance(tree: LegacyTree): StatBlock {
  const norm = normalizeLegacyTreeStats(tree)
  const out = { ...EMPTY }
  for (const slot of [norm.legacy_1, norm.legacy_2]) {
    for (const member of [slot.parent, slot.grandparent_1, slot.grandparent_2]) {
      const factors = member.factors ?? []
      for (const f of factors) {
        if (f.type !== 'BlueStat') continue
        const pts = blueStarsToStartingPoints(f.stars)
        const rawIdx = Number(f.stat_index)
        if (!Number.isFinite(rawIdx)) continue
        const i = Math.min(4, Math.max(0, Math.round(rawIdx)))
        if (i === 0) out.speed += pts
        else if (i === 1) out.stamina += pts
        else if (i === 2) out.power += pts
        else if (i === 3) out.guts += pts
        else if (i === 4) out.wisdom += pts
      }
    }
  }
  return out
}

/**
 * Inheritance row: prefer live legacy math; if the last API compute has bonuses but the form sums to 0
 * (e.g. stale JSON types), show server values so the breakdown matches `/api/career/init`.
 */
export function inheritanceStatBlockForDisplay(
  legacy: LegacyTree,
  apiInheritance: StatBlock | undefined,
): StatBlock {
  const client = sumBlueFactorInheritance(legacy)
  if (!apiInheritance) return client
  const c = statBlockSum(client)
  const a = statBlockSum(apiInheritance)
  if (c < 0.5 && a > 0.5) return roundStatBlock(apiInheritance)
  return client
}

export function addStatBlocks(a: StatBlock, b: StatBlock): StatBlock {
  return {
    speed: a.speed + b.speed,
    stamina: a.stamina + b.stamina,
    power: a.power + b.power,
    guts: a.guts + b.guts,
    wisdom: a.wisdom + b.wisdom,
  }
}

export function subtractStatBlocks(a: StatBlock, b: StatBlock): StatBlock {
  return {
    speed: a.speed - b.speed,
    stamina: a.stamina - b.stamina,
    power: a.power - b.power,
    guts: a.guts - b.guts,
    wisdom: a.wisdom - b.wisdom,
  }
}

/**
 * Prefer live form + API breakdown; if both are empty but totals imply a bonus, use the residual
 * (`stats − base − support`) so the table matches `initialState.stats`.
 */
export function inheritanceForBreakdown(
  legacy: LegacyTree,
  apiInheritance: StatBlock | undefined,
  stats: StatBlock,
  base: StatBlock,
  support: StatBlock,
): StatBlock {
  const primary = inheritanceStatBlockForDisplay(legacy, apiInheritance)
  const residual = roundStatBlock(subtractStatBlocks(stats, addStatBlocks(base, support)))
  const p = statBlockSum(primary)
  const r = statBlockSum(residual)
  if (p < 0.5 && r > 0.5) return residual
  return primary
}

/** True if the user has configured anything on the legacy panes (send tree to API for sim). */
export function legacyTreeHasConfiguration(tree: LegacyTree): boolean {
  for (const slot of [tree.legacy_1, tree.legacy_2]) {
    for (const m of [slot.parent, slot.grandparent_1, slot.grandparent_2]) {
      if ((m.factors ?? []).length > 0) return true
      if (m.trainee_id != null) return true
      if (m.name.trim().length > 0) return true
    }
  }
  return false
}
