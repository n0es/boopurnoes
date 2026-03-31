/**
 * Sync public data and storage assets from production to local dev.
 *
 * What it does:
 *   1. Runs all SQL migrations against the local DB (schema)
 *   2. Creates the local storage bucket if missing
 *   3. Pulls support_cards + support_card_effects from prod and upserts locally
 *   4. Downloads images from the prod public bucket and uploads to local
 *
 * Skipped intentionally:
 *   - profiles  (tied to auth.users UUIDs that don't exist locally)
 *   - user_collection  (still in development)
 *
 * Usage:
 *   npm run db:sync              # skip already-uploaded images
 *   npm run db:sync -- --force   # re-upload all images
 *
 * Requires in .env.local:
 *   # Local
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
 *   SUPABASE_URL=http://localhost:54321
 *   SUPABASE_SERVICE_KEY=<local-service-role-key>
 *
 *   # Production (service key needed to bypass RLS on prod tables)
 *   PROD_SUPABASE_URL=https://<project-ref>.supabase.co
 *   PROD_SUPABASE_SERVICE_KEY=<prod-service-role-key>
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
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

const databaseUrl       = process.env.DATABASE_URL
const supabaseUrl       = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
const prodUrl            = process.env.PROD_SUPABASE_URL
const prodServiceKey     = process.env.PROD_SUPABASE_SERVICE_KEY

const missing = (
  [['DATABASE_URL', databaseUrl], ['SUPABASE_URL', supabaseUrl],
   ['SUPABASE_SERVICE_KEY', supabaseServiceKey],
   ['PROD_SUPABASE_URL', prodUrl], ['PROD_SUPABASE_SERVICE_KEY', prodServiceKey]] as const
).filter(([, v]) => !v).map(([k]) => k)

if (missing.length) {
  console.error('Missing required env vars:', missing.join(', '))
  process.exit(1)
}

const force = process.argv.includes('--force')
const BUCKET = 'umamusume'
const CONCURRENCY = 5
const DELAY_MS = 50

const local = createClient(supabaseUrl!, supabaseServiceKey!)
const prod  = createClient(prodUrl!, prodServiceKey!)

// ---------------------------------------------------------------------------
// Step 1: Run migrations
// ---------------------------------------------------------------------------
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  let dollarTag: string | null = null
  let inLineComment = false

  while (i < sql.length) {
    // Track -- line comments so semicolons inside them don't split statements
    if (!dollarTag && !inLineComment && sql[i] === '-' && sql[i + 1] === '-') {
      inLineComment = true
      current += sql[i++]
      continue
    }
    if (inLineComment) {
      if (sql[i] === '\n') inLineComment = false
      current += sql[i++]
      continue
    }

    if (dollarTag === null) {
      if (sql[i] === '$') {
        const end = sql.indexOf('$', i + 1)
        if (end !== -1) {
          dollarTag = sql.slice(i, end + 1)
          current += dollarTag
          i = end + 1
          continue
        }
      }
      if (sql[i] === ';') {
        const stmt = current.trim()
        if (stmt) statements.push(stmt)
        current = ''
        i++
        continue
      }
    } else {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag
        i += dollarTag.length
        dollarTag = null
        continue
      }
    }
    current += sql[i++]
  }
  const last = current.trim()
  if (last) statements.push(last)
  return statements
}

console.log('--- Migrations ---')
const migrationsDir = resolve(__dirname, '../supabase/migrations')
const migrationFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
const dbClient = new pg.Client({ connectionString: databaseUrl })
await dbClient.connect()

for (const file of migrationFiles) {
  const sql = readFileSync(resolve(migrationsDir, file), 'utf-8')
  for (const stmt of splitStatements(sql)) {
    try {
      await dbClient.query(stmt)
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '42710') { /* already exists, skip */ }
      else {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`  ✗ ${file}: ${message}`)
        await dbClient.end()
        process.exit(1)
      }
    }
  }
  console.log(`  ✓ ${file}`)
}
await dbClient.end()

// ---------------------------------------------------------------------------
// Step 2: Ensure local storage bucket exists
// ---------------------------------------------------------------------------
console.log('\n--- Storage bucket ---')
const { data: existingBucket } = await local.storage.getBucket(BUCKET)
if (existingBucket) {
  console.log(`  ✓ '${BUCKET}' already exists`)
} else {
  const { error } = await local.storage.createBucket(BUCKET, { public: true })
  if (error) { console.error(`  ✗ ${error.message}`); process.exit(1) }
  console.log(`  ✓ '${BUCKET}' created`)
}

// ---------------------------------------------------------------------------
// Step 3: Sync support_cards
// ---------------------------------------------------------------------------
console.log('\n--- support_cards ---')

