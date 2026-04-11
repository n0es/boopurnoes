/** Proxied path: dev (Vite) and production (Express) forward to https://uma.moe/api/v3 */

const SEARCH_PATH = '/api/uma-v3/search'

export interface UmaSupportCardSearchItem {
  account_id: string
  trainer_name: string
  follower_num?: number
  last_updated?: string
  support_card?: {
    support_card_id: number
    limit_break_count?: number
    experience?: number
  }
}

export interface UmaSupportCardSearchResponse {
  items: UmaSupportCardSearchItem[]
  total?: string | number
  page?: number
  limit?: number
  total_pages?: number
}

export async function fetchUmaSupportCardSearch(params: {
  supportCardId: number
  page: number
  limit?: number
}): Promise<UmaSupportCardSearchResponse> {
  const limit = params.limit ?? 50
  const q = new URLSearchParams({
    search_type: 'support_cards',
    page: String(params.page),
    limit: String(limit),
    support_card_id: String(params.supportCardId),
  })
  const res = await fetch(`${SEARCH_PATH}?${q.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `uma.moe search failed (${res.status})`)
  }
  return (await res.json()) as UmaSupportCardSearchResponse
}

/** Format 12-digit trainer id like the game / uma.moe copy UI. */
export function formatTrainerIdForDisplay(accountId: string): string {
  const d = accountId.replace(/\D/g, '')
  if (d.length !== 12) return accountId
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9, 12)}`
}

export function umaDatabaseFilteredUrl(supportCardId: number, minLb = 0): string {
  const json = JSON.stringify({ sc: String(supportCardId), lb: minLb })
  const b64 = btoa(json)
  return `https://uma.moe/database?filters=${encodeURIComponent(b64)}`
}
