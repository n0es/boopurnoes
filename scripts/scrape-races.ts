/**
 * Scrape race data from Gametora's static JSON API and upsert into the local `races` table.
 *
 * Uses the Gametora manifest to find the current races JSON hash, then imports
 * all 300+ races with complete metadata.
 *
 * Usage:
 *   npx tsx scripts/scrape-races.ts
 *
 * Sources:
 *   https://gametora.com/data/manifests/umamusume.json
 *   https://gametora.com/data/umamusume/races.{hash}.json
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Env ───────────────────────────────────────────────────────────────────────

try {
  const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
} catch { /* rely on existing env */ }

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ── Enum maps ─────────────────────────────────────────────────────────────────

const GRADE_MAP: Record<number, string> = {
  100: 'G1',
  200: 'G2',
  300: 'G3',
  400: 'OP',
  700: 'Pre-OP',
}

const TERRAIN_MAP: Record<number, string> = {
  1: 'Turf',
  2: 'Dirt',
}

const DIRECTION_MAP: Record<number, string> = {
  1: 'Clockwise',
  2: 'Counterclockwise',
  4: 'Straight',
}

const COURSE_MAP: Record<number, string> = {
  1: 'Inner',
  2: 'Outer',
  3: 'Outer (B)',
  4: 'Outer (C)',
}

const SEASON_MAP: Record<number, string | null> = {
  0: null,
  1: 'Spring',
  2: 'Summer',
  3: 'Autumn',
  4: 'Winter',
  5: 'Spring',
}

const TIME_MAP: Record<number, string> = {
  1: 'Morning',
  2: 'Daytime',
  3: 'Evening',
  4: 'Night',
}

const TRACK_MAP: Record<number, string> = {
  10001: 'Sapporo',
  10002: 'Hakodate',
  10003: 'Niigata',
  10004: 'Fukushima',
  10005: 'Nakayama',
  10006: 'Tokyo',
  10007: 'Chukyo',
  10008: 'Kyoto',
  10009: 'Hanshin',
  10010: 'Kokura',
  10101: 'Ooi',
  10103: 'Kawasaki',
  10104: 'Funabashi',
  10105: 'Morioka',
  10201: 'Longchamp',
  10202: 'Santa Anita Park',
  99999: 'Varies',
}

function distanceLabel(meters: number): string {
  if (meters <= 1400) return 'Short'
  if (meters <= 1800) return 'Mile'
  if (meters <= 2400) return 'Medium'
  return 'Long'
}

// ── Gametora race data shape ──────────────────────────────────────────────────

interface GtRace {
  id: number
  race_id: number
  banner_id: number
  name_en: string
  name_jp: string
  name_ko?: string
  name_tw?: string
  url_name: string
  grade: number
  track: number
  course: number
  course_id: number
  direction: number
  distance: number
  terrain: number
  season: number
  time: number
  entries: number
  group: number
  factor: { effect_1?: string; effect_2?: string }
  list_ura?: string[]
}

// ── Fetch from Gametora manifest ──────────────────────────────────────────────

console.log('Fetching Gametora manifest...')
const manifest = await fetch('https://gametora.com/data/manifests/umamusume.json').then(r => r.json()) as Record<string, string>
const racesHash = manifest['races']
if (!racesHash) {
  console.error('Could not find races hash in manifest')
  process.exit(1)
}
console.log(`  races hash: ${racesHash}`)

console.log('\nFetching races data...')
const gtRaces = await fetch(`https://gametora.com/data/umamusume/races.${racesHash}.json`).then(r => r.json()) as GtRace[]
console.log(`  ${gtRaces.length} races found`)

// ── Transform and upsert ──────────────────────────────────────────────────────

console.log('\nUpserting races...\n')

// Deduplicate: keep the lowest-ID entry per url_name (prefer standard races over scenario variants)
const deduped = new Map<string, GtRace>()
for (const r of gtRaces) {
  const existing = deduped.get(r.url_name)
  if (!existing || r.id < existing.id) deduped.set(r.url_name, r)
}
const uniqueRaces = [...deduped.values()]
console.log(`  Deduplicated: ${gtRaces.length} → ${uniqueRaces.length} races`)

// Clear existing races data first to avoid stale wiki-scraped entries
const { error: truncateError } = await supabase.from('races').delete().neq('id', 0)
if (truncateError) {
  console.error('Could not clear races table:', truncateError.message)
  process.exit(1)
}
console.log('  Cleared existing races.')

let success = 0, errors = 0
const BATCH = 50

for (let i = 0; i < uniqueRaces.length; i += BATCH) {
  const batch = uniqueRaces.slice(i, i + BATCH)
  const rows = batch.map(r => ({
    slug:           r.url_name,
    name_en:        r.name_en,
    name_jp:        r.name_jp || null,
    grade:          GRADE_MAP[r.grade] ?? String(r.grade),
    racetrack:      TRACK_MAP[r.track] ?? String(r.track),
    course:         COURSE_MAP[r.course] ?? null,
    direction:      DIRECTION_MAP[r.direction] ?? null,
    terrain:        TERRAIN_MAP[r.terrain] ?? null,
    distance:       r.distance,
    distance_label: distanceLabel(r.distance),
    season:         SEASON_MAP[r.season] ?? null,
    time_of_day:    TIME_MAP[r.time] ?? null,
    fans_required:  null,  // not provided by Gametora
    fans_acquired:  null,  // not provided by Gametora
  }))

  const { error } = await supabase.from('races').insert(rows)
  if (error) {
    errors += batch.length
    console.error(`\n  ✗ batch ${i}: ${error.message}`)
  } else {
    success += batch.length
  }
  process.stdout.write(`\r  ${success + errors}/${uniqueRaces.length}  ✓ ${success}  ✗ ${errors}  `)
}

console.log(`\n\n✓ Done: ${success} races imported, ${errors} errors`)
