/**
 * JP / global release columns (migration 037) on `support_cards` and `trainees`.
 * Dates are ISO `YYYY-MM-DD` strings from Postgres `date` columns.
 */
export interface ReleaseMetadata {
  released_jp: string | null
  released_global: string | null
  release_global_is_approximate: boolean
  release_source: string | null
}

export function hasReleaseInfo(m: Partial<ReleaseMetadata>): boolean {
  return !!(m.released_jp || m.released_global)
}

/** Short lines for modals and tooltips. */
export function releaseSummaryLines(m: Partial<ReleaseMetadata>): string[] {
  const lines: string[] = []
  if (m.released_jp) lines.push(`JP: ${m.released_jp}`)
  if (m.released_global) {
    const approx = m.release_global_is_approximate ? ' (approx.)' : ''
    lines.push(`Global: ${m.released_global}${approx}`)
  }
  return lines
}

/** Local calendar date as `YYYY-MM-DD` (for comparing to Postgres `date` strings). */
export function todayIsoDateLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Japan = full catalog (no date filter). Global = items whose global release is on or before today. */
export type RegionAvailabilityFilter = 'jp' | 'global'

/** Whether an item is treated as released and playable on JP (has a JP date on or before today). */
export function isAvailableOnJapan(releasedJp: string | null | undefined, todayIso: string): boolean {
  return !!releasedJp && releasedJp <= todayIso
}

/** Whether an item is treated as released on Global (has a global date on or before today). */
export function isAvailableOnGlobal(releasedGlobal: string | null | undefined, todayIso: string): boolean {
  return !!releasedGlobal && releasedGlobal <= todayIso
}

/** Filter trainees/cards: Japan shows everything; Global only items released on global by today. */
export function passesRegionAvailabilityFilter(
  mode: RegionAvailabilityFilter,
  _releasedJp: string | null | undefined,
  releasedGlobal: string | null | undefined,
  todayIso: string,
): boolean {
  if (mode === 'jp') return true
  return isAvailableOnGlobal(releasedGlobal, todayIso)
}

export function parseRegionParam(value: string | null): RegionAvailabilityFilter {
  if (value === 'global') return 'global'
  return 'jp'
}
