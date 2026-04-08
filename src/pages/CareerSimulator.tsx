import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { getGametoraUmamusumeManifest } from '../lib/gametoraCache'
import { getSuccessionData, lookupSparkAffinity, type SuccessionData } from '../lib/successionAffinity'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LegacyMemberPanel } from './career/LegacyMemberPanel'
import type { Factor, LegacyMember, LegacySlot, LegacyTree, RaceOption, TraineeUniqueSkillOption } from './career/legacyTypes'
import { EMPTY_TRAINEE_UNIQUE_OPTIONS } from './career/legacyTypes'
import { addStatBlocks, inheritanceForBreakdown, legacyTreeHasConfiguration } from '../lib/careerStartingStats'
import { normalizeLegacyTree, normalizeMemberFactors } from './career/legacyNormalize'
import {
  clearCareerSimulatorPersisted,
  loadCareerSimulatorPersisted,
  saveCareerSimulatorPersisted,
  type CareerSimulatorPersisted,
} from '../lib/careerSimulatorStorage'
import {
  fetchCareerSimulatorSave,
  insertCareerSimulatorSave,
  isCareerSimulatorSaveId,
  updateCareerSimulatorSave,
} from '../lib/careerSimulatorCloud'
import type { LegacyMemberKey, LegacySlotKey } from './career/LegacyMemberPanel'
import { CareerTimeline } from '../components/CareerTimeline'
import { EntryDetailViewer } from '../components/TimelineDetail'
import { TurnActionPanel } from '../components/TurnActionPanel'
import { TraineeStatsPanel } from '../components/TraineeStatsPanel'
import {
  createCareerSession,
  previewTurn,
  advanceTurn,
  submitEvent,
  getCareerState,
  getTimeline,
  type TurnSnapshot,
  type TurnPreview,
  type TimelineEntrySummary,
  type TurnAction,
  type GameEvent,
} from '../lib/careerSessionApi'
import type { ReleaseMetadata } from '../lib/releaseMetadata'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Trainee extends ReleaseMetadata {
  id: number
  name: string
  name_jp: string | null
  title: string | null
  rarity: number
  stat_growth: number[] | null
  icon_path: string | null
  image_path: string | null
}

interface TraineeCollectionEntry {
  star_rank: number
  awakening_level: number
}

interface StatBlock {
  speed: number
  stamina: number
  power: number
  guts: number
  wisdom: number
}

interface CardSlotInfo {
  card_id: number
  level: number
  name: string
  card_type: string
  rarity: string
}

interface CareerInitialState {
  stats: StatBlock
  base_stats: StatBlock
  inheritance_stats: StatBlock
  support_card_stats: StatBlock
  sp: number
  energy: number
  mood: string
  friendship: number[]
  card_info: CardSlotInfo[]
  growth_rates: number[]
}

interface CardBasic extends ReleaseMetadata {
  id: number
  name: string
  rarity: string
  card_type: string
}

