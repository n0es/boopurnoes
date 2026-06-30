import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { uma } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { CatalogShell, CatalogHeader, CatalogCollectionControls, RegionFilter } from '../components/catalog'
import {
  passesRegionAvailabilityFilter,
  todayIsoDateLocal,
  type ReleaseMetadata,
} from '../lib/releaseMetadata'
import { useRegionSearchParam } from '../lib/useRegionSearchParam'
import { isMissingTableError } from '../lib/supabaseErrors'
import { DeckPreviewCard, plannedDisplayLevel } from '../components/DeckPreviewCard'
import { SUPPORT_CARD_EFFECT_META } from '../lib/supportCardEffectMeta'
import {
  defaultDeckConstraintState,
  loadDeckBuilderConstraints,
  saveDeckBuilderConstraints,
  type DeckConstraintRow,
} from '../lib/deckBuilderConstraintsStorage'
import {
  SCENARIOS,
  recommendedConstraints,
  type ScenarioSlug,
  type TraineeProfile,
} from '../lib/deckBuilderRecommendedTargets'
import type { SupportCardEffectRow } from '../lib/deckBuilderStats'
import {
  DEFAULT_MAX_DECK_SUGGESTIONS,
  type OwnedDeckEntry,
  type SolveDeckResult,
  type StatConstraint,
  type DeckSolution,
} from '../lib/deckBuilderSolver'
import { maxLevelForUncap } from '../lib/supportCardLevel'
import { binomialChoose5 } from '../../shared/deckSolverCore'
import { runDeckSolveInWorker } from '../lib/deckSolverRun'
import { UmaTrainerLookup } from '../components/UmaTrainerLookup'
import { DeckBuilderForcedSlots, type DeckBuilderForcedSlot } from '../components/DeckBuilderForcedSlots'
import { clampFriendTrainLevel, clampOwnedTrainLevel } from '../lib/deckBuilderStats'

