/**
 * Seed the local dev database with support card data from supportCardSlugs.json.
 *
 * Usage:
 *   SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_KEY=<key> npm run db:seed
 *
 * Or set those vars in a .env.local file and run:
 *   npm run db:seed
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// Load .env.local if present (simple manual parse, no dotenv needed)
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
  // .env.local not found — rely on env vars already set
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  console.error('Set them in .env.local or pass as environment variables.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const __dirname = dirname(fileURLToPath(import.meta.url))
const cards: { id: number; slug: string; name: string; rarity: string }[] =
  JSON.parse(readFileSync(resolve(__dirname, '../src/data/supportCardSlugs.json'), 'utf-8'))
    .map((c: { id: number; slug: string; name: string; rarity: string }, idx: number) => ({ ...c, idx }))

const BATCH_SIZE = 100

console.log(`Seeding ${cards.length} support cards into ${supabaseUrl}…`)

let inserted = 0
let skipped = 0

for (let i = 0; i < cards.length; i += BATCH_SIZE) {
  const batch = cards.slice(i, i + BATCH_SIZE).map(({ id, slug, name, rarity, idx }: any) => ({
    idx,
    id,
    name,
    rarity,
    gametora_slug: slug,
    icon_path: `supports/icons/${id}.png`,
    art_path: `supports/art/${id}.png`,
    card_type: null,   // populated later via the importer
    name_jp: null,
  }))

  const { error } = await supabase
    .from('support_cards')
    .upsert(batch, { onConflict: 'id', ignoreDuplicates: true })

  if (error) {
    console.error(`Batch ${i}–${i + batch.length} failed:`, error.message)
    skipped += batch.length
  } else {
    inserted += batch.length
    process.stdout.write(`\r  ${inserted + skipped}/${cards.length}`)
  }
}

console.log(`\nDone. ${inserted} upserted, ${skipped} failed.`)
