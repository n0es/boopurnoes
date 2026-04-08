/** Shared Speed–Wisdom colors and labels for Umamusume training UI. */

export const UMA_STAT_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom'] as const
export const UMA_STAT_COLORS = ['#60a5fa', '#fb923c', '#f87171', '#fbbf24', '#34d399'] as const

export function formatSignedStatDelta(n: number): string {
  const r = Math.round(n)
  if (r > 0) return `+${r}`
  return String(r)
}
