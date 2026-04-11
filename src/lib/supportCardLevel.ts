/** Base level before uncap bonuses (SSR / SR / R). */
export const BASE_LEVEL: Record<string, number> = { SSR: 30, SR: 25, R: 20 }

/** Max card level for a given uncap tier (0–4) and rarity. */
export function maxLevelForUncap(uncap: number, rarity: string) {
  return (BASE_LEVEL[rarity] ?? 30) + uncap * 5
}

/**
 * How many limit-break diamonds to show (0–4) for a training level — the minimum uncap tier
 * needed so {@link maxLevelForUncap} for that tier is at least `trainLevel`.
 */
export function uncapDisplayForTrainLevel(trainLevel: number, rarity: string): number {
  const base = BASE_LEVEL[rarity] ?? 30
  const lv = Math.floor(trainLevel)
  if (lv <= base) return 0
  const need = lv - base
  return Math.min(4, Math.ceil(need / 5))
}
