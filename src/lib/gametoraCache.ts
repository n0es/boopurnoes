import type { SupabaseClient } from '@supabase/supabase-js'

/** Dev: Vite proxies `/gametora-data/*` → `https://gametora.com/data/*` (see vite.config.ts). Prod: direct CDN URL. */
export function gametoraDataHref(pathWithinData: string): string {
  const p = pathWithinData.replace(/^\//, '')
  if (import.meta.env.DEV) return `/gametora-data/${p}`
  return `https://gametora.com/data/${p}`
}

type ManifestMap = Record<string, string>

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GameTora fetch failed ${res.status}: ${url}`)
  return res.json() as Promise<unknown>
}

async function readCacheRow(supabase: SupabaseClient, resourceKey: string): Promise<{ body: unknown; content_hash: string | null } | null> {
  const { data, error } = await supabase
    .from('gametora_json_cache')
    .select('body, content_hash')
    .eq('resource_key', resourceKey)
    .maybeSingle()
  if (error || !data) return null
  return { body: data.body as unknown, content_hash: data.content_hash as string | null }
}

async function writeCacheRow(
  supabase: SupabaseClient,
  resourceKey: string,
  body: unknown,
  contentHash: string | null,
  sourceUrl: string,
): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return

  await supabase.from('gametora_json_cache').upsert(
    {
      resource_key: resourceKey,
      body: body as object,
      content_hash: contentHash,
      source_url: sourceUrl,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'resource_key' },
  )
}

/** Current manifest location (GameTora moved it out of `umamusume/manifests/`). */
const MANIFEST_RESOURCE_KEY = 'manifests/umamusume'
const MANIFEST_PATH = 'manifests/umamusume.json'
/** Older Supabase cache rows; still accept as manifest body. */
const LEGACY_MANIFEST_RESOURCE_KEY = 'umamusume/manifests/umamusume'

/**
 * Load GameTora umamusume manifest (hash map). Uses Supabase when present and hash matches;
 * otherwise fetches one file from GameTora and optionally stores it (signed-in users only).
 */
export async function getGametoraUmamusumeManifest(supabase: SupabaseClient): Promise<ManifestMap> {
  const url = gametoraDataHref(MANIFEST_PATH)
  const cached =
    (await readCacheRow(supabase, MANIFEST_RESOURCE_KEY))
    ?? (await readCacheRow(supabase, LEGACY_MANIFEST_RESOURCE_KEY))
  if (cached?.body && typeof cached.body === 'object' && !Array.isArray(cached.body)) {
    return cached.body as ManifestMap
  }

  const fresh = (await fetchJson(url)) as ManifestMap
  await writeCacheRow(supabase, MANIFEST_RESOURCE_KEY, fresh, null, url)
  return fresh
}

/**
 * Load a versioned JSON file listed in the manifest (e.g. manifest key `characters` → umamusume/characters.{hash}.json).
 * Cache key includes content hash so a new game version refetches only that resource.
 */
export async function getGametoraManifestJson(
  supabase: SupabaseClient,
  manifestKey: string,
): Promise<unknown> {
  const manifest = await getGametoraUmamusumeManifest(supabase)
  const hash = manifest[manifestKey]
  if (!hash || typeof hash !== 'string') {
    throw new Error(`Manifest missing key: ${manifestKey}`)
  }

  const relativePath = `umamusume/${manifestKey}.${hash}.json`
  const cacheKey = relativePath
  const expectedHash = hash

  const cached = await readCacheRow(supabase, cacheKey)
  if (cached?.body != null && cached.content_hash === expectedHash) {
    return cached.body
  }

  const url = gametoraDataHref(relativePath)
  const fresh = await fetchJson(url)
  await writeCacheRow(supabase, cacheKey, fresh, expectedHash, url)
  return fresh
}