interface OwnedCardEntry {
  level: number
  uncap: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

const OPTIMIZER_URL = import.meta.env.VITE_OPTIMIZER_URL || '/optimizer-api'
const STAT_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom']
const STAT_KEYS = ['speed', 'stamina', 'power', 'guts', 'intelligence'] // storage key names
const STAT_COLORS = ['#60a5fa', '#fb923c', '#f87171', '#fbbf24', '#34d399']
const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`

const SCENARIOS = [
  { id: 'ura_finals', label: 'URA Finals' },
  { id: 'unity_cup', label: 'Unity Cup' },
  { id: 'trackblazer', label: 'Trackblazer' },
]

const LEGACY_APTITUDE_FALLBACK = ['Turf', 'Dirt', 'Sprint', 'Mile', 'Medium', 'Long', 'Front Runner', 'Pace Chaser', 'Late Surger', 'End Closer']

/** Fallback when a legacy member has no linked trainee id or no matrix row (Rust `LegacyConfig::affinity`). */
const API_LEGACY_AFFINITY = 'circle' as const

/** Max support card level at full limit break (matches `SupportCard::max_level_for_uncap` with uncap 4). */
function supportCardMaxLevelByRarity(rarity: string): number {
  const r = rarity.trim().toUpperCase()
  if (r === 'SSR') return 50
  if (r === 'SR') return 45
  if (r === 'R') return 40
  return 50
}

function clampSupportCardLevel(level: number, rarity: string): number {
  const max = supportCardMaxLevelByRarity(rarity)
  return Math.min(Math.max(1, Math.round(Number(level))), max)
}

const RARITY_STYLE: Record<number, { color: string; bg: string }> = {
  1: { color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' },
  2: { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  3: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
}

function getArtUrl(trainee: Pick<Trainee, 'id' | 'icon_path' | 'image_path'>) {
  const path = trainee.image_path ?? `trainees/art/${trainee.id}.png`
  return `${SUPABASE_STORAGE}/${path}`
}

function getCardIconUrl(cardId: number) {
  return `${SUPABASE_STORAGE}/supports/icons/${cardId}.png`
}

function getStatIconUrl(statKey: string) {
  return `${SUPABASE_STORAGE}/icons/${statKey}.png`
}

function getTypeIconUrl(cardType: string) {
  return `${SUPABASE_STORAGE}/icons/${cardType}.png`
}

function emptyLegacyMember(): LegacyMember {
  return { name: '', factors: [], trainee_id: null }
}

function emptyLegacySlot(): LegacySlot {
  return {
    parent: emptyLegacyMember(),
    grandparent_1: emptyLegacyMember(),
    grandparent_2: emptyLegacyMember(),
  }
}

function emptyLegacy(): LegacyTree {
  return {
    legacy_1: emptyLegacySlot(),
    legacy_2: emptyLegacySlot(),
  }
}

function enrichLegacySparkAffinity(tree: LegacyTree, runnerId: number, data: SuccessionData): LegacyTree {
  const mem = (m: LegacyMember, parentId: number | null, isGrandparent: boolean): LegacyMember => {
    const aff =
      m.trainee_id != null
        ? lookupSparkAffinity(data, runnerId, m.trainee_id, isGrandparent ? parentId : null)
        : undefined
    const next: LegacyMember = { ...m }
    if (aff) next.spark_affinity = aff
    else delete next.spark_affinity
    return next
  }
  const slot = (s: LegacySlot): LegacySlot => {
    const pid = s.parent.trainee_id ?? null
    return {
      parent: mem(s.parent, null, false),
      grandparent_1: mem(s.grandparent_1, pid, true),
      grandparent_2: mem(s.grandparent_2, pid, true),
    }
  }
  return {
    legacy_1: slot(tree.legacy_1),
    legacy_2: slot(tree.legacy_2),
  }
}

function stripLegacyMemberForApi(m: LegacyMember): LegacyMember {
  const out: LegacyMember = { name: m.name ?? '', factors: m.factors ?? [] }
  if (m.spark_affinity) out.spark_affinity = m.spark_affinity
  return out
}

function stripLegacyTreeForApi(tree: LegacyTree): LegacyTree {
  const stripSlot = (s: LegacySlot): LegacySlot => ({
    parent: stripLegacyMemberForApi(s.parent),
    grandparent_1: stripLegacyMemberForApi(s.grandparent_1),
    grandparent_2: stripLegacyMemberForApi(s.grandparent_2),
  })
  return { legacy_1: stripSlot(tree.legacy_1), legacy_2: stripSlot(tree.legacy_2) }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CareerSimulator() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { saveId } = useParams<{ saveId: string }>()

  // Data
  const [trainees, setTrainees] = useState<Trainee[]>([])
  const [cards, setCards] = useState<CardBasic[]>([])
  const [ownedCards, setOwnedCards] = useState<Record<number, OwnedCardEntry>>({})
  const [traineeCollection, setTraineeCollection] = useState<Record<number, TraineeCollectionEntry>>({})

  // Config
  const [selectedTrainee, setSelectedTrainee] = useState<number | null>(null)
  const [starRank, setStarRank] = useState(5)
  const [potentialLevel, setPotentialLevel] = useState(5)
  const [scenario, setScenario] = useState('ura_finals')
  const [deck, setDeck] = useState<(number | null)[]>([null, null, null, null, null, null])
  const [deckLevels, setDeckLevels] = useState<number[]>([50, 50, 50, 50, 50, 50])
  const [legacy, setLegacy] = useState<LegacyTree>(emptyLegacy())
  const [aptitudeNames, setAptitudeNames] = useState<string[]>(LEGACY_APTITUDE_FALLBACK)
  const [scenarioNames, setScenarioNames] = useState<string[]>([])
  const [raceOptions, setRaceOptions] = useState<RaceOption[]>([])
  const [skillNameById, setSkillNameById] = useState<Record<number, string>>({})
  /** Per-trainee unique skill variants (same order as DB `sort_order`). */
  const [uniqueSkillOptionsByTraineeId, setUniqueSkillOptionsByTraineeId] = useState<
    Record<number, TraineeUniqueSkillOption[]>
  >({})
  const [successionData, setSuccessionData] = useState<SuccessionData | null>(null)

  // Results
  const [initialState, setInitialState] = useState<CareerInitialState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Career Session State ─────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionTotalTurns, setSessionTotalTurns] = useState(78)
  const [sessionCurrentTurn, setSessionCurrentTurn] = useState(0)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [sessionHistory, setSessionHistory] = useState<TimelineEntrySummary[]>([])
  /** Snapshot for timeline cursor null: full career start (base + fixed legacy blues), before any logged events. */
  const [sessionInitialSnapshot, setSessionInitialSnapshot] = useState<TurnSnapshot | null>(null)
  const sliderSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Two-cursor state ──
  /** Slider position — drives TraineeStatsPanel above the bar. null = initial/pre-timeline state. */
  const [sliderPosition, setSliderPosition] = useState<number | null>(null)
  /** Snapshot at the slider position (full stats display). */
  const [sliderSnapshot, setSliderSnapshot] = useState<TurnSnapshot | null>(null)
  const [sliderLoading, setSliderLoading] = useState(false)

  /** Selected entry — drives EntryDetailViewer below the bar. null = nothing selected. */
  const [selectedEntry, setSelectedEntry] = useState<number | null>(null)
  /** Snapshot at the selected entry (for showing its effects). */
  const [selectedEntrySnapshot, setSelectedEntrySnapshot] = useState<TurnSnapshot | null>(null)
  /** Snapshot before the selected entry (for computing deltas). */
  const [selectedEntryPrevSnapshot, setSelectedEntryPrevSnapshot] = useState<TurnSnapshot | null>(null)
  const [turnPreview, setTurnPreview] = useState<TurnPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [advanceSubmitting, setAdvanceSubmitting] = useState(false)
  const [sessionStarting, setSessionStarting] = useState(false)

  /** When non-null, this editor is bound to a Supabase row (URL `/career-simulator/run/:id`). */
  const [activeCloudSave, setActiveCloudSave] = useState<{ id: string; name: string } | null>(null)
  const [cloudLoadError, setCloudLoadError] = useState<string | null>(null)
  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudSaveBusy, setCloudSaveBusy] = useState(false)

  /** If cloud hydrate finishes after /career/init, don't replace a fresher computed snapshot. */
  const cloudFetchStartedAtRef = useRef(0)
  const lastComputeSuccessAtRef = useRef(0)
  const latestInitialStateRef = useRef<CareerInitialState | null>(null)

  /** Live breakdown: character base + inheritance (no support-card row; API totals exclude deck 初期 stats). */
  const careerStartingDisplay = useMemo(() => {
    if (!initialState) return null
    const inheritance = inheritanceForBreakdown(
      legacy,
      initialState.inheritance_stats,
      initialState.stats,
      initialState.base_stats,
      initialState.support_card_stats,
    )
    const stats = addStatBlocks(initialState.base_stats, inheritance)
    return { inheritance, stats }
  }, [initialState, legacy])

  useEffect(() => {
    latestInitialStateRef.current = initialState
  }, [initialState])

  useEffect(() => () => {
    if (sliderSyncTimerRef.current) clearTimeout(sliderSyncTimerRef.current)
  }, [])

  /** False until localStorage draft (if any) is applied — avoids overwriting save before hydrate. */
  const [persistHydrated, setPersistHydrated] = useState(false)

  // UI
  const [traineeSearch, setTraineeSearch] = useState('')
  const [cardSearches, setCardSearches] = useState<string[]>(['', '', '', '', '', ''])

  const hydrateFromPersisted = useCallback((p: CareerSimulatorPersisted) => {
    setScenario(p.scenario)
    setSelectedTrainee(p.traineeId)
    setStarRank(p.starRank)
    setPotentialLevel(p.potentialLevel)
    setDeck(p.deck)
    setDeckLevels(p.deckLevels)
    setLegacy(normalizeLegacyTree(structuredClone(p.legacy)))
    setInitialState(p.initialState ? (p.initialState as CareerInitialState) : null)
  }, [])

  function buildPersistedPayload(): CareerSimulatorPersisted {
    return {
      scenario,
      traineeId: selectedTrainee,
      starRank,
      potentialLevel,
      deck,
      deckLevels,
      legacy,
      initialState,
    }
  }

  async function saveToCloudOverwrite() {
    if (!user) {
      navigate('/login', { state: { from: saveId ? `/career-simulator/run/${saveId}` : '/career-simulator' } })
      return
    }
    setCloudSaveBusy(true)
    setError(null)
    try {
      const payload = buildPersistedPayload()
      if (!activeCloudSave) {
        const entered = window.prompt('Name this run', 'Untitled')
        if (entered === null) return
        const name = entered.trim() || 'Untitled'
        const id = await insertCareerSimulatorSave(user.id, name, payload)
        setActiveCloudSave({ id, name })
        navigate(`/career-simulator/run/${id}`, { replace: true })
        return
      }
      await updateCareerSimulatorSave(activeCloudSave.id, activeCloudSave.name, payload)
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
    finally {
      setCloudSaveBusy(false)
    }
  }

  async function saveToCloudCopy() {
    if (!user) {
      navigate('/login', { state: { from: saveId ? `/career-simulator/run/${saveId}` : '/career-simulator' } })
      return
    }
    setCloudSaveBusy(true)
    setError(null)
    try {
      const payload = buildPersistedPayload()
      const suggest = activeCloudSave ? `${activeCloudSave.name} (copy)` : 'Untitled'
      const entered = window.prompt('Name for the new saved run', suggest)
      if (entered === null) return
      const name = entered.trim() || 'Untitled'
      const id = await insertCareerSimulatorSave(user.id, name, payload)
      setActiveCloudSave({ id, name })
      navigate(`/career-simulator/run/${id}`, { replace: true })
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
    finally {
      setCloudSaveBusy(false)
    }
  }

  // ─── Layout reset ─────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => { if (root) { root.style.maxWidth = ''; root.style.padding = '' } }
  }, [])

  // Restore draft from localStorage unless opening a cloud save URL (that load happens below).
  useLayoutEffect(() => {
    if (saveId && isCareerSimulatorSaveId(saveId)) {
      setPersistHydrated(true)
      return
    }
    const p = loadCareerSimulatorPersisted()
    if (p) hydrateFromPersisted(p)
    setPersistHydrated(true)
  }, [saveId, hydrateFromPersisted])

  useEffect(() => {
    if (!saveId || !isCareerSimulatorSaveId(saveId)) {
      setCloudLoading(false)
      setCloudLoadError(null)
      setActiveCloudSave(null)
      return
    }
    if (!user) {
      setCloudLoading(false)
      setCloudLoadError('Sign in to load this saved run.')
      setActiveCloudSave(null)
      return
    }
    if (activeCloudSave?.id === saveId) {
      setCloudLoading(false)
      setCloudLoadError(null)
      return
    }
    let cancelled = false
    setCloudLoading(true)
    setCloudLoadError(null)
    cloudFetchStartedAtRef.current = Date.now()
    const fetchT0 = cloudFetchStartedAtRef.current
    void (async () => {
      try {
        const row = await fetchCareerSimulatorSave(saveId)
        if (cancelled) return
        if (!row) {
          setCloudLoadError('This run could not be loaded (missing or no access).')
          setActiveCloudSave(null)
          setCloudLoading(false)
          return
        }
        const raw = row.payload as CareerSimulatorPersisted
        const merged: CareerSimulatorPersisted = {
          ...raw,
          initialState:
            lastComputeSuccessAtRef.current > fetchT0 && latestInitialStateRef.current != null
              ? latestInitialStateRef.current
              : raw.initialState,
        }
        hydrateFromPersisted(merged)
        setActiveCloudSave({ id: row.id, name: row.name })
        setCloudLoading(false)
      }
      catch (e) {
        if (!cancelled) {
          setCloudLoadError(e instanceof Error ? e.message : 'Failed to load run')
          setActiveCloudSave(null)
          setCloudLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [saveId, user, hydrateFromPersisted, activeCloudSave?.id])

  useEffect(() => {
    if (!persistHydrated) return
    saveCareerSimulatorPersisted({
      scenario,
      traineeId: selectedTrainee,
      starRank,
      potentialLevel,
      deck,
      deckLevels,
      legacy,
      initialState,
    })
  }, [persistHydrated, scenario, selectedTrainee, starRank, potentialLevel, deck, deckLevels, legacy, initialState])

  // ─── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [traineeRes, cardRes, aptRes, sceRes, raceRes, uniqueRes] = await Promise.all([
        supabase.from('trainees').select('id, name, name_jp, title, rarity, stat_growth, icon_path, image_path, released_jp, released_global, release_global_is_approximate, release_source').order('name'),
        supabase.from('support_cards').select('id, name, rarity, card_type, released_jp, released_global, release_global_is_approximate, release_source').order('name'),
        supabase.from('legacy_aptitudes').select('name').order('name'),
        supabase.from('legacy_scenarios').select('name').order('name'),
        supabase.from('races').select('id, name_en').order('name_en'),
        supabase
          .from('trainee_unique_skills')
          .select('trainee_id, skill_id, sort_order, min_star_rank, skills(id, name)'),
      ])
      if (traineeRes.data) setTrainees(traineeRes.data)
      if (cardRes.data) setCards(cardRes.data)
      if (aptRes.data?.length) setAptitudeNames(aptRes.data.map((r: { name: string }) => r.name))
      if (sceRes.data?.length) setScenarioNames(sceRes.data.map((r: { name: string }) => r.name))
      if (raceRes.data?.length) {
        setRaceOptions(raceRes.data.map((r: { id: number; name_en: string }) => ({
          id: Number(r.id),
          name_en: r.name_en,
        })))
      }

      type UniqueRow = {
        trainee_id: number
        skill_id: number
        sort_order: number
        min_star_rank: number
        skills: { id: number; name: string } | { id: number; name: string }[] | null
      }
      function skillNameFromJoin(s: UniqueRow['skills'], fallback: string): string {
        if (s == null) return fallback
        if (Array.isArray(s)) {
          const row = s[0]
          return row?.name ?? fallback
        }
        return s.name ?? fallback
      }
      const uniqueRows = [...((uniqueRes.data ?? []) as unknown as UniqueRow[])]
      uniqueRows.sort((a, b) =>
        a.trainee_id !== b.trainee_id ? a.trainee_id - b.trainee_id : a.sort_order - b.sort_order,
      )
      const byTrainee: Record<number, TraineeUniqueSkillOption[]> = {}
      const nameBatch: Record<number, string> = {}
      for (const r of uniqueRows) {
        const tid = r.trainee_id
        const sid = Number(r.skill_id)
        const name = skillNameFromJoin(r.skills, `Skill #${sid}`)
        if (!byTrainee[tid]) byTrainee[tid] = []
        byTrainee[tid].push({
          skill_id: sid,
          min_star_rank: Number(r.min_star_rank ?? 1),
          sort_order: r.sort_order,
          name,
        })
        nameBatch[sid] = name
      }
      setUniqueSkillOptionsByTraineeId(byTrainee)
      if (Object.keys(nameBatch).length > 0) {
        setSkillNameById(prev => ({ ...prev, ...nameBatch }))
      }

      void getGametoraUmamusumeManifest(supabase).catch(() => {
        /* optional warm-cache; failures are non-fatal */
      })
      const succ = await getSuccessionData(supabase)
      setSuccessionData(succ)

      if (user) {
        const [ownedRes, collRes] = await Promise.all([
          supabase.from('user_support_card_collection').select('card_id, level, uncap').eq('user_id', user.id),
          supabase.from('user_trainee_collection').select('trainee_id, star_rank, awakening_level').eq('user_id', user.id),
        ])
        if (ownedRes.data) {
          const map: Record<number, OwnedCardEntry> = {}
          for (const c of ownedRes.data) map[c.card_id] = { level: c.level, uncap: c.uncap }
          setOwnedCards(map)
        }
        if (collRes.data) {
          const map: Record<number, TraineeCollectionEntry> = {}
          for (const t of collRes.data) map[t.trainee_id] = { star_rank: t.star_rank, awakening_level: t.awakening_level }
          setTraineeCollection(map)
        }
      }
    }
    load()
  }, [user])

  // Auto-set star rank + potential level from collection when trainee changes
  useEffect(() => {
    if (selectedTrainee && traineeCollection[selectedTrainee]) {
      setStarRank(traineeCollection[selectedTrainee].star_rank)
      setPotentialLevel(traineeCollection[selectedTrainee].awakening_level)
    }
  }, [selectedTrainee, traineeCollection])

  // Clamp deck levels when card rarity changes (e.g. SSR 50 → SR must become ≤ 45).
  useEffect(() => {
    if (!cards.length) return
    setDeckLevels(prev => {
      let changed = false
      const next = prev.map((lv, i) => {
        const id = deck[i]
        if (id == null) return lv
        const c = cards.find(x => x.id === id)
        if (!c) return lv
        const clamped = clampSupportCardLevel(lv, c.rarity)
        if (clamped !== lv) changed = true
        return clamped
      })
      return changed ? next : prev
    })
  }, [deck, cards])

  // ─── Compute initial state ────────────────────────────────────────────────
  const computeInitialState = useCallback(async () => {
    if (!selectedTrainee) return
    const filledDeck = deck.filter((d): d is number => d !== null)
    if (filledDeck.length !== 6) {
      setError('Please select all 6 support cards')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const deckWithLevels: [number, number][] = filledDeck.map((cardId, i) => [cardId, deckLevels[i]])

      const legacyNormalized = normalizeLegacyTree(structuredClone(legacy))
      const succ = (await getSuccessionData(supabase)) ?? successionData
      const legacySparked = succ
        ? enrichLegacySparkAffinity(legacyNormalized, selectedTrainee, succ)
        : legacyNormalized
      const legacyForApi = stripLegacyTreeForApi(legacySparked)
      // Use pre-strip tree: `strip` removes `trainee_id`, so `legacyForApi` alone can falsely look "empty"
      // for portrait-linked members until name/factors sync, and `trainee_id` would never count.
      const hasLegacyConfig = legacyTreeHasConfiguration(legacySparked)

      const body = {
        scenario,
        trainee_id: selectedTrainee,
        star_rank: starRank,
        awakening_level: potentialLevel,
        deck: deckWithLevels,
        legacy: hasLegacyConfig ? { ...legacyForApi, affinity: API_LEGACY_AFFINITY } : null,
      }

      const res = await fetch(`${OPTIMIZER_URL}/api/career/init`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }

      const data: CareerInitialState = await res.json()
      lastComputeSuccessAtRef.current = Date.now()
      latestInitialStateRef.current = data
      setInitialState(data)

      if (user && activeCloudSave?.id && saveId && activeCloudSave.id === saveId) {
        const payload: CareerSimulatorPersisted = {
          scenario,
          traineeId: selectedTrainee,
          starRank,
          potentialLevel,
          deck,
          deckLevels,
          legacy,
          initialState: data,
        }
        void updateCareerSimulatorSave(activeCloudSave.id, activeCloudSave.name, payload).catch(err => {
          console.warn('CareerSimulator: auto-save after compute failed', err)
        })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to compute initial state')
    } finally {
      setLoading(false)
    }
  }, [selectedTrainee, deck, deckLevels, starRank, potentialLevel, scenario, legacy, successionData, user, activeCloudSave, saveId])

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const selectedTraineeObj = trainees.find(t => t.id === selectedTrainee)

  const filteredTrainees = trainees.filter(t =>
    t.name.toLowerCase().includes(traineeSearch.toLowerCase()) ||
    (t.name_jp && t.name_jp.includes(traineeSearch)) ||
    (t.title && t.title.toLowerCase().includes(traineeSearch.toLowerCase()))
  )

  const getFilteredCards = (slotIdx: number) => {
    const search = cardSearches[slotIdx].toLowerCase()
    const selectedIds = new Set(deck.filter((d, i) => d !== null && i !== slotIdx))
    return cards
      .filter(c => !selectedIds.has(c.id))
      .filter(c =>
        c.name.toLowerCase().includes(search) ||
        c.card_type.toLowerCase().includes(search) ||
        c.rarity.toLowerCase().includes(search)
      )
  }

  const updateDeckSlot = (idx: number, cardId: number | null) => {
    const next = [...deck]
    next[idx] = cardId
    setDeck(next)
    if (!cardId) return
    const cardMeta = cards.find(c => c.id === cardId)
    const rarity = cardMeta?.rarity ?? 'SSR'
    const lvls = [...deckLevels]
    if (ownedCards[cardId]) {
      lvls[idx] = clampSupportCardLevel(ownedCards[cardId].level, rarity)
    }
    else {
      const maxLv = supportCardMaxLevelByRarity(rarity)
      lvls[idx] = clampSupportCardLevel(lvls[idx] ?? maxLv, rarity)
    }
    setDeckLevels(lvls)
  }

  const patchMemberFactors = useCallback(
    (
      slotKey: 'legacy_1' | 'legacy_2',
      memberKey: 'parent' | 'grandparent_1' | 'grandparent_2',
      fn: (factors: Factor[]) => Factor[],
    ) => {
      setLegacy(prev => {
        const next = structuredClone(prev)
        next[slotKey][memberKey].factors = fn(next[slotKey][memberKey].factors)
        return next
      })
    },
    [],
  )

  const setLegacyMemberName = useCallback(
    (
      slotKey: 'legacy_1' | 'legacy_2',
      memberKey: 'parent' | 'grandparent_1' | 'grandparent_2',
      name: string,
    ) => {
      setLegacy(prev => {
        const next = structuredClone(prev)
        next[slotKey][memberKey].name = name
        return next
      })
    },
    [],
  )

  const cacheSkillNames = useCallback((entries: Record<number, string>) => {
    setSkillNameById(prev => ({ ...prev, ...entries }))
  }, [])

  const setLegacyMemberTrainee = useCallback(
    (slotKey: LegacySlotKey, memberKey: LegacyMemberKey, traineeId: number | null) => {
      setLegacy(prev => {
        const next = structuredClone(prev)
        const m = next[slotKey][memberKey]
        m.trainee_id = traineeId
        if (traineeId != null) {
          const t = trainees.find(x => x.id === traineeId)
          if (t) m.name = t.name
          const hasBlue = m.factors.some((f: Factor) => f.type === 'BlueStat')
          if (!hasBlue) {
            m.factors = normalizeMemberFactors([
              ...m.factors,
              { type: 'BlueStat', stat_index: 0, stars: 1 },
            ])
          }
        }
        return next
      })
    },
    [trainees],
  )

  // ─── Career Session Callbacks ──────────────────────────────────────────────

  /** Align viewed + previous snapshots with the timeline cursor (and fetch when index !== null). */
  /** Fetch the snapshot at a slider position (drives TraineeStatsPanel). */
  const syncSliderView = useCallback(
    async (sid: string, pos: number | null, initialSnap: TurnSnapshot | null) => {
      if (pos === null) {
        setSliderSnapshot(initialSnap)
        setSliderLoading(false)
        return
      }
      setSliderLoading(true)
      try {
        const resp = await getCareerState(sid, pos)
        setSliderSnapshot(resp.snapshot)
      } catch (e) {
        console.warn('Failed to fetch slider state:', e)
      } finally {
        setSliderLoading(false)
      }
    },
    [],
  )

  /** Fetch snapshot + previous at a selected entry (drives EntryDetailViewer). */
  const syncSelectedEntryView = useCallback(
    async (sid: string, entryIdx: number) => {
      try {
        const resp = await getCareerState(sid, entryIdx)
        setSelectedEntrySnapshot(resp.snapshot)
        setSelectedEntryPrevSnapshot(resp.previous_snapshot ?? null)
      } catch (e) {
        console.warn('Failed to fetch entry state:', e)
      }
    },
    [],
  )

  /** Start a new career session from the current config. */
  const startCareerSession = useCallback(async () => {
    if (!selectedTrainee || !initialState) return
    const filledDeck = deck.filter((d): d is number => d !== null)
    if (filledDeck.length !== 6) return

    setSessionStarting(true)
    setError(null)
    try {
      const deckWithLevels: [number, number][] = filledDeck.map((cardId, i) => [cardId, deckLevels[i]])
      const legacyNormalized = normalizeLegacyTree(structuredClone(legacy))
      const hasLegacyConfig = legacyTreeHasConfiguration(legacyNormalized)

      const resp = await createCareerSession({
        scenario,
        trainee_id: selectedTrainee,
        star_rank: starRank,
        awakening_level: potentialLevel,
        deck: deckWithLevels,
        legacy: hasLegacyConfig ? { ...stripLegacyTreeForApi(legacyNormalized), affinity: API_LEGACY_AFFINITY } : undefined,
      })

      setSessionId(resp.session_id)
      setSessionTotalTurns(resp.total_turns)
      setSessionCurrentTurn(0)
      setSessionComplete(false)
      setSessionInitialSnapshot(resp.initial_snapshot)

      // Spark + pre-populated pending turn slots
      setSessionHistory(resp.timeline)
      setSliderPosition(null)
      setSelectedEntry(null)
      setSelectedEntrySnapshot(null)
      setSelectedEntryPrevSnapshot(null)
      await syncSliderView(resp.session_id, null, resp.initial_snapshot)
      setTurnPreview(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start career session')
    } finally {
      setSessionStarting(false)
    }
  }, [selectedTrainee, initialState, deck, deckLevels, starRank, potentialLevel, scenario, legacy, syncSliderView, syncSelectedEntryView])

  /** Request a turn preview from the server. */
  const handleRequestPreview = useCallback(async (placements: number[]) => {
    if (!sessionId || sessionComplete) return
    setPreviewLoading(true)
    try {
      const preview = await previewTurn(sessionId, placements)
      setTurnPreview(preview)
    } catch (e) {
      console.warn('Preview failed:', e)
    } finally {
      setPreviewLoading(false)
    }
  }, [sessionId, sessionComplete])

  /** Submit a game event (Spark of Inspiration, New Year, etc.) */
  const handleSubmitEvent = useCallback(async (event: GameEvent) => {
    if (!sessionId) return
    setAdvanceSubmitting(true)
    try {
      await submitEvent(sessionId, event)
      const tl = await getTimeline(sessionId)
      setSessionHistory(tl)
      const last = tl.length - 1
      setSliderPosition(last)
      setSelectedEntry(last)
      await syncSliderView(sessionId, last, sessionInitialSnapshot)
      await syncSelectedEntryView(sessionId, last)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit event')
    } finally {
      setAdvanceSubmitting(false)
    }
  }, [sessionId, sessionInitialSnapshot, syncSliderView, syncSelectedEntryView])

  /** Submit a turn action. */
  const handleSubmitAction = useCallback(async (params: {
    action: TurnAction
    card_placements: number[]
    training_failed?: boolean
    rest_energy?: number
  }) => {
    if (!sessionId) return
    setAdvanceSubmitting(true)
    try {
      const resp = await advanceTurn(sessionId, params)

      setSessionCurrentTurn(resp.next_turn)
      setSessionComplete(resp.is_complete)

      const history = await getTimeline(sessionId)
      setSessionHistory(history)
      const last = history.length - 1
      setSliderPosition(last)
      setSelectedEntry(last)
      await syncSliderView(sessionId, last, sessionInitialSnapshot)
      await syncSelectedEntryView(sessionId, last)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to advance turn')
    } finally {
      setAdvanceSubmitting(false)
    }
  }, [sessionId, sessionInitialSnapshot, syncSliderView, syncSelectedEntryView])

  /** Slider changed — update the stats panel above the timeline (debounced fetch). */
  const handleSliderChange = useCallback((pos: number | null) => {
    if (!sessionId) return
    setSliderPosition(pos)
    if (sliderSyncTimerRef.current) clearTimeout(sliderSyncTimerRef.current)
    sliderSyncTimerRef.current = setTimeout(() => {
      void syncSliderView(sessionId, pos, sessionInitialSnapshot)
    }, 100)
  }, [sessionId, sessionInitialSnapshot, syncSliderView])

  /** Entry clicked — open/toggle the detail viewer below the timeline. */
  const handleEntrySelect = useCallback(async (index: number) => {
    if (!sessionId) return
    if (selectedEntry === index) {
      setSelectedEntry(null)
      setSelectedEntrySnapshot(null)
      setSelectedEntryPrevSnapshot(null)
      return
    }
    setSelectedEntry(index)
    await syncSelectedEntryView(sessionId, index)
  }, [sessionId, selectedEntry, syncSelectedEntryView])

  /** Card names for the turn action panel. */
  const sessionCardNames = useMemo(() => {
    if (!initialState) return ['', '', '', '', '', '']
    return initialState.card_info.map(c => c.name)
  }, [initialState])

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a0a',
      backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.15) 0%, transparent 50%)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Navbar */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        padding: '1rem 2rem',
        background: 'rgba(10, 10, 10, 0.7)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: '0.75rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/umamusume" style={{ textDecoration: 'none', color: '#a1a1aa', fontSize: '0.9rem' }}>← Back</Link>
          <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>Career Simulator</span>
          {activeCloudSave && (
            <span style={{
              fontSize: '0.75rem', fontWeight: 600, color: '#93c5fd',
              padding: '0.2rem 0.55rem', borderRadius: 8,
              background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.25)',
              maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={activeCloudSave.name}>
              {activeCloudSave.name}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.72rem' }}>
          <Link
            to="/career-simulator/saves"
            style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 600, padding: '0.25rem 0.4rem' }}
          >
            My saves
          </Link>
          <button
            type="button"
            disabled={cloudSaveBusy || cloudLoading}
            onClick={() => void saveToCloudOverwrite()}
            style={{
              padding: '0.25rem 0.55rem', borderRadius: 8, border: 'none', cursor: cloudSaveBusy || cloudLoading ? 'wait' : 'pointer',
              background: 'rgba(37, 99, 235, 0.45)', color: '#dbeafe', fontWeight: 700, fontSize: '0.72rem',
              opacity: cloudSaveBusy || cloudLoading ? 0.55 : 1,
            }}
          >
            {cloudSaveBusy ? 'Saving…' : 'Save to account'}
          </button>
          <button
            type="button"
            disabled={cloudSaveBusy || cloudLoading || !user}
            onClick={() => void saveToCloudCopy()}
            title={!user ? 'Log in to save' : 'Save a new copy'}
            style={{
              padding: '0.25rem 0.55rem', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(255,255,255,0.06)', color: '#e4e4e7', cursor: 'pointer', fontSize: '0.72rem',
              opacity: cloudSaveBusy || cloudLoading || !user ? 0.45 : 1,
            }}
          >
            Save as copy
          </button>
          <span style={{ color: '#52525b' }}>|</span>
          <span style={{ color: '#71717a' }} title="Not synced to your account">Local draft</span>
          <button
            type="button"
            disabled={cloudLoading}
            onClick={() => {
              clearCareerSimulatorPersisted()
              setScenario('ura_finals')
              setSelectedTrainee(null)
              setStarRank(5)
              setPotentialLevel(5)
              setDeck([null, null, null, null, null, null])
              setDeckLevels([50, 50, 50, 50, 50, 50])
              setLegacy(emptyLegacy())
              setInitialState(null)
              setError(null)
              setActiveCloudSave(null)
              navigate('/career-simulator', { replace: true })
            }}
            style={{
              padding: '0.25rem 0.55rem', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.05)', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.72rem',
            }}
          >
            Clear local draft
          </button>
        </div>
      </nav>

      {cloudLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#e4e4e7', fontWeight: 600,
        }}>
          Loading saved run…
        </div>
      )}

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '2rem' }}>
        {cloudLoadError && saveId && isCareerSimulatorSaveId(saveId) && !cloudLoading && (
          <div style={{
            marginBottom: '1rem', padding: '0.85rem 1rem', borderRadius: 14,
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.28)', color: '#fca5a5', fontSize: '0.85rem',
          }}>
            {cloudLoadError}{' '}
            <Link to="/login" style={{ color: '#93c5fd' }}>Log in</Link>
            {' · '}
            <Link to="/career-simulator/saves" style={{ color: '#93c5fd' }}>All saves</Link>
            {' · '}
            <Link to="/career-simulator" style={{ color: '#93c5fd' }}>New run</Link>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '2rem', alignItems: 'start' }}>

          {/* ── Left Panel: Configuration ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Scenario */}
            <Section title="Scenario">
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {SCENARIOS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setScenario(s.id)}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: scenario === s.id ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.05)',
                      color: scenario === s.id ? '#60a5fa' : '#a1a1aa', fontWeight: 600, fontSize: '0.85rem',
                      transition: 'all 0.15s',
                    }}
                  >{s.label}</button>
                ))}
              </div>
            </Section>

            {/* Trainee Selector */}
            <Section title="Trainee">
              <input
                type="text"
                placeholder="Search trainees..."
                value={traineeSearch}
                onChange={e => setTraineeSearch(e.target.value)}
                style={inputStyle}
              />
              {traineeSearch && (
                <div style={{ maxHeight: 300, overflow: 'auto', ...dropdownStyle }}>
                  {filteredTrainees.slice(0, 20).map(t => (
                    <div
                      key={t.id}
                      onClick={() => { setSelectedTrainee(t.id); setTraineeSearch('') }}
                      style={dropdownItemStyle}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{
                        width: 36, height: 48, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
                        background: 'rgba(255,255,255,0.05)',
                      }}>
                        <img
                          src={getArtUrl(t)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
                          onError={e => (e.currentTarget.style.display = 'none')}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t.name}</div>
                        {t.title && <div style={{ fontSize: '0.75rem', color: '#71717a' }}>{t.title}</div>}
                      </div>
                      <span style={{
                        marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 700,
                        color: RARITY_STYLE[t.rarity]?.color ?? '#fff',
                      }}>{'★'.repeat(t.rarity)}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedTraineeObj && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  borderRadius: 14, overflow: 'hidden',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                }}>
                  {/* Art: fixed width, clips the bottom slightly */}
                  <div style={{ width: 72, height: 88, flexShrink: 0, overflow: 'hidden' }}>
                    <img
                      src={getArtUrl(selectedTraineeObj)}
                      alt=""
                      style={{ width: '100%', height: '115%', objectFit: 'cover', objectPosition: 'top center' }}
                      onError={e => (e.currentTarget.style.display = 'none')}
                    />
                  </div>
                  {/* Name + title */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>{selectedTraineeObj.name}</div>
                    {selectedTraineeObj.title && (
                      <div style={{ fontSize: '0.78rem', color: '#a1a1aa', marginTop: '0.2rem' }}>{selectedTraineeObj.title}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedTrainee(null)}
                    style={{
                      background: 'none', border: 'none', color: '#71717a',
                      cursor: 'pointer', fontSize: '1.2rem', padding: '0 0.75rem', alignSelf: 'stretch',
                    }}
                  >×</button>
                </div>
              )}
              {/* Star Rank + Potential Level */}
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Star Rank:</span>
                  {[1, 2, 3, 4, 5].map(r => (
                    <button
                      key={r}
                      onClick={() => setStarRank(r)}
                      style={{
                        padding: '0.25rem 0.6rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: starRank === r ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.05)',
                        color: starRank === r ? '#fbbf24' : '#71717a', fontWeight: 700, fontSize: '0.85rem',
                      }}
                    >{r}★</button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>Potential:</span>
                {[1, 2, 3, 4, 5].map(p => (
                  <button
                    key={p}
                    onClick={() => setPotentialLevel(p)}
                    style={{
                      padding: '0.25rem 0.6rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: potentialLevel === p ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.05)',
                      color: potentialLevel === p ? '#34d399' : '#71717a', fontWeight: 700, fontSize: '0.85rem',
                    }}
                  >{p}</button>
                ))}
              </div>
            </Section>

            {/* Deck */}
            <Section title="Support Deck">
              {deck.map((cardId, idx) => {
                const card = cardId ? cards.find(c => c.id === cardId) : null
                const maxLv = card ? supportCardMaxLevelByRarity(card.rarity) : 50
                return (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#71717a', width: 16, textAlign: 'center' }}>{idx + 1}</span>
                    {card ? (
                      <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.4rem 0.6rem', borderRadius: 10,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                      }}>
                        <img
                          src={getCardIconUrl(card.id)}
                          alt=""
                          style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                          onError={e => (e.currentTarget.style.display = 'none')}
                        />
                        <img
                          src={getTypeIconUrl(card.card_type)}
                          alt=""
                          style={{ width: 16, height: 16, flexShrink: 0 }}
                          onError={e => (e.currentTarget.style.display = 'none')}
                        />
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.name}</span>
                        <label style={{ fontSize: '0.68rem', color: '#71717a', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                          Lv
                          <input
                            type="number"
                            min={1}
                            max={maxLv}
                            value={deckLevels[idx]}
                            onChange={e => {
                              const v = parseInt(e.target.value, 10)
                              if (Number.isNaN(v)) return
                              setDeckLevels(prev => {
                                const n = [...prev]
                                n[idx] = clampSupportCardLevel(v, card.rarity)
                                return n
                              })
                            }}
                            style={{
                              width: 44, padding: '0.2rem 0.35rem', borderRadius: 8,
                              background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
                              color: '#fff', fontSize: '0.78rem', fontWeight: 700,
                            }}
                          />
                          <span style={{ color: '#52525b', fontWeight: 600 }} title="Max at full limit break">/{maxLv}</span>
                        </label>
                        <button
                          onClick={() => updateDeckSlot(idx, null)}
                          style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', flexShrink: 0 }}
                        >×</button>
                      </div>
                    ) : (
                      <div style={{ flex: 1, position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Search cards..."
                          value={cardSearches[idx]}
                          onChange={e => {
                            const next = [...cardSearches]
                            next[idx] = e.target.value
                            setCardSearches(next)
                          }}
                          style={{ ...inputStyle, fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                        />
                        {cardSearches[idx] && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: 200, overflow: 'auto', ...dropdownStyle }}>
                            {getFilteredCards(idx).slice(0, 15).map(c => (
                              <div
                                key={c.id}
                                onClick={() => {
                                  updateDeckSlot(idx, c.id)
                                  const next = [...cardSearches]
                                  next[idx] = ''
                                  setCardSearches(next)
                                }}
                                style={dropdownItemStyle}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                <img
                                  src={getCardIconUrl(c.id)}
                                  alt=""
                                  style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
                                  onError={e => (e.currentTarget.style.display = 'none')}
                                />
                                <img
                                  src={getTypeIconUrl(c.card_type)}
                                  alt=""
                                  style={{ width: 14, height: 14, flexShrink: 0 }}
                                  onError={e => (e.currentTarget.style.display = 'none')}
                                />
                                <span style={{ fontSize: '0.8rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#71717a', flexShrink: 0 }}>{c.rarity}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </Section>

            <Section title="Legacy sparks">
              <div style={{
                marginBottom: '0.75rem', padding: '0.5rem 0.65rem', borderRadius: 10,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                fontSize: '0.72rem', color: '#a1a1aa', lineHeight: 1.45,
              }}>
                Succession affinity uses GameTora’s `succession_relation` masters: each character has many `relation_type` tags;
                shared tags with your runner (and for grandparents, with the slot parent too) add `relation_point` until we reach a
                total score, then we map that to △ / ○ / ◎ / ◎◎ for mid-run spark odds. Unlinked members fall back to ○ (
                {Math.round(0.25 * 100)}%), same as the global default.
                {!successionData && (
                  <span>
                    {' '}
                    <strong style={{ color: '#fca5a5' }}>No succession data loaded</strong>
                    {' '}
                    (manifest fetch failed or key mismatch)—everything will use the ○ fallback until data loads.
                  </span>
                )}
              </div>
              {(['legacy_1', 'legacy_2'] as const).map((slotKey, slotIdx) => (
                <div key={slotKey} style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a1a1aa', marginBottom: '0.5rem' }}>
                    Legacy {slotIdx + 1}
                  </div>
                  {(['parent', 'grandparent_1', 'grandparent_2'] as const).map(memberKey => (
                    <LegacyMemberPanel
                      key={memberKey}
                      slotKey={slotKey}
                      memberKey={memberKey}
                      member={legacy[slotKey][memberKey]}
                      runnerTraineeId={selectedTrainee}
                      slotParentTraineeId={legacy[slotKey].parent.trainee_id ?? null}
                      successionData={successionData}
                      uniqueSkillOptions={
                        legacy[slotKey][memberKey].trainee_id != null
                          ? uniqueSkillOptionsByTraineeId[legacy[slotKey][memberKey].trainee_id!]
                            ?? EMPTY_TRAINEE_UNIQUE_OPTIONS
                          : EMPTY_TRAINEE_UNIQUE_OPTIONS
                      }
                      trainees={trainees}
                      aptitudeNames={aptitudeNames}
                      scenarioNames={scenarioNames}
                      raceOptions={raceOptions}
                      skillNameById={skillNameById}
                      statNames={STAT_NAMES}
                      getArtUrl={getArtUrl}
                      inputStyle={inputStyle}
                      selectStyle={selectStyle}
                      dropdownStyle={dropdownStyle}
                      dropdownItemStyle={dropdownItemStyle}
                      patchMemberFactors={patchMemberFactors}
                      setLegacyMemberName={setLegacyMemberName}
                      setLegacyMemberTrainee={setLegacyMemberTrainee}
                      cacheSkillNames={cacheSkillNames}
                    />
                  ))}
                </div>
              ))}
            </Section>

            {/* Run Button */}
            <button
              onClick={computeInitialState}
              disabled={loading || !selectedTrainee || deck.some(d => d === null)}
              style={{
                padding: '1rem', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: loading ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #2563eb, #9333ea)',
                color: '#fff', fontWeight: 700, fontSize: '1rem',
                opacity: (!selectedTrainee || deck.some(d => d === null)) ? 0.4 : 1,
                transition: 'all 0.2s',
              }}
            >
              {loading ? 'Computing...' : 'Compute Initial State'}
            </button>

            {error && (
              <div style={{
                padding: '0.75rem', borderRadius: 10,
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#fca5a5', fontSize: '0.85rem',
              }}>{error}</div>
            )}
          </div>

          {/* ── Right Panel: Results ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {initialState && careerStartingDisplay ? (
              <>
                {/* Total Stats Summary */}
                <Section title="Starting Stats">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
                    {STAT_NAMES.map((name, i) => {
                      const value = [
                        careerStartingDisplay.stats.speed,
                        careerStartingDisplay.stats.stamina,
                        careerStartingDisplay.stats.power,
                        careerStartingDisplay.stats.guts,
                        careerStartingDisplay.stats.wisdom,
                      ][i]
                      return (
                        <div key={name} style={{
                          padding: '1rem', borderRadius: 14, textAlign: 'center',
                          background: `rgba(${hexToRgbStr(STAT_COLORS[i])}, 0.08)`,
                          border: `1px solid rgba(${hexToRgbStr(STAT_COLORS[i])}, 0.2)`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', marginBottom: '0.5rem' }}>
                            <img src={getStatIconUrl(STAT_KEYS[i])} alt="" style={{ width: 16, height: 16 }} onError={e => (e.currentTarget.style.display = 'none')} />
                            <span style={{ fontSize: '0.75rem', color: STAT_COLORS[i], fontWeight: 600 }}>{name}</span>
                          </div>
                          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff' }}>{Math.round(value)}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '0.75rem',
                    padding: '0.75rem', borderRadius: 10, background: 'rgba(255,255,255,0.03)',
                  }}>
                    <StatLabel label="Total" value={Math.round(
                      careerStartingDisplay.stats.speed
                      + careerStartingDisplay.stats.stamina
                      + careerStartingDisplay.stats.power
                      + careerStartingDisplay.stats.guts
                      + careerStartingDisplay.stats.wisdom,
                    )}
                    />
                    <StatLabel label="SP" value={initialState.sp} color="#c084fc" />
                    <StatLabel label="Energy" value={initialState.energy} color="#22d3ee" />
                    <StatLabel label="Mood" value={formatMood(initialState.mood)} />
                  </div>
                </Section>

                {/* Stat Breakdown */}
                <Section title="Stat Breakdown">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <th style={thStyle}>Source</th>
                        {STAT_NAMES.map((name, i) => (
                          <th key={name} style={{ ...thStyle, color: STAT_COLORS[i], textAlign: 'right' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <img src={getStatIconUrl(STAT_KEYS[i])} alt="" style={{ width: 14, height: 14 }} onError={e => (e.currentTarget.style.display = 'none')} />
                              {name}
                            </span>
                          </th>
                        ))}
                        <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <BreakdownRow label="Character Base" stats={initialState.base_stats} />
                      <BreakdownRow label="Inheritance (blue)" stats={careerStartingDisplay.inheritance} />
                      <BreakdownRow label="Total" stats={careerStartingDisplay.stats} bold />
                    </tbody>
                  </table>
                </Section>

                {/* Growth Rates */}
                <Section title="Growth Rates">
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {STAT_NAMES.map((name, i) => (
                      <div key={name} style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        padding: '0.4rem 0.8rem', borderRadius: 8,
                        background: 'rgba(255,255,255,0.05)',
                      }}>
                        <img src={getStatIconUrl(STAT_KEYS[i])} alt="" style={{ width: 16, height: 16 }} onError={e => (e.currentTarget.style.display = 'none')} />
                        <span style={{ fontSize: '0.8rem', color: STAT_COLORS[i], fontWeight: 600 }}>{name}</span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                          {initialState.growth_rates[i] > 0 ? `+${Math.round(initialState.growth_rates[i] * 100)}%` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>

                {/* Card Friendships */}
                <Section title="Starting Friendship">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                    {initialState.card_info.map((card, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.4rem 0.6rem', borderRadius: 10,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <img
                          src={getCardIconUrl(card.card_id)}
                          alt=""
                          style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
                          onError={e => (e.currentTarget.style.display = 'none')}
                        />
                        <img
                          src={getTypeIconUrl(card.card_type)}
                          alt=""
                          style={{ width: 14, height: 14, flexShrink: 0 }}
                          onError={e => (e.currentTarget.style.display = 'none')}
                        />
                        <span style={{ fontSize: '0.8rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {card.name}
                        </span>
                        <span style={{
                          fontSize: '0.8rem', fontWeight: 700, flexShrink: 0,
                          color: initialState.friendship[i] >= 80 ? '#34d399' : initialState.friendship[i] > 0 ? '#fbbf24' : '#71717a',
                        }}>
                          {initialState.friendship[i]}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>

                {/* ── Career Session: Start / Timeline / Actions ── */}
                {!sessionId ? (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      disabled={sessionStarting}
                      onClick={() => void startCareerSession()}
                      style={{
                        padding: '0.85rem 2.5rem', borderRadius: 14, border: 'none', cursor: 'pointer',
                        background: 'linear-gradient(135deg, rgba(96,165,250,0.35), rgba(52,211,153,0.25))',
                        color: '#e4e4e7', fontWeight: 800, fontSize: '1rem',
                        boxShadow: '0 4px 24px rgba(96,165,250,0.15)',
                        opacity: sessionStarting ? 0.6 : 1,
                        transition: 'all 0.2s',
                      }}
                    >
                      {sessionStarting ? 'Starting…' : 'Start Career'}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Zone 1: Full stats panel (slider-driven) */}
                    <TraineeStatsPanel
                      snapshot={sliderSnapshot}
                      traineeName={selectedTraineeObj?.name}
                      traineeTitle={selectedTraineeObj?.title ?? undefined}
                      traineeArtUrl={selectedTraineeObj ? getArtUrl(selectedTraineeObj) : undefined}
                      cardInfo={initialState?.card_info}
                      blueInheritance={
                        sliderPosition === null
                          ? (careerStartingDisplay?.inheritance ?? initialState?.inheritance_stats ?? null)
                          : null
                      }
                      isInitial={sliderPosition === null}
                      loading={sliderLoading}
                      skillNameById={skillNameById}
                      supabaseStorageUrl={SUPABASE_STORAGE}
                    />

                    {/* Zone 2: Timeline bar */}
                    <CareerTimeline
                      currentTurn={sessionCurrentTurn}
                      totalTurns={sessionTotalTurns}
                      timeline={sessionHistory}
                      sliderPosition={sliderPosition}
                      selectedEntry={selectedEntry}
                      onSliderChange={handleSliderChange}
                      onEntrySelect={handleEntrySelect}
                    />

                    {/* Zone 3: Entry detail viewer (click-driven) */}
                    {selectedEntry != null && sessionHistory[selectedEntry] && (
                      <EntryDetailViewer
                        key={`entry-${selectedEntry}`}
                        entry={sessionHistory[selectedEntry]}
                        snapshot={selectedEntrySnapshot}
                        previousSnapshot={selectedEntryPrevSnapshot}
                      />
                    )}

                    {/* Zone 4: Turn action — turns only (not timeline events like Spark); or career finished. */}
                    {((selectedEntry != null &&
                      sessionHistory[selectedEntry] &&
                      sessionHistory[selectedEntry].kind === 'turn') ||
                      sessionComplete) && (
                      <TurnActionPanel
                        cardNames={sessionCardNames}
                        preview={turnPreview}
                        previewLoading={previewLoading}
                        onRequestPreview={handleRequestPreview}
                        onSubmitEvent={handleSubmitEvent}
                        onSubmitAction={handleSubmitAction}
                        submitting={advanceSubmitting}
                        isComplete={sessionComplete}
                      />
                    )}
                  </>
                )}
              </>
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: 400, borderRadius: 20,
                background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
              }}>
                <div style={{ textAlign: 'center', color: '#71717a' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🎮</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Configure your career</div>
                  <div style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                    Select a trainee, build your deck, and set up legacy factors to compute the starting state.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '1.25rem', borderRadius: 16,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 700, color: '#e4e4e7' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {children}
      </div>
    </div>
  )
}

function StatLabel({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '0.7rem', color: '#71717a', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: color ?? '#fff' }}>{value}</div>
    </div>
  )
}

function BreakdownRow({ label, stats, bold }: { label: string; stats: StatBlock; bold?: boolean }) {
  const values = [stats.speed, stats.stamina, stats.power, stats.guts, stats.wisdom].map(v => Math.round(Number(v)))
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <tr style={{ borderBottom: bold ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
      <td style={{ padding: '0.5rem 0.75rem', fontWeight: bold ? 700 : 400, color: bold ? '#fff' : '#a1a1aa' }}>{label}</td>
      {values.map((rv, i) => (
        <td key={i} style={{
          padding: '0.5rem 0.75rem', textAlign: 'right',
          fontWeight: bold ? 700 : 400,
          color: rv > 0 ? (bold ? '#fff' : STAT_COLORS[i]) : '#3f3f46',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {rv > 0 ? (bold ? rv : `+${rv}`) : '—'}
        </td>
      ))}
      <td style={{
        padding: '0.5rem 0.75rem', textAlign: 'right',
        fontWeight: 700, color: bold ? '#fff' : '#a1a1aa',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {total > 0 ? total : '—'}
      </td>
    </tr>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', outline: 'none', fontSize: '0.9rem', boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem', borderRadius: 10,
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', outline: 'none', fontSize: '0.78rem', boxSizing: 'border-box',
}

const dropdownStyle: React.CSSProperties = {
  background: '#1a1a1a', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.5rem',
  padding: '0.5rem 0.75rem', cursor: 'pointer', transition: 'background 0.1s',
}

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, fontSize: '0.8rem', color: '#71717a',
}

// ─── Utility ────────────────────────────────────────────────────────────────

function formatMood(mood: string): string {
  const map: Record<string, string> = {
    very_good: 'Very Good',
    good: 'Good',
    normal: 'Normal',
    bad: 'Bad',
    very_bad: 'Very Bad',
  }
  return map[mood] ?? mood
}

function hexToRgbStr(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '0, 0, 0'
}
