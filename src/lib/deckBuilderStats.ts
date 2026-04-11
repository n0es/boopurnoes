import { maxLevelForUncap } from './supportCardLevel'

export interface SupportCardEffectRow {
  card_id?: number
  effect_type_id: number | null
  effect_name: string | null
  unlock_level: number
  values_by_level: number[] | null
}

/** Same indexing as SupportCards card modal: value at training level `level`. */
export function valueAtUnlockLevel(
  e: Pick<SupportCardEffectRow, 'unlock_level' | 'values_by_level'>,
  level: number,
): number | null {
  if (!e.values_by_level?.length || e.unlock_level > level) return null
  const idx = Math.min(level, e.values_by_level.length - 1)
  return e.values_by_level[idx]
}

/** Sum of effect values at `level`, keyed by effect_type_id (null ids skipped). */
export function statVectorAtLevel(effects: SupportCardEffectRow[], level: number): Record<number, number> {
  const out: Record<number, number> = {}
  for (const e of effects) {
    if (e.effect_type_id == null) continue
    const v = valueAtUnlockLevel(e, level)
    if (v == null) continue
    const id = e.effect_type_id
    out[id] = (out[id] ?? 0) + v
  }
  return out
}

export function addStatVectors(...vecs: Record<number, number>[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const m of vecs) {
    for (const [k, v] of Object.entries(m)) {
      const id = Number(k)
      out[id] = (out[id] ?? 0) + v
    }
  }
  return out
}

/** Stats at full level for the user’s unlock tier (collection uncap). */
export function vectorForOwnedCard(
  effects: SupportCardEffectRow[],
  uncap: number,
  rarity: string,
): Record<number, number> {
  const lv = maxLevelForUncap(uncap, rarity)
  return statVectorAtLevel(effects, lv)
}

const MAX_WILDCARD_UNCAP = 4

/** Wildcard assumes max uncap (4) — best possible stats for that card in a deck. */
export function vectorForWildcardCard(effects: SupportCardEffectRow[], rarity: string): Record<number, number> {
  const lv = maxLevelForUncap(MAX_WILDCARD_UNCAP, rarity)
  return statVectorAtLevel(effects, lv)
}

export function clampOwnedTrainLevel(trainLevel: number, uncap: number, rarity: string): number {
  const maxLv = maxLevelForUncap(uncap, rarity)
  return Math.max(1, Math.min(Math.floor(trainLevel), maxLv))
}

/** Friend slot is always uncap 4 in this builder. */
export function clampFriendTrainLevel(trainLevel: number, rarity: string): number {
  const maxLv = maxLevelForUncap(MAX_WILDCARD_UNCAP, rarity)
  return Math.max(1, Math.min(Math.floor(trainLevel), maxLv))
}
