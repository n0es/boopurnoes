/**
 * Full Gametora Trainee Importer
 *
 * Discovers all trainee slugs from the Gametora sitemap, then for each one:
 *   1. Fetches page data from Gametora (_next/data route)
 *   2. Upserts the trainee row (name, rarity, aptitudes, stats, title)
 *   3. Upserts awakening / unique / hint skills
 *   4. Downloads portrait + icon images to Supabase storage
 *
 * Usage:
 *   npm run db:import-trainees                        — import / update all
 *   npm run db:import-trainees -- 100601-oguri-cap    — single slug
 *   npm run db:import-trainees -- --images-only       — skip data, re-download images
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

const CONCURRENCY = 4
const DELAY_MS    = 300
const BUCKET      = 'umamusume'

const slugArg    = process.argv.find(a => /^\d{6}-/.test(a))
const imagesOnly = process.argv.includes('--images-only')

// ── Sitemap discovery ─────────────────────────────────────────────────────────

async function getAllSlugs(): Promise<string[]> {
  const xml = await fetch('https://gametora.com/sitemap-0.xml').then(r => r.text())
  return [...new Set(
    [...xml.matchAll(/\/umamusume\/characters\/(\d{6}-[a-z0-9-]+)/g)].map(m => m[1])
  )]
}

// ── Gametora page data ────────────────────────────────────────────────────────

let _buildId: string | null = null
async function getBuildId(): Promise<string> {
  if (_buildId) return _buildId
  const html = await fetch('https://gametora.com/umamusume').then(r => r.text())
  const m = html.match(/"buildId":"([^"]+)"/)
  if (!m) throw new Error('Could not find Gametora buildId')
  _buildId = m[1]
  return _buildId
}

async function fetchPageData(slug: string): Promise<any> {
  const buildId = await getBuildId()
  const url = `https://gametora.com/_next/data/${buildId}/umamusume/characters/${slug}.json`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${slug}`)
  return resp.json()
}

// ── Skills upsert (reused logic from scrape-trainees) ─────────────────────────

interface GtSkillRaw {
  id: number
  name_en?: string
  enname?: string
  jpname?: string
  desc_en?: string
  endesc?: string
  iconid?: string | number
  rarity?: number
  cost?: number
  gene_version?: GtSkillRaw
}

interface SkillInfo {
  gametora_id: number
  name: string
  description: string | null
  icon_url: string | null
  rarity: number | null
  cost: number | null
  upgrade_of_gametora_id: number | null
}

let _skillMap: Map<number, SkillInfo> | null = null

async function getSkillMap(): Promise<Map<number, SkillInfo>> {
  if (_skillMap) return _skillMap
  const resp = await fetch('https://gametora.com/data/umamusume/skills.5d6eddd9.json')
  if (!resp.ok) throw new Error(`Failed to fetch skills JSON: ${resp.status}`)
  const raw: GtSkillRaw[] = await resp.json()
  _skillMap = new Map()

  function iconUrl(id?: string | number): string | null {
    return id ? `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${id}.png` : null
  }

  function addSkill(s: GtSkillRaw, upgradeOfId: number | null) {
    if (_skillMap!.has(s.id)) return
    _skillMap!.set(s.id, {
      gametora_id: s.id,
      name: s.name_en || s.enname || s.jpname || `Skill #${s.id}`,
      description: s.desc_en || s.endesc || null,
      icon_url: iconUrl(s.iconid),
      rarity: s.rarity ?? null,
      cost: s.cost ?? null,
      upgrade_of_gametora_id: upgradeOfId,
    })
  }

  for (const s of raw) {
    if (s.gene_version) {
      const gv = s.gene_version
      addSkill({ id: gv.id, name_en: gv.name_en || s.enname, enname: gv.name_en || s.enname,
        jpname: s.jpname, desc_en: gv.desc_en || s.desc_en, endesc: gv.endesc || s.endesc,
        iconid: gv.iconid || s.iconid, rarity: gv.rarity, cost: gv.cost }, null)
      addSkill({ ...s, cost: s.cost ?? gv.cost }, gv.id)
    } else {
      addSkill(s, null)
    }
  }
  return _skillMap
}

async function upsertSkills(gtIds: number[]): Promise<Map<number, number>> {
  const skillMap = await getSkillMap()
  const result = new Map<number, number>()
  const seen = new Set<number>()
  const toUpsert: SkillInfo[] = []

  function collect(gtId: number) {
    if (seen.has(gtId)) return
    seen.add(gtId)
    const info = skillMap.get(gtId)
    if (!info) return
    if (info.upgrade_of_gametora_id) collect(info.upgrade_of_gametora_id)
    toUpsert.push(info)
  }
  for (const id of new Set(gtIds)) collect(id)
  if (toUpsert.length === 0) return result

  const baseRows = toUpsert.filter(s => !s.upgrade_of_gametora_id)
    .map(s => ({ gametora_id: s.gametora_id, name: s.name, description: s.description,
      icon_url: s.icon_url, rarity: s.rarity, cost: s.cost }))
  if (baseRows.length > 0) {
    const { error } = await supabase.schema('uma').from('skills').upsert(baseRows, { onConflict: 'gametora_id' })
    if (error) throw new Error(`Upsert base skills: ${error.message}`)
  }

  const { data: existing, error: fe } = await supabase.schema('uma').from('skills')
    .select('id, gametora_id').in('gametora_id', toUpsert.map(s => s.gametora_id))
  if (fe) throw new Error(`Fetch skills: ${fe.message}`)
  const gtToDbId = new Map<number, number>()
  for (const row of existing ?? []) { gtToDbId.set(row.gametora_id, row.id); result.set(row.gametora_id, row.id) }

  const upgradeRows = toUpsert.filter(s => s.upgrade_of_gametora_id != null)
  if (upgradeRows.length > 0) {
    const rows = upgradeRows.map(s => ({
      gametora_id: s.gametora_id, name: s.name, description: s.description,
      icon_url: s.icon_url, rarity: s.rarity, cost: s.cost,
      upgrade_of: s.upgrade_of_gametora_id ? (gtToDbId.get(s.upgrade_of_gametora_id) ?? null) : null,
    }))
    const { error } = await supabase.schema('uma').from('skills').upsert(rows, { onConflict: 'gametora_id' })
    if (error) throw new Error(`Upsert upgrade skills: ${error.message}`)
    const { data: ue2 } = await supabase.schema('uma').from('skills').select('id, gametora_id')
      .in('gametora_id', upgradeRows.map(s => s.gametora_id))
    for (const row of ue2 ?? []) result.set(row.gametora_id, row.id)
  }
  return result
}

// ── Unique skill min star rank ────────────────────────────────────────────────

function minStarRankForUnique(charRarity: number, index: number): number {
  if (index === 0) return charRarity   // native rarity unique
  if (index === 1) return Math.max(3, charRarity)  // promoted unique (3★+)
  return charRarity
}

// ── Parse + save one character ────────────────────────────────────────────────

async function importTrainee(slug: string): Promise<void> {
  const pageData = await fetchPageData(slug)
  const item = pageData?.pageProps?.itemData
  if (!item) throw new Error(`No itemData for ${slug}`)

  const id: number        = item.card_id
  const rarity: number    = item.rarity ?? 1
  const name: string      = item.name_en ?? slug
  const name_jp: string   = item.name_jp ?? null
  const title: string | null = item.title ?? null

  // Aptitudes: [turf, dirt, short, mile, mid, long, leading, stalking, mid_pack, chasing]
  const apt: string[] = item.aptitude ?? []
  const [apt_turf, apt_dirt, apt_short, apt_mile, apt_mid, apt_long,
         apt_leading, apt_stalking, apt_mid_pack, apt_chasing] = apt

  // Stats
  const stats_base:      number[] | null = item.base_stats ?? null
  const stats_four_star: number[] | null = item.four_star_stats ?? null
  const stats_five_star: number[] | null = item.five_star_stats ?? null
  const stat_growth:     number[] | null = item.stat_bonus ?? null

  // Skills
  const rawAwakening: number[] = item.skills_awakening ?? []
  const rawUnique:    number[] = item.skills_unique ?? []
  const rawHint:      number[] = item.skills_innate ?? []

  const awakeningSkills = rawAwakening
    .map((gtId, i) => gtId ? { gametora_id: gtId, awakening_level: i + 2 } : null)
    .filter(Boolean) as { gametora_id: number; awakening_level: number }[]

  const uniqueSkills = rawUnique
    .map((gtId, i) => gtId ? { gametora_id: gtId, sort_order: i, min_star_rank: minStarRankForUnique(rarity, i) } : null)
    .filter(Boolean) as { gametora_id: number; sort_order: number; min_star_rank: number }[]

  const hintSkills = rawHint
    .filter(Boolean)
    .map(gtId => ({ gametora_id: gtId }))

  // 1. Upsert trainee row
  const { error: upsertErr } = await supabase.schema('uma').from('trainees').upsert({
    id, gametora_slug: slug, name, name_jp, rarity, title,
    apt_turf, apt_dirt, apt_short, apt_mile, apt_mid, apt_long,
    apt_leading, apt_stalking, apt_mid_pack, apt_chasing,
    stats_base, stats_four_star, stats_five_star, stat_growth,
    scraped_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (upsertErr) throw new Error(`Upsert trainee: ${upsertErr.message}`)

  // 2. Upsert skills
  const allGtIds = [
    ...awakeningSkills.map(s => s.gametora_id),
    ...uniqueSkills.map(s => s.gametora_id),
    ...hintSkills.map(s => s.gametora_id),
  ]
  const gtToDbId = allGtIds.length > 0 ? await upsertSkills(allGtIds) : new Map<number, number>()

  await Promise.all([
    supabase.schema('uma').from('trainee_awakening_skills').delete().eq('trainee_id', id),
    supabase.schema('uma').from('trainee_unique_skills').delete().eq('trainee_id', id),
    supabase.schema('uma').from('trainee_hint_skills').delete().eq('trainee_id', id),
  ])

  if (awakeningSkills.length > 0) {
    const rows = awakeningSkills.map(s => ({ trainee_id: id, skill_id: gtToDbId.get(s.gametora_id), awakening_level: s.awakening_level })).filter(r => r.skill_id)
    if (rows.length) await supabase.schema('uma').from('trainee_awakening_skills').insert(rows)
  }
  if (uniqueSkills.length > 0) {
    const rows = uniqueSkills.map(s => ({ trainee_id: id, skill_id: gtToDbId.get(s.gametora_id), sort_order: s.sort_order, min_star_rank: s.min_star_rank })).filter(r => r.skill_id)
    if (rows.length) {
      await supabase.schema('uma').from('trainee_unique_skills').insert(rows)
      const uniqueDbIds = rows.map(r => r.skill_id).filter((id): id is number => id != null)
      if (uniqueDbIds.length) await supabase.schema('uma').from('skills').update({ cost: 0 }).in('id', uniqueDbIds)
    }
  }
  if (hintSkills.length > 0) {
    const rows = hintSkills.map(s => ({ trainee_id: id, skill_id: gtToDbId.get(s.gametora_id) })).filter(r => r.skill_id)
    if (rows.length) await supabase.schema('uma').from('trainee_hint_skills').insert(rows)
  }
}

// ── Image download ────────────────────────────────────────────────────────────

function charId(id: number): number { return Math.floor(id / 100) }
function portraitUrl(id: number): string {
  return `https://gametora.com/images/umamusume/characters/chara_stand_${charId(id)}_${id}.png`
}
function iconUrl(id: number): string {
  return `https://gametora.com/images/umamusume/characters/icons/chr_icon_${charId(id)}.png`
}

async function downloadImages(id: number, name: string): Promise<{ ok: number; err: number }> {
  let ok = 0, err = 0
  for (const [url, path] of [
    [portraitUrl(id), `trainees/art/${id}.png`],
    [iconUrl(id),     `trainees/icons/${id}.png`],
  ] as const) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'image/png', upsert: true })
      if (error) throw new Error(error.message)
      ok++
    } catch (e: any) {
      process.stderr.write(`  ✗ ${name} (${id}) image error: ${e.message}\n`)
      err++
    }
  }
  // Update DB paths
  await supabase.schema('uma').from('trainees').update({
    image_path: `trainees/art/${id}.png`,
    icon_path: `trainees/icons/${id}.png`,
  }).eq('id', id)
  return { ok, err }
}

// ── Concurrent runner ─────────────────────────────────────────────────────────

async function runConcurrent<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
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

// ── Main ──────────────────────────────────────────────────────────────────────

const slugs = slugArg
  ? [slugArg]
  : await getAllSlugs()

console.log(`Found ${slugs.length} trainee slug(s) to process`)
if (!imagesOnly) console.log('Loading skills database...')
if (!imagesOnly) await getSkillMap()

let done = 0, dataOk = 0, dataErr = 0, imgOk = 0, imgErr = 0

await runConcurrent(slugs, CONCURRENCY, async (slug) => {
  const cardId = Number(slug.split('-')[0])
  try {
    if (!imagesOnly) {
      await importTrainee(slug)
      dataOk++
    }
    const imgs = await downloadImages(cardId, slug)
    imgOk  += imgs.ok
    imgErr += imgs.err
  } catch (e: any) {
    dataErr++
    process.stderr.write(`  ✗ ${slug}: ${e.message}\n`)
  }
  done++
  process.stdout.write(`\r  ${done}/${slugs.length}  data: ${dataOk} ok ${dataErr} err  images: ${imgOk} ok ${imgErr} err  `)
})

console.log('\n\nDone.')
console.log(`  ${dataOk} trainees upserted, ${dataErr} errors`)
console.log(`  ${imgOk} images uploaded, ${imgErr} errors`)
