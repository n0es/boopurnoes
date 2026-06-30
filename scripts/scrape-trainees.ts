/**
 * Gametora Trainee Skills Scraper
 *
 * Fetches trainee skill data from Gametora's Next.js data routes and writes
 * awakening skills, unique skills, and hint skills into the local Supabase DB.
 * Handles upgrade relationships (upgrade_of) and unique skill star ranks
 * (min_star_rank).
 *
 * Usage:
 *   npm run db:scrape-trainees                      — scrape all trainees
 *   npm run db:scrape-trainees -- 100701            — scrape one trainee by id
 *   npm run db:scrape-trainees -- 100701-gold-ship  — scrape one trainee by slug
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Env ───────────────────────────────────────────────────────────────────────

try {
  const envPath = resolve(process.cwd(), '.env.local')
  const contents = readFileSync(envPath, 'utf-8')
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
  // .env.local not found — rely on env vars already set
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ── Gametora skill data ───────────────────────────────────────────────────────

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
  upgrade_of_gametora_id: number | null  // gametora_id of the base skill
}

let _skillsData: GtSkillRaw[] | null = null
let _skillMap: Map<number, SkillInfo> | null = null

async function getSkillMap(): Promise<Map<number, SkillInfo>> {
  if (_skillMap) return _skillMap

  console.log('Loading skills database from Gametora...')
  const resp = await fetch('https://gametora.com/data/umamusume/skills.5d6eddd9.json')
  if (!resp.ok) throw new Error(`Failed to fetch skills JSON: ${resp.status}`)
  _skillsData = await resp.json() as GtSkillRaw[]

  _skillMap = new Map()

  function iconUrl(iconid?: string | number): string | null {
    return iconid
      ? `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${iconid}.png`
      : null
  }

  function addSkill(s: GtSkillRaw, upgradeOfId: number | null) {
    if (_skillMap!.has(s.id)) return
    // Cost: use own cost if present, otherwise inherit from gene_version.cost
    const cost = s.cost ?? null
    _skillMap!.set(s.id, {
      gametora_id: s.id,
      name: s.name_en || s.enname || s.jpname || `Skill #${s.id}`,
      description: s.desc_en || s.endesc || null,
      icon_url: iconUrl(s.iconid),
      rarity: s.rarity ?? null,
      cost,
      upgrade_of_gametora_id: upgradeOfId,
    })
  }

  for (const s of _skillsData) {
    // Register the base skill first (gene_version is the lower-rarity parent)
    if (s.gene_version) {
      const gv = s.gene_version
      addSkill({
        id: gv.id,
        name_en: gv.name_en || s.enname,
        enname: gv.name_en || s.enname,
        jpname: s.jpname,
        desc_en: gv.desc_en || s.desc_en,
        endesc: gv.endesc || s.endesc,
        iconid: gv.iconid || s.iconid,
        rarity: gv.rarity,
        cost: gv.cost,
      }, null)  // base skill has no upgrade_of
      // Higher-rarity upgrade: cost comes from gene_version (same base cost)
      addSkill({ ...s, cost: s.cost ?? gv.cost }, gv.id)
    } else {
      addSkill(s, null)
    }
  }

  console.log(`  Loaded ${_skillMap.size} skills`)
  return _skillMap
}

// ── Ensure skills exist in DB, return their local ids ────────────────────────

async function upsertSkills(gtIds: number[]): Promise<Map<number, number>> {
  const skillMap = await getSkillMap()
  const result = new Map<number, number>()

  // Collect all skill infos needed, deduplicated by gametora_id.
  // Ensure base skills (upgrade_of) are included so the FK can be resolved.
  const seen = new Set<number>()
  const toUpsert: SkillInfo[] = []

  function collect(gtId: number) {
    if (seen.has(gtId)) return
    seen.add(gtId)
    const info = skillMap.get(gtId)
    if (!info) { console.warn(`  Unknown gametora skill id: ${gtId}`); return }
    // Collect base skill first so FK can be satisfied in order
    if (info.upgrade_of_gametora_id) collect(info.upgrade_of_gametora_id)
    toUpsert.push(info)
  }

  for (const gtId of new Set(gtIds)) collect(gtId)

  if (toUpsert.length === 0) return result

  // First pass: upsert base skills (no upgrade_of)
  const baseRows = toUpsert
    .filter(s => !s.upgrade_of_gametora_id)
    .map(s => ({
      gametora_id: s.gametora_id,
      name: s.name,
      description: s.description,
      icon_url: s.icon_url,
      rarity: s.rarity,
      cost: s.cost,
    }))

  if (baseRows.length > 0) {
    const { error } = await supabase
      .schema('uma').from('skills')
      .upsert(baseRows, { onConflict: 'gametora_id' })
    if (error) throw new Error(`Upsert base skills: ${error.message}`)
  }

  // Fetch DB ids for all skills seen so far to resolve upgrade_of FK
  const allGtIds = toUpsert.map(s => s.gametora_id)
  const { data: existing, error: fetchErr } = await supabase
    .schema('uma').from('skills')
    .select('id, gametora_id')
    .in('gametora_id', allGtIds)
  if (fetchErr) throw new Error(`Fetch skills: ${fetchErr.message}`)

  const gtToDbId = new Map<number, number>()
  for (const row of existing ?? []) {
    gtToDbId.set(row.gametora_id, row.id)
    result.set(row.gametora_id, row.id)
  }

  // Second pass: upsert upgrade skills with resolved upgrade_of
  const upgradeRows = toUpsert.filter(s => s.upgrade_of_gametora_id != null)
  if (upgradeRows.length > 0) {
    const rows = upgradeRows.map(s => ({
      gametora_id: s.gametora_id,
      name: s.name,
      description: s.description,
      icon_url: s.icon_url,
      rarity: s.rarity,
      cost: s.cost,
      upgrade_of: s.upgrade_of_gametora_id ? (gtToDbId.get(s.upgrade_of_gametora_id) ?? null) : null,
    }))
    const { error } = await supabase
      .schema('uma').from('skills')
      .upsert(rows, { onConflict: 'gametora_id' })
    if (error) throw new Error(`Upsert upgrade skills: ${error.message}`)

    // Fetch ids for newly upserted upgrade skills
    const upgradeGtIds = upgradeRows.map(s => s.gametora_id)
    const { data: upgradeExisting, error: ue } = await supabase
      .schema('uma').from('skills')
      .select('id, gametora_id')
      .in('gametora_id', upgradeGtIds)
    if (ue) throw new Error(`Fetch upgrade skills: ${ue.message}`)
    for (const row of upgradeExisting ?? []) {
      result.set(row.gametora_id, row.id)
    }
  }

  return result
}

// ── Gametora data fetching ────────────────────────────────────────────────────

let _buildId: string | null = null

async function getBuildId(): Promise<string> {
  if (_buildId) return _buildId
  const html = await (await fetch('https://gametora.com/umamusume')).text()
  const m = html.match(/"buildId":"([^"]+)"/)
  if (!m) throw new Error('Could not find Gametora buildId')
  _buildId = m[1]
  return _buildId
}

async function fetchTraineeData(slug: string) {
  const buildId = await getBuildId()
  const url = `https://gametora.com/_next/data/${buildId}/umamusume/characters/${slug}.json`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${slug}: ${resp.status}`)
  return resp.json()
}

// ── min_star_rank logic ───────────────────────────────────────────────────────

// For a character of `rarity` stars:
//   unique[0] → their native rarity  (1★, 2★, or 3★)
//   unique[1] → promoted rarity      (3★ for both 1★ and 2★ chars)
//   3★ chars only have one unique
function minStarRankForUnique(charRarity: number, uniqueIndex: number): number {
  if (uniqueIndex === 0) return charRarity   // native rarity
  return 3                                    // promoted unique always unlocks at 3★
}

// ── Parse trainee page data ───────────────────────────────────────────────────

interface ParsedTrainee {
  title: string | null
  awakeningSkills: Array<{ gametora_id: number; awakening_level: number }>
  uniqueSkills: Array<{ gametora_id: number; sort_order: number; min_star_rank: number }>
  hintSkills: Array<{ gametora_id: number }>
}

function parseTraineeData(charRarity: number, pageData: any): ParsedTrainee {
  // Gametora puts trainee/card data in itemData (charData has only bio fields)
  const item = pageData.pageProps?.itemData

  if (!item) throw new Error('No itemData in page props')

  const title: string | null = item.title ?? null

  // Awakening skills: skills_awakening is an array of 4 IDs → levels 2, 3, 4, 5
  const awakeningSkills: Array<{ gametora_id: number; awakening_level: number }> = []
  const rawAwakening: number[] = item.skills_awakening ?? []
  rawAwakening.forEach((id: number, i: number) => {
    if (id) awakeningSkills.push({ gametora_id: id, awakening_level: i + 2 })
  })

  // Unique skills: skills_unique is an array of IDs
  // index 0 = native rarity unique, index 1 = promoted (3★+) unique
  const uniqueSkills: Array<{ gametora_id: number; sort_order: number; min_star_rank: number }> = []
  const rawUnique: number[] = item.skills_unique ?? []
  rawUnique.forEach((id: number, i: number) => {
    if (id) {
      uniqueSkills.push({
        gametora_id: id,
        sort_order: i,
        min_star_rank: minStarRankForUnique(charRarity, i),
      })
    }
  })

  // Hint/innate skills: skills_innate are the trainee's innate skills
  const hintSkills: Array<{ gametora_id: number }> = []
  const rawHint: number[] = item.skills_innate ?? []
  rawHint.forEach((id: number) => {
    if (id) hintSkills.push({ gametora_id: id })
  })

  return { title, awakeningSkills, uniqueSkills, hintSkills }
}

// ── Save to Supabase ──────────────────────────────────────────────────────────

async function saveTraineeSkills(traineeId: number, charRarity: number, parsed: ParsedTrainee) {
  // Collect all gametora skill ids we need
  const allGtIds = [
    ...parsed.awakeningSkills.map(s => s.gametora_id),
    ...parsed.uniqueSkills.map(s => s.gametora_id),
    ...parsed.hintSkills.map(s => s.gametora_id),
  ]

  const gtToDbId = allGtIds.length > 0 ? await upsertSkills(allGtIds) : new Map<number, number>()

  // Clear existing junction rows for this trainee
  await Promise.all([
    supabase.schema('uma').from('trainee_awakening_skills').delete().eq('trainee_id', traineeId),
    supabase.schema('uma').from('trainee_unique_skills').delete().eq('trainee_id', traineeId),
    supabase.schema('uma').from('trainee_hint_skills').delete().eq('trainee_id', traineeId),
  ])

  // Insert awakening skills
  if (parsed.awakeningSkills.length > 0) {
    const rows = parsed.awakeningSkills
      .map(s => {
        const skillId = gtToDbId.get(s.gametora_id)
        if (!skillId) return null
        return { trainee_id: traineeId, skill_id: skillId, awakening_level: s.awakening_level }
      })
      .filter(Boolean)
    if (rows.length > 0) {
      const { error } = await supabase.schema('uma').from('trainee_awakening_skills').insert(rows)
      if (error) throw new Error(`Insert awakening skills: ${error.message}`)
    }
  }

  // Insert unique skills
  if (parsed.uniqueSkills.length > 0) {
    const rows = parsed.uniqueSkills
      .map(s => {
        const skillId = gtToDbId.get(s.gametora_id)
        if (!skillId) return null
        return {
          trainee_id: traineeId,
          skill_id: skillId,
          sort_order: s.sort_order,
          min_star_rank: s.min_star_rank,
        }
      })
      .filter(Boolean)
    if (rows.length > 0) {
      const { error } = await supabase.schema('uma').from('trainee_unique_skills').insert(rows)
      if (error) throw new Error(`Insert unique skills: ${error.message}`)
    }
    // Unique skills are free for the character's own training runs (cost = 0).
    // Gametora's gene_version cost reflects legacy use, not own-character use.
    const uniqueDbIds = parsed.uniqueSkills
      .map(s => gtToDbId.get(s.gametora_id))
      .filter((id): id is number => id != null)
    if (uniqueDbIds.length > 0) {
      const { error } = await supabase
        .schema('uma').from('skills')
        .update({ cost: 0 })
        .in('id', uniqueDbIds)
      if (error) throw new Error(`Set unique skill cost to 0: ${error.message}`)
    }
  }

  // Insert hint skills
  if (parsed.hintSkills.length > 0) {
    const rows = parsed.hintSkills
      .map(s => {
        const skillId = gtToDbId.get(s.gametora_id)
        if (!skillId) return null
        return { trainee_id: traineeId, skill_id: skillId }
      })
      .filter(Boolean)
    if (rows.length > 0) {
      const { error } = await supabase.schema('uma').from('trainee_hint_skills').insert(rows)
      if (error) throw new Error(`Insert hint skills: ${error.message}`)
    }
  }

  // Update title
  if (parsed.title !== null) {
    const { error } = await supabase
      .schema('uma').from('trainees')
      .update({ title: parsed.title })
      .eq('id', traineeId)
    if (error) throw new Error(`Update title: ${error.message}`)
  }
}

// ── Scrape one trainee ────────────────────────────────────────────────────────

async function scrapeOne(slugOrId: string | number) {
  await getSkillMap()

  // Resolve slug + rarity from DB
  let query = supabase.schema('uma').from('trainees').select('id, gametora_slug, rarity, name')
  if (typeof slugOrId === 'number' || /^\d+$/.test(String(slugOrId))) {
    query = query.eq('id', Number(slugOrId))
  } else {
    query = query.eq('gametora_slug', String(slugOrId))
  }
  const { data, error } = await query.single()
  if (error || !data) throw new Error(`Trainee not found: ${slugOrId}`)

  console.log(`Scraping ${data.name} (${data.gametora_slug}, rarity ${data.rarity})...`)

  const pageData = await fetchTraineeData(data.gametora_slug)
  const parsed = parseTraineeData(data.rarity, pageData)

  console.log(`  ${parsed.awakeningSkills.length} awakening, ${parsed.uniqueSkills.length} unique, ${parsed.hintSkills.length} hint`)
  console.log(`  Unique min_star_ranks: ${parsed.uniqueSkills.map(s => s.min_star_rank).join(', ')}`)

  await saveTraineeSkills(data.id, data.rarity, parsed)
  console.log(`  Saved.`)
}

// ── Scrape all trainees ───────────────────────────────────────────────────────

async function scrapeAll(limit?: number) {
  await getSkillMap()

  const { data: trainees, error } = await supabase
    .schema('uma').from('trainees')
    .select('id, gametora_slug, rarity, name')
    .not('gametora_slug', 'is', null)
    .order('id')
    .limit(limit ?? 1000)
  if (error) throw new Error(`Fetch trainees: ${error.message}`)

  console.log(`Scraping ${trainees!.length} trainees...`)

  let success = 0, errors = 0
  for (let i = 0; i < trainees!.length; i++) {
    const t = trainees![i]
    try {
      process.stdout.write(`[${i + 1}/${trainees!.length}] ${t.name} ... `)
      const pageData = await fetchTraineeData(t.gametora_slug)
      const parsed = parseTraineeData(t.rarity, pageData)
      await saveTraineeSkills(t.id, t.rarity, parsed)
      console.log(`done (${parsed.awakeningSkills.length}awk ${parsed.uniqueSkills.length}unq ${parsed.hintSkills.length}hint)`)
      success++
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`)
      errors++
    }
    // Rate limit
    if (i < trainees!.length - 1) await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\nDone. ${success} succeeded, ${errors} failed.`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const arg = process.argv[2]
if (arg) {
  scrapeOne(arg).catch(err => { console.error(err.message); process.exit(1) })
} else {
  scrapeAll().catch(err => { console.error(err.message); process.exit(1) })
}
