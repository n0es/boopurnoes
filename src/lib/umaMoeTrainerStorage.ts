const BLOCK_KEY = 'boopurnoes:umaTrainerBlocklist:v1'
const CACHE_KEY = 'boopurnoes:umaTrainerCache:v1'

export type UmaTrainerBlocklist = Record<string, string[]>

export interface CachedTrainerRow {
  accountId: string
  trainerName: string
  fetchedAt: number
}

export type UmaTrainerCache = Record<string, CachedTrainerRow>

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadBlocklist(): UmaTrainerBlocklist {
  if (typeof localStorage === 'undefined') return {}
  return safeParse<UmaTrainerBlocklist>(localStorage.getItem(BLOCK_KEY), {})
}

export function saveBlocklist(data: UmaTrainerBlocklist): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(BLOCK_KEY, JSON.stringify(data))
}

export function blockTrainerForCard(cardId: number, accountId: string): void {
  const key = String(cardId)
  const bl = loadBlocklist()
  const set = new Set(bl[key] ?? [])
  set.add(accountId)
  bl[key] = [...set]
  saveBlocklist(bl)
}

export function isBlockedForCard(cardId: number, accountId: string): boolean {
  const list = loadBlocklist()[String(cardId)]
  return list?.includes(accountId) ?? false
}

export function loadTrainerCache(): UmaTrainerCache {
  if (typeof localStorage === 'undefined') return {}
  return safeParse<UmaTrainerCache>(localStorage.getItem(CACHE_KEY), {})
}

export function saveTrainerCache(data: UmaTrainerCache): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(CACHE_KEY, JSON.stringify(data))
}

export function setCachedTrainer(cardId: number, row: { accountId: string; trainerName: string }): void {
  const c = loadTrainerCache()
  c[String(cardId)] = { ...row, fetchedAt: Date.now() }
  saveTrainerCache(c)
}

export function clearCachedTrainer(cardId: number): void {
  const c = loadTrainerCache()
  delete c[String(cardId)]
  saveTrainerCache(c)
}

export function getCachedTrainer(cardId: number): CachedTrainerRow | undefined {
  return loadTrainerCache()[String(cardId)]
}
