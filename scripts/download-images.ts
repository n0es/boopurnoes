/**
 * Download support card images from Gametora and upload to local Supabase storage.
 *
 * Usage:
 *   npm run db:images              # skip already-uploaded images
 *   npm run db:images -- --force   # re-download everything
 *
 * Requires in .env.local:
 *   SUPABASE_URL=http://localhost:54321
 *   SUPABASE_SERVICE_KEY=<your-local-service-role-key>
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
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
const CONCURRENCY = 5
const DELAY_MS = 200  // be polite to Gametora

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const cards: { id: number }[] = JSON.parse(
  readFileSync(resolve(__dirname, '../src/data/supportCardSlugs.json'), 'utf-8')
)

const CARD_TYPE_ICONS: { index: string; type: string }[] = [
  { index: '00', type: 'speed' },
  { index: '01', type: 'stamina' },
  { index: '02', type: 'power' },
  { index: '03', type: 'guts' },
  { index: '04', type: 'intelligence' },
  { index: '05', type: 'friend' },
  { index: '06', type: 'group' },
]

function iconUrl(id: number) {
  return `https://gametora.com/images/umamusume/supports/support_card_s_${id}.png`
}
function artUrl(id: number) {
  return `https://gametora.com/images/umamusume/supports/tex_support_card_${id}.png`
}
function iconPath(id: number) { return `supports/icons/${id}.png` }
function artPath(id: number)  { return `supports/art/${id}.png` }

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
  label: string
): Promise<'uploaded' | 'skipped' | 'error'> {
  if (!force && await fileExists(storagePath)) return 'skipped'

  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${sourceUrl}`)

  const buffer = await res.arrayBuffer()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'image/png',
      upsert: true,
    })

  if (error) throw new Error(error.message)
  return 'uploaded'
}

async function processCard(id: number): Promise<{ icons: number; art: number; errors: number }> {
  let icons = 0, art = 0, errors = 0

  for (const [url, path, type] of [
    [iconUrl(id), iconPath(id), 'icon'],
    [artUrl(id),  artPath(id),  'art'],
  ] as const) {
    try {
      const result = await downloadAndUpload(url, path, type)
      if (result === 'uploaded') type === 'icon' ? icons++ : art++
    } catch (err: any) {
      errors++
      process.stderr.write(`  ✗ #${id} ${type}: ${err.message}\n`)
    }
  }

  return { icons, art, errors }
}

// Run N tasks at a time
async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let i = 0
  async function next(): Promise<void> {
    if (i >= items.length) return
    const index = i++
    await fn(items[index], index)
    await new Promise(r => setTimeout(r, DELAY_MS))
    return next()
  }
  await Promise.all(Array.from({ length: concurrency }, next))
}

// --- Card type icons (7 total, download sequentially) ---
console.log('Downloading card type icons…')
for (const { index, type } of CARD_TYPE_ICONS) {
  const src = `https://gametora.com/images/umamusume/icons/utx_ico_obtain_${index}.png`
  const dest = `icons/${type}.png`
  try {
    const result = await downloadAndUpload(src, dest, type)
    console.log(`  ${result === 'skipped' ? '~' : '✓'} ${type}`)
  } catch (err: any) {
    console.error(`  ✗ ${type}: ${err.message}`)
  }
}
console.log()

console.log(`Downloading images for ${cards.length} cards${force ? ' (force re-download)' : ' (skipping existing)'}…`)
console.log(`Concurrency: ${CONCURRENCY}, delay: ${DELAY_MS}ms\n`)

let totalIcons = 0, totalArt = 0, totalErrors = 0, done = 0

await runConcurrent(cards, CONCURRENCY, async ({ id }) => {
  const { icons, art, errors } = await processCard(id)
  totalIcons += icons
  totalArt += art
  totalErrors += errors
  done++
  process.stdout.write(`\r  ${done}/${cards.length}  icons: ${totalIcons}  art: ${totalArt}  errors: ${totalErrors}  `)
})

console.log(`\n\nDone.`)
console.log(`  ${totalIcons} icons uploaded`)
console.log(`  ${totalArt} art uploaded`)
if (totalErrors > 0) console.log(`  ${totalErrors} errors (see above)`)
