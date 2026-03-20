/**
 * Create all tables and storage buckets in the local dev database.
 * Runs all SQL migrations in order, then creates the storage bucket.
 *
 * Usage:
 *   npm run db:setup
 *
 * Requires in .env.local:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
 *   SUPABASE_URL=http://localhost:54321
 *   SUPABASE_SERVICE_KEY=<your-local-service-role-key>
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
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

const databaseUrl = process.env.DATABASE_URL
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!databaseUrl || !supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required env vars: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY')
  process.exit(1)
}

// --- Run migrations ---
/** Split SQL into individual statements, correctly handling $$-quoted bodies. */
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  let dollarTag: string | null = null

  while (i < sql.length) {
    if (dollarTag === null) {
      // Check for start of a dollar-quoted string
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
      // Inside dollar-quoted string — look for matching closing tag
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

const migrationsDir = resolve(__dirname, '../supabase/migrations')
const migrationFiles = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()

console.log(`Running ${migrationFiles.length} migration(s)…`)
for (const file of migrationFiles) {
  const sql = readFileSync(resolve(migrationsDir, file), 'utf-8')
  // Split into individual statements, respecting dollar-quoted strings ($$...$$)
  const statements = splitStatements(sql)

  let fileOk = true
  for (const statement of statements) {
    try {
      await client.query(statement)
    } catch (err: any) {
      // 42710 = duplicate_object (already exists) — safe to skip
      if (err.code === '42710') {
        // silently skip
      } else {
        console.error(`  ✗ ${file}: ${err.message}`)
        console.error(`    ${statement.slice(0, 80)}…`)
        await client.end()
        process.exit(1)
      }
    }
  }
  if (fileOk) console.log(`  ✓ ${file}`)
}

await client.end()

// --- Create storage bucket ---
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const BUCKET = 'umamusume'
const { data: existing } = await supabase.storage.getBucket(BUCKET)

if (existing) {
  console.log(`  ✓ bucket '${BUCKET}' already exists`)
} else {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error) {
    console.error(`  ✗ bucket '${BUCKET}': ${error.message}`)
  } else {
    console.log(`  ✓ bucket '${BUCKET}' created`)
  }
}

console.log('\nSetup complete. Run npm run db:seed to populate cards.')
