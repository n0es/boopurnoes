/**
 * Copy a user's support card + trainee collections from production into the local DB.
 *
 * Prerequisites (same as db:sync — see scripts/sync-prod.ts):
 *   - Local: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   - Prod: PROD_SUPABASE_URL, PROD_SUPABASE_SERVICE_KEY
 *
 * The target user_id must exist as auth.users locally (this script creates it via
 * Auth Admin API if missing, cloning behavior from a standard admin createUser call).
 *
 * Usage:
 *   npm run db:import-user-collection -- 9939a48c-415d-4910-bd95-38bbba05cbc1
 *   IMPORT_USER_ID=9939a48c-415d-4910-bd95-38bbba05cbc1 npm run db:import-user-collection
 *
 * To move imported rows to your real local login UUID, use:
 *   npm run db:transfer-user-collection -- <prodUserId> <localAuthUserId>
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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
} catch {
  /* use env */
}

const localUrl = process.env.SUPABASE_URL
const localServiceKey = process.env.SUPABASE_SERVICE_KEY
const prodUrl = process.env.PROD_SUPABASE_URL
const prodServiceKey = process.env.PROD_SUPABASE_SERVICE_KEY

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const argvId = process.argv.find(a => uuidRe.test(a))
const userId = (argvId ?? process.env.IMPORT_USER_ID ?? '').trim()

const missing = (
  [
    ['SUPABASE_URL', localUrl],
    ['SUPABASE_SERVICE_KEY', localServiceKey],
    ['PROD_SUPABASE_URL', prodUrl],
    ['PROD_SUPABASE_SERVICE_KEY', prodServiceKey],
  ] as const
).filter(([, v]) => !v).map(([k]) => k)

if (missing.length) {
  console.error('Missing required env vars:', missing.join(', '))
  process.exit(1)
}

if (!userId) {
  console.error('Pass production user UUID as an argument or set IMPORT_USER_ID.')
  console.error('Example: npm run db:import-user-collection -- <uuid>')
  process.exit(1)
}

const prod = createClient(prodUrl!, prodServiceKey!)
const local = createClient(localUrl!, localServiceKey!)

async function ensureLocalAuthUser(): Promise<void> {
  const { data: existing, error: getErr } = await local.auth.admin.getUserById(userId)
  if (!getErr && existing?.user) {
    console.log(`  ✓ Local auth user already exists: ${userId}`)
    return
  }

  const email = `import-${userId.slice(0, 8)}@local.import`
  const password = 'LocalImportDev1!'

  const { data, error } = await local.auth.admin.createUser({
    id: userId,
    email,
    password,
    email_confirm: true,
    app_metadata: { provider: 'email', providers: ['email'] },
  })

  if (error) {
    console.error('  ✗ auth.admin.createUser:', error.message)
    console.error(
      '    If your GoTrue version ignores `id`, create the user in Supabase Studio with this UUID, then re-run.',
    )
    process.exit(1)
  }

  console.log(`  ✓ Created local auth user ${data.user?.id ?? userId} (${email})`)
  console.log(`    Password (dev only): ${password}`)
}

async function fetchProdSupportCollection() {
  const { data, error } = await prod
    .schema('uma').from('user_support_card_collection')
    .select('user_id, card_id, level, uncap, added_at')
    .eq('user_id', userId)
  if (error) throw new Error(`prod user_support_card_collection: ${error.message}`)
  return data ?? []
}

async function fetchProdTraineeCollection() {
  const { data, error } = await prod
    .schema('uma').from('user_trainee_collection')
    .select('user_id, trainee_id, star_rank, awakening_level')
    .eq('user_id', userId)
  if (error) {
    if (error.message.includes('does not exist') || error.code === 'PGRST205') {
      console.warn('  (prod user_trainee_collection not available, skipping)')
      return []
    }
    throw new Error(`prod user_trainee_collection: ${error.message}`)
  }
  return data ?? []
}

async function main() {
  console.log(`--- Import collections for user ${userId} ---\n`)

  console.log('Fetching from production…')
  const supportRows = await fetchProdSupportCollection()
  const traineeRows = await fetchProdTraineeCollection()
  console.log(`  support cards: ${supportRows.length} rows`)
  console.log(`  trainees: ${traineeRows.length} rows`)

  console.log('\nEnsuring local auth user…')
  await ensureLocalAuthUser()

  console.log('\nWriting locally (service role)…')

  const { error: delS } = await local.schema('uma').from('user_support_card_collection').delete().eq('user_id', userId)
  if (delS) console.warn('  warn delete support collection:', delS.message)

  if (supportRows.length > 0) {
    const { error: upS } = await local.schema('uma').from('user_support_card_collection').upsert(supportRows, {
      onConflict: 'user_id,card_id',
    })
    if (upS) {
      console.error('  ✗ upsert user_support_card_collection:', upS.message)
      process.exit(1)
    }
    console.log(`  ✓ user_support_card_collection: ${supportRows.length} rows`)
  } else {
    console.log('  ✓ user_support_card_collection: (empty on prod, nothing to write)')
  }

  const { error: delT } = await local.schema('uma').from('user_trainee_collection').delete().eq('user_id', userId)
  if (delT) console.warn('  warn delete trainee collection:', delT.message)

  if (traineeRows.length > 0) {
    const { error: upT } = await local.schema('uma').from('user_trainee_collection').upsert(traineeRows, {
      onConflict: 'user_id,trainee_id',
    })
    if (upT) {
      console.error('  ✗ upsert user_trainee_collection:', upT.message)
      process.exit(1)
    }
    console.log(`  ✓ user_trainee_collection: ${traineeRows.length} rows`)
  } else {
    console.log('  ✓ user_trainee_collection: (empty on prod, nothing to write)')
  }

  console.log('\nDone. Sign in locally with the import email / password printed above, or link this UUID in Studio.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