async function fetchAll<T>(
  table: string,
  client: ReturnType<typeof createClient>
): Promise<T[]> {
  const PAGE = 1000
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    rows.push(...data as T[])
    if (data.length < PAGE) break
    from += PAGE
  }
  return rows
}

const cards = await fetchAll<Record<string, unknown>>('support_cards', prod)
console.log(`  fetched ${cards.length} rows from prod`)

const BATCH = 200
for (let i = 0; i < cards.length; i += BATCH) {
  const { error } = await local
    .from('support_cards')
    .upsert(cards.slice(i, i + BATCH), { onConflict: 'id' })
  if (error) { console.error(`  ✗ upsert batch ${i}: ${error.message}`); process.exit(1) }
}
console.log(`  ✓ upserted ${cards.length} rows locally`)

// ---------------------------------------------------------------------------
// Step 4: Sync support_card_effects
// ---------------------------------------------------------------------------
// support_card_effects.id is GENERATED ALWAYS AS IDENTITY with no natural
// unique key, so we use the pg client directly: truncate then re-insert
// without the id column (Postgres assigns new ids automatically).
console.log('\n--- support_card_effects ---')
const effects = await fetchAll<Record<string, unknown>>('support_card_effects', prod)
console.log(`  fetched ${effects.length} rows from prod`)

const pgEffects = new pg.Client({ connectionString: databaseUrl })
await pgEffects.connect()
await pgEffects.query('TRUNCATE public.support_card_effects RESTART IDENTITY CASCADE')

const cols = effects.length
  ? Object.keys(effects[0]).filter(k => k !== 'id')
  : []

for (let i = 0; i < effects.length; i += BATCH) {
  const batch = effects.slice(i, i + BATCH)
  const values: unknown[] = []
  const placeholders = batch.map((row, ri) =>
    '(' + cols.map((col, ci) => {
      values.push(row[col])
      return `$${ri * cols.length + ci + 1}`
    }).join(', ') + ')'
  )
  await pgEffects.query(
    `INSERT INTO public.support_card_effects (${cols.join(', ')}) VALUES ${placeholders.join(', ')}`,
    values
  )
}
await pgEffects.end()
console.log(`  ✓ inserted ${effects.length} rows locally`)

// ---------------------------------------------------------------------------
// Step 5: Sync storage images from prod public bucket
// ---------------------------------------------------------------------------
console.log('\n--- Storage images ---')

const CARD_TYPE_ICONS = ['speed', 'stamina', 'power', 'guts', 'intelligence', 'friend', 'group']

// Build list of all paths to sync
const storagePaths: string[] = [
  ...CARD_TYPE_ICONS.map(t => `icons/${t}.png`),
  ...cards.flatMap(c => [
    `supports/icons/${c.id}.png`,
    `supports/art/${c.id}.png`,
  ]),
]

async function localFileExists(path: string): Promise<boolean> {
  const dir = path.substring(0, path.lastIndexOf('/'))
  const name = path.substring(path.lastIndexOf('/') + 1)
  const { data } = await local.storage.from(BUCKET).list(dir, { search: name })
  return (data?.length ?? 0) > 0
}

async function syncFile(storagePath: string): Promise<'uploaded' | 'skipped' | 'error'> {
  if (!force && await localFileExists(storagePath)) return 'skipped'

  const publicUrl = `${prodUrl}/storage/v1/object/public/${BUCKET}/${storagePath}`
  const res = await fetch(publicUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const buffer = await res.arrayBuffer()
  const { error } = await local.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: 'image/png', upsert: true })
  if (error) throw new Error(error.message)
  return 'uploaded'
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0
  async function next(): Promise<void> {
    if (i >= items.length) return
    const idx = i++
    await fn(items[idx])
    await new Promise(r => setTimeout(r, DELAY_MS))
    return next()
  }
  await Promise.all(Array.from({ length: concurrency }, next))
}

let uploaded = 0, skipped = 0, errors = 0

await runConcurrent(storagePaths, CONCURRENCY, async (path) => {
  try {
    const result = await syncFile(path)
    if (result === 'uploaded') uploaded++
    else skipped++
  } catch (err: unknown) {
    errors++
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`  ✗ ${path}: ${message}\n`)
  }
  process.stdout.write(`\r  ${uploaded + skipped + errors}/${storagePaths.length}  uploaded: ${uploaded}  skipped: ${skipped}  errors: ${errors}  `)
})

console.log(`\n\n  ✓ ${uploaded} uploaded, ${skipped} skipped${errors ? `, ${errors} errors` : ''}`)
console.log('\nSync complete.')
