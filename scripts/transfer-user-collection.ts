/**
 * Move support card + trainee collection rows from one auth user to another (local DB).
 *
 * - Deletes any existing collection rows for the destination user (replaced by the transfer).
 * - Reassigns all rows from the source user to the destination user.
 *
 * Requires DATABASE_URL (same as db:sync) pointing at your local Postgres.
 *
 * Usage:
 *   npm run db:transfer-user-collection -- 9939a48c-415d-4910-bd95-38bbba05cbc1 c31096d9-522d-49c0-b42e-e25eeaae1ad8
 */

import pg from 'pg'
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

const databaseUrl = process.env.DATABASE_URL

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const argvUuids = process.argv.filter(a => uuidRe.test(a))

if (!databaseUrl) {
  console.error('Missing DATABASE_URL (local Postgres connection string).')
  process.exit(1)
}

if (argvUuids.length !== 2) {
  console.error('Pass exactly two UUIDs: <fromUserId> <toUserId>')
  console.error(
    'Example: npm run db:transfer-user-collection -- 9939a48c-415d-4910-bd95-38bbba05cbc1 c31096d9-522d-49c0-b42e-e25eeaae1ad8',
  )
  process.exit(1)
}

const [fromId, toId] = argvUuids as [string, string]

if (fromId === toId) {
  console.error('Source and destination must differ.')
  process.exit(1)
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()

  try {
    await client.query('BEGIN')

    const delS = await client.query(
      'DELETE FROM public.user_support_card_collection WHERE user_id = $1',
      [toId],
    )
    const delT = await client.query(
      'DELETE FROM public.user_trainee_collection WHERE user_id = $1',
      [toId],
    )
    console.log(`Cleared destination collections: ${delS.rowCount} support rows, ${delT.rowCount} trainee rows`)

    const upS = await client.query(
      'UPDATE public.user_support_card_collection SET user_id = $1 WHERE user_id = $2',
      [toId, fromId],
    )
    const upT = await client.query(
      'UPDATE public.user_trainee_collection SET user_id = $1 WHERE user_id = $2',
      [toId, fromId],
    )
    console.log(`Moved: ${upS.rowCount} support card rows, ${upT.rowCount} trainee rows`)

    if (upS.rowCount === 0 && upT.rowCount === 0) {
      console.warn(
        '\nWarning: no rows were reassigned — the source user had no collection in this database.',
      )
      console.warn('Import from prod first: npm run db:import-user-collection -- <fromUserId>')
    }

    await client.query('COMMIT')
    console.log(`\nDone. Collections for ${fromId} are now under ${toId}.`)
    console.log('Sign in as the destination account in the app to see them.')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
