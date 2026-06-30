/**
 * Download skill icons from Gametora and upload to local Supabase storage.
 *
 * Reads existing `icon_url` values from the `skills` table (which are full
 * Gametora CDN URLs), downloads them, uploads to the 'umamusume' bucket, and
 * updates `icon_url` to the storage path.
 *
 * Storage path: skills/{iconid}.png
 *   where iconid is the number in the Gametora filename, e.g. "20021"
 *
 * Usage:
 *   npx tsx scripts/download-skill-icons.ts                       # all skills
 *   npx tsx scripts/download-skill-icons.ts --trainee 100701      # only skills for a trainee
 *   npx tsx scripts/download-skill-icons.ts -- --force            # re-download everything
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
const DELAY_MS = 100

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ── Arg parsing ───────────────────────────────────────────────────────────────

const traineeArgIdx = process.argv.indexOf('--trainee')
const traineeFilter: number | null = traineeArgIdx !== -1
  ? Number(process.argv[traineeArgIdx + 1])
  : null

// ── URL / path helpers ────────────────────────────────────────────────────────

// Extract the numeric icon id from a Gametora skill icon URL.
// e.g. "https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_20021.png" → "20021"
function extractIconId(url: string): string | null {
  const m = url.match(/utx_ico_skill_(\w+)\.png$/)
  return m ? m[1] : null
}

function storagePathForIconId(iconId: string): string {
  return `skills/${iconId}.png`
}

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
): Promise<'uploaded' | 'skipped'> {
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

// ── Fetch skills ──────────────────────────────────────────────────────────────

async function fetchSkills(): Promise<{ id: number; gametora_id: number; icon_url: string | null }[]> {
  if (traineeFilter !== null) {
    // Collect skill IDs associated with this trainee across all junction tables
    const [awk, unq, hint] = await Promise.all([
      supabase.schema('uma').from('trainee_awakening_skills').select('skill_id').eq('trainee_id', traineeFilter),
      supabase.schema('uma').from('trainee_unique_skills').select('skill_id').eq('trainee_id', traineeFilter),
      supabase.schema('uma').from('trainee_hint_skills').select('skill_id').eq('trainee_id', traineeFilter),
    ])

    const skillIds = [
      ...(awk.data ?? []),
      ...(unq.data ?? []),
      ...(hint.data ?? []),
    ].map(r => r.skill_id)

    if (skillIds.length === 0) {
      console.log(`No skills found for trainee ${traineeFilter}`)
      return []
    }

    const { data, error } = await supabase
      .schema('uma').from('skills')
      .select('id, gametora_id, icon_url')
      .in('id', [...new Set(skillIds)])
    if (error) throw new Error(`Fetch skills for trainee: ${error.message}`)
    return data ?? []
  }

  // All skills with a Gametora icon URL
  const { data, error } = await supabase
    .schema('uma').from('skills')
    .select('id, gametora_id, icon_url')
    .not('icon_url', 'is', null)
  if (error) throw new Error(`Fetch all skills: ${error.message}`)
  return (data ?? []).filter(s => s.icon_url)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const allSkills = await fetchSkills()
const scope = traineeFilter ? `skills for trainee ${traineeFilter}` : `${allSkills.length} skills`
console.log(`Processing ${scope}${force ? ' (force re-download)' : ' (skipping existing)'}…\n`)

// Group skills by icon id — multiple skills share the same icon image.
// We download each unique icon once, then update all skills sharing it.
const byIconId = new Map<string, typeof allSkills>()
const noIcon: typeof allSkills = []

for (const skill of allSkills) {
  if (!skill.icon_url) { noIcon.push(skill); continue }

  // Skills already migrated to storage paths don't need re-downloading
  // (storage paths look like "skills/..." not "https://...")
  if (!skill.icon_url.startsWith('https://') && !force) {
    continue
  }

  const iconId = skill.icon_url.startsWith('https://')
    ? extractIconId(skill.icon_url)
    : skill.icon_url.replace('skills/', '').replace('.png', '')

  if (!iconId) { noIcon.push(skill); continue }

  const group = byIconId.get(iconId) ?? []
  group.push(skill)
  byIconId.set(iconId, group)
}

if (noIcon.length > 0) {
  console.log(`  ${noIcon.length} skills skipped (no icon URL or unrecognized format)`)
}

let uploaded = 0, skipped = 0, errors = 0, done = 0
const total = byIconId.size

for (const [iconId, skills] of byIconId) {
  const storagePath = storagePathForIconId(iconId)
  const sourceUrl = `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${iconId}.png`

  try {
    const result = await downloadAndUpload(sourceUrl, storagePath)
    if (result === 'uploaded') uploaded++
    else skipped++

    // Update all skills sharing this icon to point to the storage path
    const idsToUpdate = skills.map(s => s.id)
    const { error: dbErr } = await supabase
      .schema('uma').from('skills')
      .update({ icon_url: storagePath })
      .in('id', idsToUpdate)
    if (dbErr) throw new Error(`DB update: ${dbErr.message}`)
  } catch (err: any) {
    errors++
    process.stderr.write(`  ✗ icon ${iconId} (${skills.map(s => s.gametora_id).join(', ')}): ${err.message}\n`)
  }

  done++
  process.stdout.write(`\r  ${done}/${total} icons  uploaded: ${uploaded}  skipped: ${skipped}  errors: ${errors}  `)
  if (done < total) await new Promise(r => setTimeout(r, DELAY_MS))
}

console.log(`\n\nDone.`)
console.log(`  ${uploaded} icons uploaded`)
console.log(`  ${skipped} already existed`)
if (errors > 0) console.log(`  ${errors} errors (see above)`)
