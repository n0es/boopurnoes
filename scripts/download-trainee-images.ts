/**
 * Download trainee portrait and icon images from Gametora and upload to local Supabase storage.
 *
 * URL patterns:
 *   Portrait: https://gametora.com/images/umamusume/characters/chara_stand_{char_id}_{id}.png
 *   Icon:     https://gametora.com/images/umamusume/characters/icons/chr_icon_{char_id}.png
 *
 * Storage paths (in 'umamusume' bucket):
 *   trainees/art/{id}.png
 *   trainees/icons/{id}.png
 *
 * Usage:
 *   npx tsx scripts/download-trainee-images.ts              # all trainees, skip existing
 *   npx tsx scripts/download-trainee-images.ts 100701       # single trainee by id
 *   npx tsx scripts/download-trainee-images.ts -- --force   # re-download everything
 *
 * Requires in .env.local:
 *   SUPABASE_URL=http://localhost:54321
 *   SUPABASE_SERVICE_KEY=<your-local-service-role-key>
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

const force = process.argv.includes('--force')
const BUCKET = 'umamusume'
const CONCURRENCY = 3
const DELAY_MS = 200

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ── URL / path helpers ────────────────────────────────────────────────────────

// char_id is the first 4 digits of the 6-digit trainee id (e.g. 100701 → 1007)
function charId(id: number): number {
  return Math.floor(id / 100)
}

function portraitUrl(id: number): string {
  return `https://gametora.com/images/umamusume/characters/chara_stand_${charId(id)}_${id}.png`
}

function iconUrl(id: number): string {
  return `https://gametora.com/images/umamusume/characters/icons/chr_icon_${charId(id)}.png`
}

function portraitPath(id: number): string { return `trainees/art/${id}.png` }
function iconStoragePath(id: number): string { return `trainees/icons/${id}.png` }

// ── Storage helpers ───────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  const { data } = await supabase.storage.from(BUCKET).list(
    path.substring(0, path.lastIndexOf('/')),
    { search: path.substring(path.lastIndexOf('/') + 1) }
  )
  return (data?.length ?? 0) > 0
}

async function downloadAndUpload(
  sourceUrl: string,
  storagePath: string,
): Promise<'uploaded' | 'skipped' | 'error'> {
  if (!force && await fileExists(storagePath)) return 'skipped'

  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${sourceUrl}`)

  const buffer = await res.arrayBuffer()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: 'image/png', upsert: true })

  if (error) throw new Error(error.message)
  return 'uploaded'
}

// ── Concurrent runner ─────────────────────────────────────────────────────────

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0
  async function next(): Promise<void> {
    if (i >= items.length) return
    const item = items[i++]
    await fn(item)
    await new Promise(r => setTimeout(r, DELAY_MS))
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
}

// ── Process one trainee ───────────────────────────────────────────────────────

async function processTrainee(
  trainee: { id: number; name: string }
): Promise<{ portraits: number; icons: number; errors: number }> {
  let portraits = 0, icons = 0, errors = 0

  for (const [url, path, type] of [
    [portraitUrl(trainee.id), portraitPath(trainee.id), 'portrait'],
    [iconUrl(trainee.id),    iconStoragePath(trainee.id), 'icon'],
  ] as const) {
    try {
      const result = await downloadAndUpload(url, path)
      if (result === 'uploaded') type === 'portrait' ? portraits++ : icons++
    } catch (err: any) {
      errors++
      process.stderr.write(`  ✗ ${trainee.name} (${trainee.id}) ${type}: ${err.message}\n`)
    }
  }

  // Update DB paths (idempotent — sets them to the canonical values)
  const { error } = await supabase
    .from('trainees')
    .update({
      image_path: portraitPath(trainee.id),
      icon_path: iconStoragePath(trainee.id),
    })
    .eq('id', trainee.id)
  if (error) {
    errors++
    process.stderr.write(`  ✗ ${trainee.name} (${trainee.id}) DB update: ${error.message}\n`)
  }

  return { portraits, icons, errors }
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Optional positional arg: trainee id to process only one
const idArg = process.argv.find(a => /^\d{6}$/.test(a))

let query = supabase.from('trainees').select('id, name').not('gametora_slug', 'is', null).order('id')
if (idArg) query = query.eq('id', Number(idArg))

const { data: trainees, error: fetchErr } = await query
if (fetchErr) { console.error('Fetch trainees:', fetchErr.message); process.exit(1) }
if (!trainees || trainees.length === 0) { console.error('No trainees found'); process.exit(1) }

const scope = idArg ? `trainee ${idArg}` : `${trainees.length} trainees`
console.log(`Downloading images for ${scope}${force ? ' (force re-download)' : ' (skipping existing)'}…`)
console.log(`Concurrency: ${CONCURRENCY}, delay: ${DELAY_MS}ms\n`)

let totalPortraits = 0, totalIcons = 0, totalErrors = 0, done = 0

await runConcurrent(trainees, CONCURRENCY, async (trainee) => {
  const { portraits, icons, errors } = await processTrainee(trainee)
  totalPortraits += portraits
  totalIcons += icons
  totalErrors += errors
  done++
  process.stdout.write(`\r  ${done}/${trainees.length}  portraits: ${totalPortraits}  icons: ${totalIcons}  errors: ${totalErrors}  `)
})

console.log(`\n\nDone.`)
console.log(`  ${totalPortraits} portraits uploaded`)
console.log(`  ${totalIcons} icons uploaded`)
if (totalErrors > 0) console.log(`  ${totalErrors} errors (see above)`)
