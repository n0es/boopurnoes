/**
 * Regenerate src/data/releaseDates.json from GameTora manifest JSON
 * (support-cards and character-cards), which include regional release dates.
 *
 * Usage: npm run db:build-release-dates
 *
 * No Supabase credentials required. Run db:import-release-dates afterward to apply to the DB.
 */

import { writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../src/data/releaseDates.json')

const MANIFEST_URL = 'https://gametora.com/data/manifests/umamusume.json'
const GAMETORA_BASE = 'https://gametora.com/data/umamusume'

interface ManifestMap {
  'support-cards': string
  'character-cards': string
}

interface SupportCardRow {
  support_id: number
  release?: string
  release_en?: string
}

interface CharacterCardRow {
  card_id: number
  release?: string
  release_en?: string
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return res.json() as Promise<unknown>
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T
  for (const k of Object.keys(obj).sort((a, b) => Number(a) - Number(b))) {
    out[k as keyof T] = obj[k as keyof T]
  }
  return out
}

async function main() {
  const manifest = (await fetchJson(MANIFEST_URL)) as ManifestMap
  const supHash = manifest['support-cards']
  const charHash = manifest['character-cards']
  if (!supHash || !charHash) throw new Error('manifest missing support-cards or character-cards')

  const supUrl = `${GAMETORA_BASE}/support-cards.${supHash}.json`
  const charUrl = `${GAMETORA_BASE}/character-cards.${charHash}.json`

  const supportRows = (await fetchJson(supUrl)) as SupportCardRow[]
  const charRows = (await fetchJson(charUrl)) as CharacterCardRow[]

  const supportCards: Record<string, Record<string, unknown>> = {}
  for (const s of supportRows) {
    supportCards[String(s.support_id)] = {
      released_jp: s.release ?? null,
      released_global: s.release_en ?? null,
      release_global_is_approximate: false,
      release_source: supUrl,
    }
  }

  const trainees: Record<string, Record<string, unknown>> = {}
  for (const c of charRows) {
    trainees[String(c.card_id)] = {
      released_jp: c.release ?? null,
      released_global: c.release_en ?? null,
      release_global_is_approximate: false,
      release_source: charUrl,
    }
  }

  const doc = {
    meta: {
      description:
        'JP and global release dates from GameTora umamusume JSON (support-cards / character-cards). Regenerate with npm run db:build-release-dates.',
      defaultSource: 'https://gametora.com/data/manifests/umamusume.json',
      builtFrom: { supportCardsUrl: supUrl, characterCardsUrl: charUrl },
    },
    supportCards: sortKeys(supportCards),
    trainees: sortKeys(trainees),
  }

  writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
  console.log(
    `Wrote ${OUT}\n  support cards: ${supportRows.length} (manifest hash ${supHash})\n  trainees (character cards): ${charRows.length} (manifest hash ${charHash})`,
  )
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
