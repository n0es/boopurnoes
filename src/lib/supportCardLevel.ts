/** Base level before uncap bonuses (SSR / SR / R). */
export const BASE_LEVEL: Record<string, number> = { SSR: 30, SR: 25, R: 20 }

/** Max card level for a given uncap tier (0–4) and rarity. */
export function maxLevelForUncap(uncap: number, rarity: string) {
  return (BASE_LEVEL[rarity] ?? 30) + uncap * 5
}
