/**
 * Apply JP/global release metadata from src/data/releaseDates.json to Supabase.
 *
 * Populate the JSON first (full dataset):
 *   npm run db:build-release-dates
 *
 * Then:
 *   SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_KEY=<key> npm run db:import-release-dates
 *
 * Or set those vars in .env.local (same pattern as scripts/seed.ts).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

try {
  const envPath = resolve(process.cwd(), '.env.local')
  const contents = readFileSync(envPath, 'utf-8')
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
} catch {
  // .env.local not found
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ReleaseRow {
  released_jp?: string | null
  released_global?: string | null
  release_global_is_approximate?: boolean
  release_source?: string | null
}

interface ReleaseDatesFile {
  meta?: { description?: string; defaultSource?: string }
  supportCards: Record<string, ReleaseRow>
  trainees: Record<string, ReleaseRow>
}

function normalizeRow(r: ReleaseRow) {
  return {
    released_jp: r.released_jp ?? null,
    released_global: r.released_global ?? null,
    release_global_is_approximate: r.release_global_is_approximate ?? false,
    release_source: r.release_source ?? null,
  }
}

const data: ReleaseDatesFile = JSON.parse(
  readFileSync(resolve(__dirname, '../src/data/releaseDates.json'), 'utf-8'),
)

const BATCH = 32

async function runBatch<T>(
  items: T[],
  fn: (item: T) => Promise<{ ok: boolean }>,
): Promise<{ ok: number; err: number }> {
  let ok = 0
  let err = 0
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH)
    const results = await Promise.all(chunk.map(fn))
    for (const r of results) {
      if (r.ok) ok++
      else err++
    }
  }
  return { ok, err }
}

async function main() {
  const cardEntries = Object.entries(data.supportCards).filter(([idStr]) => !Number.isNaN(Number(idStr)))
  const trEntries = Object.entries(data.trainees).filter(([idStr]) => !Number.isNaN(Number(idStr)))

  const cardRes = await runBatch(cardEntries, async ([idStr, row]) => {
    const id = Number(idStr)
    const { error } = await supabase.from('support_cards').update(normalizeRow(row)).eq('id', id)
    if (error) {
      console.error(`support_cards ${id}:`, error.message)
      return { ok: false }
    }
    return { ok: true }
  })

  const trRes = await runBatch(trEntries, async ([idStr, row]) => {
    const id = Number(idStr)
    const { error } = await supabase.from('trainees').update(normalizeRow(row)).eq('id', id)
    if (error) {
      console.error(`trainees ${id}:`, error.message)
      return { ok: false }
    }
    return { ok: true }
  })

  console.log(
    `Done. support_cards: ${cardRes.ok} updated, ${cardRes.err} errors; trainees: ${trRes.ok} updated, ${trRes.err} errors.`,
  )
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
