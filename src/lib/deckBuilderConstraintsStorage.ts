import { SUPPORT_CARD_EFFECT_META } from './supportCardEffectMeta'

const STORAGE_KEY = 'boopurnoes:deckBuilderConstraints:v1'

export type DeckConstraintRow = { enabled: boolean; minStr: string }

export function defaultDeckConstraintState(): Record<number, DeckConstraintRow> {
  const o: Record<number, DeckConstraintRow> = {}
  for (const k of Object.keys(SUPPORT_CARD_EFFECT_META)) {
    const id = Number(k)
    o[id] = { enabled: false, minStr: '0' }
  }
  return o
}

function parseStored(raw: string | null): Record<number, DeckConstraintRow> | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object') return null
    return mergeLoaded(data as Record<string, { enabled?: boolean; minStr?: string }>)
  } catch {
    return null
  }
}

export function mergeLoaded(
  rows: Record<string, { enabled?: boolean; minStr?: string }>,
): Record<number, DeckConstraintRow> {
  const base = defaultDeckConstraintState()
  for (const k of Object.keys(SUPPORT_CARD_EFFECT_META)) {
    const id = Number(k)
    const r = rows[String(id)]
    if (r && typeof r === 'object') {
      base[id] = {
        enabled: Boolean(r.enabled),
        minStr: typeof r.minStr === 'string' ? r.minStr : '0',
      }
    }
  }
  return base
}

export function loadDeckBuilderConstraints(): Record<number, DeckConstraintRow> {
  if (typeof localStorage === 'undefined') return defaultDeckConstraintState()
  return parseStored(localStorage.getItem(STORAGE_KEY)) ?? defaultDeckConstraintState()
}

export function saveDeckBuilderConstraints(state: Record<number, DeckConstraintRow>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore quota */
  }
}