const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`

/** Linear extrapolation from five-card combo throughput; inner-loop cost varies per combo. */
function estimateRemainingMsFromComboProgress(
  comboIdx: number,
  totalCombos: number,
  elapsedMs: number,
): number | null {
  if (totalCombos <= 0 || !Number.isFinite(totalCombos)) return null
  if (comboIdx <= 0 || elapsedMs < 250) return null
  const minCombos = Math.min(128, Math.max(12, Math.floor(totalCombos * 0.003)))
  if (comboIdx < minCombos && elapsedMs < 5000) return null
  const remaining = totalCombos - comboIdx
  if (remaining <= 0) return 0
  const rate = comboIdx / elapsedMs
  if (rate <= 0) return null
  const ms = remaining / rate
  if (!Number.isFinite(ms)) return null
  return Math.min(ms, 48 * 60 * 60 * 1000)
}

function formatRemainingShort(ms: number): string {
  if (ms < 15_000) return `~${Math.max(1, Math.round(ms / 1000))} s`
  if (ms < 3600_000) {
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return `~${m}m ${s}s`
  }
  const h = Math.floor(ms / 3600_000)
  const m = Math.round((ms % 3600_000) / 60_000)
  return `~${h}h ${m}m`
}

function artUrl(id: number) {
  return `${SUPABASE_STORAGE}/supports/art/${id}.png`
}
interface CatalogCard extends ReleaseMetadata {
  id: number
  name: string
  rarity: string
  card_type: string
}

function formatEffectValue(effectTypeId: number, raw: number): string {
  const sym = SUPPORT_CARD_EFFECT_META[effectTypeId]?.symbol ?? 'none'
  if (sym === 'percent') return `${raw}%`
  if (sym === 'level') return `Lv ${raw}`
  return String(raw)
}

async function fetchEffectsChunked(cardIds: number[]): Promise<Map<number, SupportCardEffectRow[]>> {
  const map = new Map<number, SupportCardEffectRow[]>()
  const chunk = 100
  for (let i = 0; i < cardIds.length; i += chunk) {
    const slice = cardIds.slice(i, i + chunk)
    const { data, error } = await uma
      .from('support_card_effects')
      .select('card_id, effect_type_id, effect_name, unlock_level, values_by_level')
      .in('card_id', slice)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      const r = row as SupportCardEffectRow & { card_id: number }
      const id = r.card_id
      if (!map.has(id)) map.set(id, [])
      map.get(id)!.push(r)
    }
  }
  return map
}

const EFFECT_TYPE_IDS_SORTED = Object.keys(SUPPORT_CARD_EFFECT_META)
  .map(Number)
  .sort((a, b) => a - b)

const CONSTRAINT_INPUT_STYLE: CSSProperties = {
  width: 50,
  minWidth: 50,
  boxSizing: 'border-box',
  background: '#1a1a22',
  border: '1px solid #2a2a38',
  borderRadius: 4,
  padding: '2px 4px',
  color: '#fff',
  fontSize: 11,
}

/** Upper bound sent to the solver when the UI does not ask for a max (effectively “no ceiling”). */
const CONSTRAINT_MAX_TOTAL = 999_999

/** When not using the user’s collection, all six slots assume max uncap like the borrowed card. */
const CATALOG_POOL_UNCAP = 4

const USE_COLLECTION_KEY = 'boopurnoes:deckBuilderUseCollection:v1'
/** @deprecated migrated to USE_COLLECTION_KEY */
const LEGACY_DECK_MODE_KEY = 'boopurnoes:deckBuilderMode:v1'

const RARITY_FILTER_KEY = 'boopurnoes:deckBuilderRarityFilter:v1'

type DeckBuilderRarityFilter = { SSR: boolean; SR: boolean; R: boolean }

const DEFAULT_RARITY_FILTER: DeckBuilderRarityFilter = { SSR: true, SR: true, R: false }

function loadRarityFilter(): DeckBuilderRarityFilter {
  if (typeof localStorage === 'undefined') return DEFAULT_RARITY_FILTER
  try {
    const raw = localStorage.getItem(RARITY_FILTER_KEY)
    if (!raw) return DEFAULT_RARITY_FILTER
    const o = JSON.parse(raw) as Partial<DeckBuilderRarityFilter>
    return {
      SSR: o.SSR !== false,
      SR: o.SR !== false,
      /** Off unless explicitly saved true (default is R excluded). */
      R: o.R === true,
    }
  } catch {
    return DEFAULT_RARITY_FILTER
  }
}

function saveRarityFilter(f: DeckBuilderRarityFilter): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(RARITY_FILTER_KEY, JSON.stringify(f))
  } catch {
    /* ignore */
  }
}

/** True if the card is included given SSR/SR/R toggles; unknown rarities stay included. */
function passesDeckRarityFilter(rarity: string, f: DeckBuilderRarityFilter): boolean {
  if (rarity === 'SSR' || rarity === 'SR' || rarity === 'R') return f[rarity]
  return true
}

function loadUseCollection(): boolean {
  if (typeof localStorage === 'undefined') return true
  const v = localStorage.getItem(USE_COLLECTION_KEY)
  if (v === '0' || v === 'false') return false
  if (v === '1' || v === 'true') return true
  const legacy = localStorage.getItem(LEGACY_DECK_MODE_KEY)
  if (legacy === 'theorycraft') return false
  return true
}

function saveUseCollection(on: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(USE_COLLECTION_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export default function DeckBuilder() {
  const { user, loading: authLoading } = useAuth()
  const { region, setRegion } = useRegionSearchParam()
  const todayIso = todayIsoDateLocal()

  const [cards, setCards] = useState<CatalogCard[]>([])
  const [effectsByCard, setEffectsByCard] = useState<Map<number, SupportCardEffectRow[]>>(new Map())
  const [collectionMap, setCollectionMap] = useState<Map<number, { level: number; uncap: number }>>(new Map())
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  const [constraints, setConstraints] = useState<Record<number, DeckConstraintRow>>(loadDeckBuilderConstraints)

  useEffect(() => {
    saveDeckBuilderConstraints(constraints)
  }, [constraints])

  const resetConstraints = useCallback(() => {
    const fresh = defaultDeckConstraintState()
    setConstraints(fresh)
    saveDeckBuilderConstraints(fresh)
  }, [])
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState<
    null | { source: 'worker'; comboIdx: number; totalCombos: number; iterations: number }
  >(null)
  /** Wall time when the browser worker started; used for ETA. */
  const [workerSearchStartedAt, setWorkerSearchStartedAt] = useState<number | null>(null)
  const [etaTick, setEtaTick] = useState(0)
  const searchAbortRef = useRef<AbortController | null>(null)
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  /** Non-null when the last successful search required relaxing the original targets. */
  const [relaxationPct, setRelaxationPct] = useState<number | null>(null)
  const [solveResult, setSolveResult] = useState<SolveDeckResult | null>(null)
  const [maxSuggestions, setMaxSuggestions] = useState(DEFAULT_MAX_DECK_SUGGESTIONS)
  const [sortMode, setSortMode] = useState<'stats' | 'upgrades'>('stats')
  const [useCollection, setUseCollection] = useState(loadUseCollection)

  useEffect(() => {
    saveUseCollection(useCollection)
  }, [useCollection])

  const [rarityFilter, setRarityFilter] = useState<DeckBuilderRarityFilter>(loadRarityFilter)

  useEffect(() => {
    saveRarityFilter(rarityFilter)
  }, [rarityFilter])

  // ── Auto-target state: trainee + scenario → recommended constraints ──
  const [traineeQuery, setTraineeQuery] = useState('')
  const [traineeResults, setTraineeResults] = useState<
    { id: number; name: string; title: string | null; stat_growth: number[] | null;
      apt_short: string | null; apt_mile: string | null; apt_mid: string | null; apt_long: string | null;
      apt_leading: string | null; apt_stalking: string | null; apt_mid_pack: string | null; apt_chasing: string | null;
    }[]
  >([])
  const [selectedTrainee, setSelectedTrainee] = useState<TraineeProfile & { id: number; name: string; title: string | null } | null>(null)
  const [selectedScenario, setSelectedScenario] = useState<ScenarioSlug | ''>('')
  const [traineeDropdownOpen, setTraineeDropdownOpen] = useState(false)
  const traineePickerRef = useRef<HTMLDivElement>(null)

  // Search trainees on query change
  useEffect(() => {
    if (traineeQuery.length < 2) { setTraineeResults([]); return }
    let cancelled = false
    const term = `%${traineeQuery}%`
    uma
      .from('trainees')
      .select('id, name, title, stat_growth, apt_short, apt_mile, apt_mid, apt_long, apt_leading, apt_stalking, apt_mid_pack, apt_chasing')
      .or(`name.ilike.${term},name_jp.ilike.${term},title.ilike.${term}`)
      .order('name')
      .limit(12)
      .then(({ data }) => {
        if (!cancelled && data) setTraineeResults(data as typeof traineeResults)
      })
    return () => { cancelled = true }
  }, [traineeQuery])

  // Close trainee dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (traineePickerRef.current && !traineePickerRef.current.contains(e.target as Node)) {
        setTraineeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-fill constraints when both trainee and scenario are selected
  const applyRecommendedTargets = useCallback(() => {
    if (!selectedTrainee || !selectedScenario) return
    const rec = recommendedConstraints(selectedTrainee, selectedScenario)
    setConstraints(rec)
    saveDeckBuilderConstraints(rec)
  }, [selectedTrainee, selectedScenario])

  const searchFromCollection = Boolean(user) && useCollection

  useEffect(() => {
    setSolveResult(null)
    setSearchMessage(null)
  }, [searchFromCollection])

  useEffect(() => {
    if (!searching || searchProgress?.source !== 'worker' || workerSearchStartedAt == null) return
    const id = window.setInterval(() => setEtaTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [searching, searchProgress?.source, workerSearchStartedAt])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setDataLoading(true)
      setDataError(null)
      try {
        const { data: cardRows, error: cErr } = await uma
          .from('support_cards')
          .select('id, name, rarity, card_type, released_jp, released_global, release_global_is_approximate, release_source')
          .order('id', { ascending: true })
        if (cErr) throw new Error(cErr.message)
        if (cancelled) return
        setCards((cardRows ?? []) as CatalogCard[])

        const ids = (cardRows ?? []).map(c => c.id)
        const fx = await fetchEffectsChunked(ids)
        if (cancelled) return
        setEffectsByCard(fx)

        if (user) {
          const { data: col, error: colErr } = await uma
            .from('user_support_card_collection')
            .select('card_id, level, uncap')
            .eq('user_id', user.id)
          if (colErr) {
            if (!isMissingTableError(colErr)) console.warn('collection:', colErr.message)
            setCollectionMap(new Map())
          } else {
            const m = new Map<number, { level: number; uncap: number }>()
            for (const r of col ?? []) {
              const row = r as { card_id: number; level: number; uncap: number }
              m.set(row.card_id, { level: row.level, uncap: row.uncap })
            }
            setCollectionMap(m)
          }
        } else {
          setCollectionMap(new Map())
        }
      } catch (e) {
        if (!cancelled) setDataError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setDataLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [user])

  const eligibleCards = useMemo(() => {
    return cards.filter(c =>
      passesRegionAvailabilityFilter(region, c.released_jp, c.released_global, todayIso),
    )
  }, [cards, region, todayIso])

  const deckPoolCards = useMemo(
    () => eligibleCards.filter(c => passesDeckRarityFilter(c.rarity, rarityFilter)),
    [eligibleCards, rarityFilter],
  )

  const ownedInRegion = useMemo(() => {
    const eligibleId = new Set(deckPoolCards.map(c => c.id))
    const out: { card: CatalogCard; level: number; uncap: number }[] = []
    for (const [cardId, lv] of collectionMap) {
      if (!eligibleId.has(cardId)) continue
      const card = deckPoolCards.find(c => c.id === cardId)
      if (!card) continue
      out.push({ card, level: lv.level, uncap: lv.uncap })
    }
    return out.sort((a, b) => a.card.name.localeCompare(b.card.name))
  }, [collectionMap, deckPoolCards])

  const [forcedSlots, setForcedSlots] = useState<DeckBuilderForcedSlot[]>([
    null,
    null,
    null,
    null,
    null,
    null,
  ])

  const cardIdToOwned = useMemo(() => {
    const m = new Map<number, { card: CatalogCard; level: number; uncap: number }>()
    for (const o of ownedInRegion) m.set(o.card.id, o)
    return m
  }, [ownedInRegion])

  const pickableForSlot = useCallback(
    (slotIndex: number) => {
      const pool: CatalogCard[] = user ? ownedInRegion.map(o => o.card) : deckPoolCards
      return pool.map(c => {
        const owned = cardIdToOwned.get(c.id)
        if (owned && user) {
          return {
            id: c.id,
            name: c.name,
            rarity: c.rarity,
            card_type: c.card_type,
            displayLevel: plannedDisplayLevel(c.rarity, owned.uncap, slotIndex === 5),
            wildcardPreview: slotIndex === 5,
          }
        }
        return {
          id: c.id,
          name: c.name,
          rarity: c.rarity,
          card_type: c.card_type,
          displayLevel: plannedDisplayLevel(c.rarity, 0, slotIndex === 5),
          wildcardPreview: slotIndex === 5,
        }
      })
    },
    [user, deckPoolCards, ownedInRegion, cardIdToOwned],
  )

  /** Fixed slots plan at full limit break (4) so level can go up to the game max for that rarity. */
  const getSlotPreview = useCallback(
    (slotIndex: number) => {
      const slot = forcedSlots[slotIndex]
      if (!slot) return undefined
      const c = deckPoolCards.find(x => x.id === slot.cardId)
      if (!c) return undefined
      const maxLv = maxLevelForUncap(CATALOG_POOL_UNCAP, c.rarity)
      const lv = Math.max(1, Math.min(slot.level, maxLv))
      return {
        id: c.id,
        name: c.name,
        rarity: c.rarity,
        card_type: c.card_type,
        displayLevel: lv,
        wildcardPreview: slotIndex === 5,
      }
    },
    [forcedSlots, deckPoolCards],
  )

  const defaultTrainLevel = useCallback(
    (cardId: number, _slotIndex: number) => {
      const c = deckPoolCards.find(x => x.id === cardId)
      if (!c) return 1
      return maxLevelForUncap(CATALOG_POOL_UNCAP, c.rarity)
    },
    [deckPoolCards],
  )

  const maxTrainLevelForSlot = useCallback(
    (slotIndex: number) => {
      const slot = forcedSlots[slotIndex]
      if (!slot) return 50
      const c = deckPoolCards.find(x => x.id === slot.cardId)
      if (!c) return 50
      return maxLevelForUncap(CATALOG_POOL_UNCAP, c.rarity)
    },
    [forcedSlots, deckPoolCards],
  )

  const runSearch = useCallback(() => {
    setSearchMessage(null)
    setSolveResult(null)

    const parsed: StatConstraint[] = []
    for (const [idStr, row] of Object.entries(constraints)) {
      if (!row.enabled) continue
      const effectTypeId = Number(idStr)
      const min = Number(row.minStr)
      if (!Number.isFinite(min)) continue
      parsed.push({ effectTypeId, min, max: CONSTRAINT_MAX_TOTAL })
    }
    if (parsed.length === 0) {
      setSearchMessage('Enable at least one bonus and set a valid minimum for it.')
      return
    }

    if (!searchFromCollection) {
      if (deckPoolCards.length < 5) {
        setSearchMessage(
          'Need at least five support cards in the current pool (check region, SSR/SR/R filters, and header).',
        )
        return
      }
    } else if (ownedInRegion.length < 5) {
      setSearchMessage('Need at least five support cards in your collection that are legal on this server.')
      return
    }

    const ownedEntries: OwnedDeckEntry[] = searchFromCollection
      ? ownedInRegion.map(o => ({
          cardId: o.card.id,
          name: o.card.name,
          rarity: o.card.rarity,
          card_type: o.card.card_type,
          level: o.level,
          uncap: o.uncap,
          effects: effectsByCard.get(o.card.id) ?? [],
        }))
      : deckPoolCards.map(c => ({
          cardId: c.id,
          name: c.name,
          rarity: c.rarity,
          card_type: c.card_type,
          level: maxLevelForUncap(CATALOG_POOL_UNCAP, c.rarity),
          uncap: CATALOG_POOL_UNCAP,
          effects: effectsByCard.get(c.id) ?? [],
        }))

    const wildcardPool = deckPoolCards.map(c => ({
      cardId: c.id,
      name: c.name,
      rarity: c.rarity,
      card_type: c.card_type,
      effects: effectsByCard.get(c.id) ?? [],
    }))

    const forcedAllIds = forcedSlots.map(s => s?.cardId).filter((x): x is number => x != null)
    if (new Set(forcedAllIds).size !== forcedAllIds.length) {
      setSearchMessage('Fixed slots cannot repeat the same card.')
      return
    }
    const forcedOwnedIds = [0, 1, 2, 3, 4].map(i => forcedSlots[i]?.cardId).filter((x): x is number => x != null)
    for (const id of forcedOwnedIds) {
      if (!ownedEntries.some(o => o.cardId === id)) {
        setSearchMessage(
          'A fixed card is not in the current search pool. Clear fixed slots or change region / My Collection.',
        )
        return
      }
    }
    const friendForcedId = forcedSlots[5]?.cardId
    if (friendForcedId != null) {
      if (!wildcardPool.some(w => w.cardId === friendForcedId)) {
        setSearchMessage('Fixed friend card is not in the borrow pool for this search.')
        return
      }
    }

    const ownedEntriesWithForced: OwnedDeckEntry[] = ownedEntries.map(o => {
      for (let i = 0; i < 5; i++) {
        const fs = forcedSlots[i]
        if (fs && fs.cardId === o.cardId) {
          const lv = clampOwnedTrainLevel(fs.level, CATALOG_POOL_UNCAP, o.rarity)
          return {
            ...o,
            uncap: CATALOG_POOL_UNCAP,
            statTrainLevel: fs.level,
            level: lv,
          }
        }
      }
      return o
    })

    const wildcardPoolWithForced = wildcardPool.map(w => {
      const fs = forcedSlots[5]
      if (fs && fs.cardId === w.cardId) {
        return { ...w, statTrainLevel: fs.level }
      }
      return w
    })

    setSearching(true)
    setRelaxationPct(null)
    setWorkerSearchStartedAt(null)
    setSearchProgress({
      source: 'worker',
      comboIdx: 0,
      totalCombos: binomialChoose5(ownedEntriesWithForced.length),
      iterations: 0,
    })
    const abort = new AbortController()
    searchAbortRef.current = abort

    // Build relaxation tiers: each round scales every min by 0.75 (cumulative).
    // The solver tries all tiers in a single worker pass — no re-spawning.
    const RELAX_FACTOR = 0.75
    const MAX_RELAX_ROUNDS = 3
    const relaxationTiers: StatConstraint[][] = []
    let scaledConstraints = parsed
    for (let r = 0; r < MAX_RELAX_ROUNDS; r++) {
      scaledConstraints = scaledConstraints.map(c => ({
        ...c,
        min: Math.floor(c.min * RELAX_FACTOR),
      }))
      relaxationTiers.push(scaledConstraints)
    }

    void (async () => {
      try {
        const args = {
          owned: ownedEntriesWithForced,
          wildcardPool: wildcardPoolWithForced,
          constraints: parsed,
          relaxationTiers,
          maxSolutions: maxSuggestions,
          ...(forcedOwnedIds.length > 0 ? { forcedOwnedCardIds: forcedOwnedIds } : {}),
          ...(friendForcedId != null ? { forcedWildcardCardId: friendForcedId } : {}),
        }
        const t0 = Date.now()
        setWorkerSearchStartedAt(t0)
        const res = await runDeckSolveInWorker(args, {
          signal: abort.signal,
          onProgress: p => setSearchProgress({ source: 'worker', ...p }),
        })
        setSolveResult(res)

        if (res.capped) {
          setSearchMessage(
            'Search timed out before finishing the full search (5 minute limit). Results may be partial; loosen targets or try again.',
          )
        } else if (res.solutions.length === 0) {
          setSearchMessage('No deck found even after relaxing targets. Try changing server filter, rarity, or fixed slots.')
        } else if (res.relaxTierUsed > 0) {
          // Solver found results using a relaxed tier — update displayed constraints
          const factor = Math.pow(RELAX_FACTOR, res.relaxTierUsed)
          const pct = Math.round((1 - factor) * 100)
          const relaxed: Record<number, DeckConstraintRow> = { ...constraints }
          const usedTier = relaxationTiers[res.relaxTierUsed - 1]!
          for (const c of usedTier) {
            relaxed[c.effectTypeId] = { enabled: true, minStr: String(Math.floor(c.min)) }
          }
          setConstraints(relaxed)
          saveDeckBuilderConstraints(relaxed)
          setRelaxationPct(pct)
          setSearchMessage(
            `Targets relaxed by ${pct}% to find results. Constraints have been updated — tweak as needed.`,
          )
        }
      } catch (e) {
        const aborted =
          (e instanceof DOMException && e.name === 'AbortError') ||
          (e instanceof Error && e.name === 'AbortError')
        if (aborted) {
          setSolveResult(null)
          setSearchMessage('Search cancelled.')
        } else {
          setSearchMessage(e instanceof Error ? e.message : 'Search failed.')
        }
      } finally {
        searchAbortRef.current = null
        setSearching(false)
        setSearchProgress(null)
        setWorkerSearchStartedAt(null)
      }
    })()
  }, [
    searchFromCollection,
    constraints,
    ownedInRegion,
    deckPoolCards,
    effectsByCard,
    maxSuggestions,
    forcedSlots,
  ])

  const cancelSearch = useCallback(() => {
    searchAbortRef.current?.abort()
  }, [])

  /** Must encode which card is the wildcard; sorting all six ids collides when the same six cards swap owned vs borrowed. */
  function deckSuggestionKey(s: DeckSolution) {
    const ownedSorted = [...s.owned.map(o => o.cardId)].sort((a, b) => a - b)
    return `w${s.wildcard.cardId}-${ownedSorted.join('-')}`
  }

  const displayedSolutions = useMemo(() => {
    const list = solveResult?.solutions ?? []
    if (list.length === 0) return []
    const copy = [...list]
    if (sortMode === 'stats') {
      copy.sort((a, b) => b.rankScore - a.rankScore)
    } else {
      copy.sort(
        (a, b) =>
          a.upgradeHints.length - b.upgradeHints.length || b.rankScore - a.rankScore,
      )
    }
    return copy
  }, [solveResult, sortMode])

  const deckSearchEta = useMemo(() => {
    if (searchProgress?.source !== 'worker' || workerSearchStartedAt == null) return null
    const elapsed = Date.now() - workerSearchStartedAt
    const remaining = estimateRemainingMsFromComboProgress(
      searchProgress.comboIdx,
      searchProgress.totalCombos,
      elapsed,
    )
    return { remaining }
  }, [searchProgress, workerSearchStartedAt, etaTick])

  return (
    <CatalogShell>
      <CatalogHeader title="Deck Builder">
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          <RegionFilter value={region} onChange={setRegion} />
          <CatalogCollectionControls
            collectionMode={searchFromCollection}
            onToggleCollection={() => {
              if (user && !authLoading) setUseCollection(c => !c)
            }}
            unownedMode={false}
            onToggleUnowned={() => {}}
            hideUnowned
            myCollectionDisabled={!user || authLoading}
            myCollectionTitle={!user ? 'Sign in to search using cards you own' : undefined}
          />
        </div>
      </CatalogHeader>

      <div
        style={{
          padding: '8px 16px 10px',
          borderBottom: '1px solid #1a1a1a',
          maxWidth: 1100,
        }}
      >
        <p style={{ margin: '0 0 10px', fontSize: 11, color: '#52525b', maxWidth: 720, lineHeight: 1.45 }}>
          {searchFromCollection
            ? 'Five from your collection and one borrowed card — uses your levels and uncaps.'
            : 'Search the regional card pool: five slots plus one friend, all at max unlock. Sign in and enable My Collection to use owned cards.'}
        </p>

        <details style={{ marginBottom: 0 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 13,
              color: '#a3a3a3',
            }}
          >
            <span style={{ color: '#e5e5e5', fontWeight: 600 }}>How it works</span>
            <span style={{ marginLeft: 8, color: '#6b7280' }}>— six cards, constraints, ranking</span>
          </summary>
          {searchFromCollection ? (
            <p style={{ margin: '10px 0 0', fontSize: 13, color: '#9ca3af', lineHeight: 1.55 }}>
              Build a six-card support deck: <strong style={{ color: '#e5e5e5' }}>five from your collection</strong> and{' '}
              <strong style={{ color: '#e5e5e5' }}>one wildcard</strong> (any card legal for the server in the header).{' '}
              <strong style={{ color: '#9ca3af' }}>Global</strong> hides cards not yet released globally so JP-only picks
              don&apos;t appear in the wildcard pool or your eligible collection; your choice is remembered for next visit.
              Bonuses use each card&apos;s stat curve at the{' '}
              <strong style={{ color: '#7dd3fc' }}>maximum level allowed by its unlock tier</strong> (collection uncap on your
              cards; max uncap for the wildcard). If your card is still low level in-game, level it to that cap to match the
              plan. Search runs in a <strong style={{ color: '#a3a3a3' }}>background worker</strong> in your browser so
              the page stays responsive. You can list several valid decks at once; they&apos;re
              ranked by <strong style={{ color: '#a3a3a3' }}>total bonus strength</strong> (sum of all support effects at
              max unlock levels).
            </p>
          ) : (
            <p style={{ margin: '10px 0 0', fontSize: 13, color: '#9ca3af', lineHeight: 1.55 }}>
              With <strong style={{ color: '#e5e5e5' }}>My collection</strong> off, your account is not used. Any legal card
              on this server can fill the five personal slots or the one <strong style={{ color: '#e5e5e5' }}>friend</strong>{' '}
              slot; stats assume <strong style={{ color: '#7dd3fc' }}>maximum unlock (uncap 4)</strong> on every card, like a
              fully raised borrowed card. Same ranking and worker behavior as collection mode; large regional pools can take
              longer to search.
            </p>
          )}
        </details>

        {authLoading || dataLoading ? (
          <div style={{ color: '#6b7280', fontSize: 13 }}>Loading…</div>
        ) : dataError ? (
          <div style={{ color: '#f87171', fontSize: 13 }}>{dataError}</div>
        ) : !searchFromCollection ? (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
            <span style={{ color: '#a3a3a3' }}>{deckPoolCards.length}</span>{' '}
            {deckPoolCards.length === 1 ? 'card' : 'cards'} in the search pool for{' '}
            <span style={{ color: '#d4d4d8' }}>{region === 'jp' ? 'Japan' : 'Global'}</span>
            <span style={{ color: '#78716c', marginLeft: 8 }}>— full pool is searched</span>
            {!user && (
              <span style={{ marginLeft: 10 }}>
                <Link to="/login" style={{ color: '#7dd3fc' }}>
                  Sign in
                </Link>{' '}
                to enable <strong style={{ color: '#a3a3a3' }}>My collection</strong>.
              </span>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>
            <span style={{ color: '#a3a3a3' }}>{ownedInRegion.length}</span> collection cards on this server
            {ownedInRegion.length < 5 && (
              <span style={{ color: '#fbbf24', marginLeft: 8 }}>
                (need {5 - ownedInRegion.length} more — add cards in{' '}
                <Link to="/support-cards" style={{ color: '#7dd3fc' }}>
                  Support Cards
                </Link>
                )
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '10px 16px 18px', maxWidth: 1100 }}>
        <DeckBuilderForcedSlots
          slots={forcedSlots}
          onSlotsChange={setForcedSlots}
          pickableForSlot={pickableForSlot}
          getSlotPreview={getSlotPreview}
          defaultTrainLevel={defaultTrainLevel}
          maxTrainLevel={maxTrainLevelForSlot}
          disabled={authLoading || dataLoading}
        />

        <div
          style={{
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid #1f1f28',
          }}
        >
          <div style={{ fontSize: 11, color: '#71717a', fontWeight: 600, marginBottom: 8 }}>Include rarities</div>
          <div
            role="group"
            aria-label="Include card rarities in search pool"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
          >
            {(['SSR', 'SR', 'R'] as const).map(r => {
              const on = rarityFilter[r]
              const colors =
                r === 'SSR'
                  ? { border: '#fbbf24', fg: '#fef3c7', bg: 'rgba(251,191,36,0.18)' }
                  : r === 'SR'
                    ? { border: '#a78bfa', fg: '#ede9fe', bg: 'rgba(167,139,250,0.18)' }
                    : { border: '#78716c', fg: '#e7e5e4', bg: 'rgba(120,113,108,0.2)' }
              return (
                <button
                  key={r}
                  type="button"
                  disabled={authLoading || dataLoading || searching}
                  title={on ? `Include ${r}` : `${r} excluded from pool`}
                  onClick={() => {
                    setRarityFilter(prev => {
                      const next = { ...prev, [r]: !prev[r] }
                      if (!next.SSR && !next.SR && !next.R) return prev
                      return next
                    })
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: `1px solid ${on ? colors.border : '#3f3f46'}`,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: r === 'SSR' ? '-0.03em' : undefined,
                    cursor: authLoading || dataLoading || searching ? 'default' : 'pointer',
                    opacity: authLoading || dataLoading || searching ? 0.45 : 1,
                    color: on ? colors.fg : '#52525b',
                    background: on ? colors.bg : 'transparent',
                  }}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Auto-target: trainee + scenario picker ─────────────── */}
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            border: '1px solid #1f1f28',
            borderRadius: 8,
            background: '#0c0c10',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a3a3a3', marginBottom: 8 }}>
            Auto-fill targets
            <span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
              Pick a trainee and scenario to set recommended minimums
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            {/* Trainee picker */}
            <div ref={traineePickerRef} style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#71717a', marginBottom: 4 }}>Trainee</label>
              <input
                type="text"
                placeholder={selectedTrainee ? `${selectedTrainee.name}${selectedTrainee.title ? ` [${selectedTrainee.title}]` : ''}` : 'Search by name…'}
                value={traineeQuery}
                onChange={e => {
                  setTraineeQuery(e.target.value)
                  setTraineeDropdownOpen(true)
                }}
                onFocus={() => { if (traineeResults.length > 0) setTraineeDropdownOpen(true) }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: selectedTrainee ? '1px solid #4ade80' : '1px solid #2a2a38',
                  background: '#1a1a22',
                  color: '#e5e5e5',
                  fontSize: 12,
                }}
              />
              {selectedTrainee && !traineeQuery && (
                <button
                  type="button"
                  onClick={() => { setSelectedTrainee(null); setTraineeQuery('') }}
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: 24,
                    background: 'transparent',
                    border: 'none',
                    color: '#71717a',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: '2px 4px',
                  }}
                  title="Clear trainee"
                >
                  ×
                </button>
              )}
              {traineeDropdownOpen && traineeResults.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    marginTop: 2,
                    maxHeight: 200,
                    overflowY: 'auto',
                    background: '#18181b',
                    border: '1px solid #2a2a38',
                    borderRadius: 6,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}
                >
                  {traineeResults.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setSelectedTrainee(t)
                        setTraineeQuery('')
                        setTraineeDropdownOpen(false)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '6px 10px',
                        background: 'transparent',
                        border: 'none',
                        color: '#e5e5e5',
                        fontSize: 12,
                        cursor: 'pointer',
                        borderBottom: '1px solid #1f1f28',
                      }}
                      onMouseEnter={e => { (e.target as HTMLElement).style.background = '#252530' }}
                      onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
                    >
                      <span style={{ fontWeight: 600 }}>{t.name}</span>
                      {t.title && <span style={{ color: '#71717a', marginLeft: 6 }}>[{t.title}]</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Scenario picker */}
            <div style={{ flex: '0 0 auto', minWidth: 180 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#71717a', marginBottom: 4 }}>Scenario</label>
              <select
                value={selectedScenario}
                onChange={e => setSelectedScenario(e.target.value as ScenarioSlug | '')}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: selectedScenario ? '1px solid #4ade80' : '1px solid #2a2a38',
                  background: '#1a1a22',
                  color: '#e5e5e5',
                  fontSize: 12,
                }}
              >
                <option value="">Choose scenario…</option>
                {SCENARIOS.map(s => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Apply button */}
            <button
              type="button"
              disabled={!selectedTrainee || !selectedScenario}
              onClick={applyRecommendedTargets}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #4ade80',
                background: selectedTrainee && selectedScenario ? 'rgba(74,222,128,0.12)' : 'transparent',
                color: selectedTrainee && selectedScenario ? '#4ade80' : '#52525b',
                fontWeight: 600,
                fontSize: 12,
                cursor: selectedTrainee && selectedScenario ? 'pointer' : 'default',
                opacity: selectedTrainee && selectedScenario ? 1 : 0.5,
                alignSelf: 'flex-end',
              }}
            >
              Apply targets
            </button>
          </div>

          {selectedTrainee && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
              <span style={{ color: '#a3a3a3' }}>{selectedTrainee.name}</span>
              {selectedTrainee.title && <span> [{selectedTrainee.title}]</span>}
              {' — '}
              Best distance:{' '}
              <span style={{ color: '#d4d4d8' }}>
                {(() => {
                  const dists = [
                    { l: 'Short', g: selectedTrainee.apt_short },
                    { l: 'Mile', g: selectedTrainee.apt_mile },
                    { l: 'Mid', g: selectedTrainee.apt_mid },
                    { l: 'Long', g: selectedTrainee.apt_long },
                  ].filter(d => d.g)
                  dists.sort((a, b) => {
                    const gv: Record<string, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1, G: 0 }
                    return (gv[b.g!] ?? 0) - (gv[a.g!] ?? 0)
                  })
                  return dists.slice(0, 2).map(d => `${d.l} ${d.g}`).join(', ')
                })()}
              </span>
              {selectedTrainee.stat_growth && selectedTrainee.stat_growth.length >= 5 && (
                <>
                  {' · Growth: '}
                  <span style={{ color: '#d4d4d8' }}>
                    {['Spd', 'Sta', 'Pow', 'Gut', 'Wit'].map((s, i) =>
                      `${s} ${selectedTrainee.stat_growth![i]}`
                    ).join(' / ')}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <div>
            <h2
              style={{
                margin: '0 8px 0 0',
                fontSize: 13,
                fontWeight: 600,
                color: '#a3a3a3',
                display: 'inline',
              }}
            >
              Target bonus totals
            </h2>
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              Enable a stat and a minimum total (six cards at max unlock). No max — only the minimum is enforced. Leave
              off to ignore.
            </span>
          </div>
          <button
            type="button"
            onClick={resetConstraints}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#71717a',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Reset targets
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '0 14px',
            padding: '4px 8px 6px',
            border: '1px solid #252530',
            borderRadius: 8,
            background: '#0c0c10',
            marginBottom: 10,
          }}
        >
          {EFFECT_TYPE_IDS_SORTED.map(id => {
            const meta = SUPPORT_CARD_EFFECT_META[id]
            if (!meta) return null
            const row = constraints[id] ?? { enabled: false, minStr: '0' }
            return (
              <div
                key={id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '16px minmax(0, 1fr) 50px',
                  alignItems: 'center',
                  columnGap: 6,
                  padding: '2px 0',
                  fontSize: 11,
                  opacity: row.enabled ? 1 : 0.48,
                }}
              >
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={e =>
                    setConstraints(p => ({
                      ...p,
                      [id]: { ...row, enabled: e.target.checked },
                    }))
                  }
                  style={{ margin: 0, cursor: 'pointer' }}
                  aria-label={`Require ${meta.name}`}
                />
                <span
                  title={meta.name}
                  style={{
                    color: '#e5e5e5',
                    fontWeight: 500,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {meta.name}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={row.minStr}
                  onChange={e =>
                    setConstraints(p => ({
                      ...p,
                      [id]: { ...row, minStr: e.target.value },
                    }))
                  }
                  style={CONSTRAINT_INPUT_STYLE}
                  aria-label={`${meta.name} minimum`}
                  title="Minimum total"
                />
              </div>
            )
          })}
        </div>

        {searchFromCollection && ownedInRegion.length > 35 && (
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#888' }}>
            Large collection: search time grows with combinations; very tight targets may take up to a few minutes.
          </p>
        )}
        {!searchFromCollection && deckPoolCards.length >= 30 && (
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#888' }}>
            Full-pool search tries many five-card combinations; very tight targets may take a few minutes.
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#a3a3a3' }}>
            Up to
            <select
              value={maxSuggestions}
              onChange={e => setMaxSuggestions(Number(e.target.value))}
              disabled={searching}
              style={{
                background: '#1a1a22',
                border: '1px solid #2a2a38',
                borderRadius: 6,
                padding: '6px 10px',
                color: '#e5e5e5',
                fontSize: 13,
              }}
            >
              {[10, 25, 50, 100].map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            suggestions (ranked by total bonus strength)
          </label>
          <button
            type="button"
            disabled={
              authLoading ||
              dataLoading ||
              searching ||
              (searchFromCollection ? ownedInRegion.length < 5 : deckPoolCards.length < 5)
            }
            onClick={() => runSearch()}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: '1px solid #7dd3fc',
              background: searching ? '#0c2a3f' : '#0c2a3f',
              color: '#7dd3fc',
              fontWeight: 600,
              fontSize: 13,
              cursor:
                searching ||
                (searchFromCollection ? ownedInRegion.length < 5 : deckPoolCards.length < 5)
                  ? 'default'
                  : 'pointer',
              opacity:
                authLoading ||
                dataLoading ||
                (searchFromCollection ? ownedInRegion.length < 5 : deckPoolCards.length < 5)
                  ? 0.45
                  : 1,
            }}
          >
            {searching ? 'Searching…' : 'Find decks'}
          </button>
          {searching && (
            <button
              type="button"
              onClick={cancelSearch}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                border: '1px solid #57534e',
                background: '#1c1917',
                color: '#d6d3d1',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
        </div>

        {searching && (
          <div style={{ marginBottom: 10, maxWidth: 480 }}>
            {searchProgress?.source === 'worker' ? (
              <>
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: '#252530',
                    overflow: 'hidden',
                  }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    searchProgress.totalCombos > 0
                      ? Math.round(
                          Math.min(100, (searchProgress.comboIdx / searchProgress.totalCombos) * 100),
                        )
                      : 0
                  }
                  aria-label="Deck search progress through five-card combinations"
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${(() => {
                        const t = searchProgress.totalCombos
                        if (t > 0 && Number.isFinite(t)) {
                          return Math.min(99.5, (searchProgress.comboIdx / t) * 100)
                        }
                        return 0
                      })()}%`,
                      background: 'linear-gradient(90deg, #0369a1, #38bdf8)',
                      borderRadius: 4,
                      transition: 'width 0.12s ease-out',
                    }}
                  />
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>
                  Five-card combos explored:{' '}
                  <span style={{ color: '#a3a3a3' }}>
                    {searchProgress.comboIdx.toLocaleString()} / {searchProgress.totalCombos.toLocaleString()}
                  </span>
                  {' · '}
                  Stat checks:{' '}
                  <span style={{ color: '#a3a3a3' }}>{searchProgress.iterations.toLocaleString()}</span>
                  {deckSearchEta != null && (
                    <>
                      {' · '}
                      {deckSearchEta.remaining == null ? (
                        <span style={{ color: '#71717a' }}>Estimating time…</span>
                      ) : deckSearchEta.remaining <= 0 ? (
                        <span style={{ color: '#a3a3a3' }}>Finishing…</span>
                      ) : (
                        <span style={{ color: '#a3a3a3' }}>
                          {formatRemainingShort(deckSearchEta.remaining)} left (rough)
                        </span>
                      )}
                    </>
                  )}
                </p>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Starting search…</p>
            )}
          </div>
        )}

        {searchMessage && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#fbbf24' }}>{searchMessage}</div>
        )}

        {solveResult && !searching && solveResult.solutions.length === 0 && !searchMessage && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
            No matching deck (after {solveResult.iterations.toLocaleString()} checks).
          </div>
        )}

        {displayedSolutions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                marginLeft: -4,
                marginRight: -4,
                padding: '6px 10px',
                background: 'linear-gradient(180deg, #0a0a0a 0%, #0a0a0ae6 85%, transparent 100%)',
                borderBottom: '1px solid #1f1f28',
              }}
            >
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e5e5e5' }}>
                {displayedSolutions.length} suggestion{displayedSolutions.length === 1 ? '' : 's'}
              </h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9ca3af' }}>
                Sort by
                <select
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value as 'stats' | 'upgrades')}
                  style={{
                    background: '#1a1a22',
                    border: '1px solid #2a2a38',
                    borderRadius: 6,
                    padding: '4px 8px',
                    color: '#e5e5e5',
                    fontSize: 12,
                  }}
                >
                  <option value="stats">Highest total stats</option>
                  <option value="upgrades">Fewest cards to level</option>
                </select>
              </label>
              {solveResult && solveResult.capped && (
                <span style={{ fontSize: 11, color: '#fbbf24' }}>Search stopped early — list may be partial.</span>
              )}
              {relaxationPct != null && relaxationPct > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    color: '#fb923c',
                    background: 'rgba(251,146,60,0.1)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid rgba(251,146,60,0.25)',
                  }}
                >
                  Targets relaxed by {relaxationPct}%
                </span>
              )}
            </div>

            {displayedSolutions.map((solution, rank) => (
              <div
                key={deckSuggestionKey(solution)}
                style={{
                  marginBottom: 10,
                  padding: '8px 10px 10px',
                  background: '#0e0e12',
                  borderRadius: 8,
                  border: '1px solid #1f1f28',
                }}
              >
                <div
                  style={{
                    marginBottom: 6,
                    fontSize: 11,
                    color: '#94a3b8',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    gap: '0 8px',
                  }}
                >
                  <strong style={{ color: '#e5e5e5' }}>#{rank + 1}</strong>
                  <span>
                    Strength <strong style={{ color: '#a5f3fc' }}>{Math.round(solution.rankScore).toLocaleString()}</strong>
                  </span>
                  {solution.upgradeHints.length > 0 && (
                    <span style={{ color: '#78716c' }}>
                      · {solution.upgradeHints.length} to level
                    </span>
                  )}
                  {/* Type synergy summary */}
                  {(() => {
                    const groups = Object.entries(solution.typeCounts)
                      .filter(([, n]) => n >= 2)
                      .sort((a, b) => b[1] - a[1])
                    if (groups.length === 0) return null
                    return (
                      <span style={{ color: '#a78bfa' }}>
                        · {groups.map(([t, n]) => `${n}× ${t}`).join(', ')}
                      </span>
                    )
                  })()}
                </div>

                {solution.upgradeHints.length > 0 && (
                  <details
                    style={{
                      marginBottom: 6,
                      borderRadius: 6,
                      border: '1px solid rgba(251,191,36,0.35)',
                      background: 'rgba(251,191,36,0.06)',
                    }}
                  >
                    <summary
                      style={{
                        cursor: 'pointer',
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#fcd34d',
                        listStyle: 'none',
                      }}
                    >
                      Level {solution.upgradeHints.length} card{solution.upgradeHints.length === 1 ? '' : 's'} to max for
                      unlock tier
                    </summary>
                    <ul
                      style={{
                        margin: 0,
                        padding: '0 12px 10px 28px',
                        fontSize: 12,
                        color: '#fde68a',
                        lineHeight: 1.45,
                      }}
                    >
                      {solution.upgradeHints.map(h => (
                        <li key={h.cardId}>
                          <strong style={{ color: '#fff' }}>{h.name}</strong> — Lv {h.currentLevel} → Lv {h.targetLevel}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    overflowX: 'auto',
                    paddingBottom: 4,
                    marginBottom: 6,
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {solution.owned.map(o => (
                    <DeckPreviewCard
                      key={o.cardId}
                      artSrc={artUrl(o.cardId)}
                      name={o.name}
                      rarity={o.rarity}
                      cardType={o.card_type}
                      displayLevel={
                        o.statTrainLevel != null
                          ? clampOwnedTrainLevel(o.statTrainLevel, o.uncap, o.rarity)
                          : plannedDisplayLevel(o.rarity, o.uncap, false)
                      }
                      compact
                    />
                  ))}
                  <DeckPreviewCard
                    artSrc={artUrl(solution.wildcard.cardId)}
                    name={solution.wildcard.name}
                    rarity={solution.wildcard.rarity}
                    cardType={solution.wildcard.card_type}
                    displayLevel={
                      solution.wildcard.statTrainLevel != null
                        ? clampFriendTrainLevel(solution.wildcard.statTrainLevel, solution.wildcard.rarity)
                        : plannedDisplayLevel(solution.wildcard.rarity, 0, true)
                    }
                    wildcard
                    compact
                  />
                </div>

                <div style={{ marginTop: 4, marginBottom: 6 }}>
                  <UmaTrainerLookup
                    key={`${deckSuggestionKey(solution)}-uma`}
                    supportCardId={solution.wildcard.cardId}
                    cardName={solution.wildcard.name}
                  />
                </div>

                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>Combined totals (max unlock)</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))',
                    gap: 4,
                  }}
                >
                  {Object.entries(solution.total)
                    .map(([k, v]) => ({ id: Number(k), v }))
                    .filter(({ v }) => v !== 0)
                    .sort((a, b) => a.id - b.id)
                    .map(({ id, v }) => (
                      <div
                        key={id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '3px 6px',
                          background: '#14141a',
                          borderRadius: 4,
                          fontSize: 10,
                        }}
                      >
                        <span style={{ color: '#8b8b9a', lineHeight: 1.3 }}>
                          {SUPPORT_CARD_EFFECT_META[id]?.name ?? `Effect ${id}`}
                        </span>
                        <span style={{ color: '#a5f3fc', fontWeight: 600, flexShrink: 0 }}>
                          {formatEffectValue(id, v)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CatalogShell>
  )
}
