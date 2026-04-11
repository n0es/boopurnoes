import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
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
import { runDeckSolveInWorker, runDeckSolveOnServer } from '../lib/deckSolverRun'
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
    const { data, error } = await supabase
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
    | null
    | { source: 'server' }
    | { source: 'worker'; comboIdx: number; totalCombos: number; iterations: number }
  >(null)
  /** Set when the browser worker starts (excludes server-only phase). Used for ETA. */
  const [workerSearchStartedAt, setWorkerSearchStartedAt] = useState<number | null>(null)
  const [etaTick, setEtaTick] = useState(0)
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [solveResult, setSolveResult] = useState<SolveDeckResult | null>(null)
  const [maxSuggestions, setMaxSuggestions] = useState(DEFAULT_MAX_DECK_SUGGESTIONS)
  const [sortMode, setSortMode] = useState<'stats' | 'upgrades'>('stats')
  const [useCollection, setUseCollection] = useState(loadUseCollection)

  useEffect(() => {
    saveUseCollection(useCollection)
  }, [useCollection])

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
        const { data: cardRows, error: cErr } = await supabase
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
          const { data: col, error: colErr } = await supabase
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

  const ownedInRegion = useMemo(() => {
    const eligibleId = new Set(eligibleCards.map(c => c.id))
    const out: { card: CatalogCard; level: number; uncap: number }[] = []
    for (const [cardId, lv] of collectionMap) {
      if (!eligibleId.has(cardId)) continue
      const card = eligibleCards.find(c => c.id === cardId)
      if (!card) continue
      out.push({ card, level: lv.level, uncap: lv.uncap })
    }
    return out.sort((a, b) => a.card.name.localeCompare(b.card.name))
  }, [collectionMap, eligibleCards])

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
      const pool: CatalogCard[] = user ? ownedInRegion.map(o => o.card) : eligibleCards
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
    [user, eligibleCards, ownedInRegion, cardIdToOwned],
  )

  /** Fixed slots plan at full limit break (4) so level can go up to the game max for that rarity. */
  const getSlotPreview = useCallback(
    (slotIndex: number) => {
      const slot = forcedSlots[slotIndex]
      if (!slot) return undefined
      const c = eligibleCards.find(x => x.id === slot.cardId)
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
    [forcedSlots, eligibleCards],
  )

  const defaultTrainLevel = useCallback(
    (cardId: number, _slotIndex: number) => {
      const c = eligibleCards.find(x => x.id === cardId)
      if (!c) return 1
      return maxLevelForUncap(CATALOG_POOL_UNCAP, c.rarity)
    },
    [eligibleCards],
  )

  const maxTrainLevelForSlot = useCallback(
    (slotIndex: number) => {
      const slot = forcedSlots[slotIndex]
      if (!slot) return 50
      const c = eligibleCards.find(x => x.id === slot.cardId)
      if (!c) return 50
      return maxLevelForUncap(CATALOG_POOL_UNCAP, c.rarity)
    },
    [forcedSlots, eligibleCards],
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
      if (eligibleCards.length < 5) {
        setSearchMessage('Need at least five support cards legal on this server (check the region in the header).')
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
      : eligibleCards.map(c => ({
          cardId: c.id,
          name: c.name,
          rarity: c.rarity,
          card_type: c.card_type,
          level: maxLevelForUncap(CATALOG_POOL_UNCAP, c.rarity),
          uncap: CATALOG_POOL_UNCAP,
          effects: effectsByCard.get(c.id) ?? [],
        }))

    const wildcardPool = eligibleCards.map(c => ({
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
    setWorkerSearchStartedAt(null)
    setSearchProgress(
      import.meta.env.PROD
        ? { source: 'server' }
        : {
            source: 'worker',
            comboIdx: 0,
            totalCombos: binomialChoose5(ownedEntriesWithForced.length),
            iterations: 0,
          },
    )
    void (async () => {
      try {
        const args = {
          owned: ownedEntriesWithForced,
          wildcardPool: wildcardPoolWithForced,
          constraints: parsed,
          maxSolutions: maxSuggestions,
          ...(forcedOwnedIds.length > 0 ? { forcedOwnedCardIds: forcedOwnedIds } : {}),
          ...(friendForcedId != null ? { forcedWildcardCardId: friendForcedId } : {}),
        }
        let res = import.meta.env.PROD ? await runDeckSolveOnServer(args) : null
        if (!res) {
          const t0 = Date.now()
          setWorkerSearchStartedAt(t0)
          res = await runDeckSolveInWorker(args, {
            onProgress: p => setSearchProgress({ source: 'worker', ...p }),
          })
        }
        setSolveResult(res)
        if (res.capped) {
          setSearchMessage(
            'Search timed out before finishing the full search (5 minute limit). Results may be partial; loosen targets or try again.',
          )
        } else if (res.solutions.length === 0) {
          setSearchMessage('No deck found. Loosen your target ranges or change server filter.')
        }
      } catch (e) {
        setSearchMessage(e instanceof Error ? e.message : 'Search failed.')
      } finally {
        setSearching(false)
        setSearchProgress(null)
        setWorkerSearchStartedAt(null)
      }
    })()
  }, [
    searchFromCollection,
    constraints,
    ownedInRegion,
    eligibleCards,
    effectsByCard,
    maxSuggestions,
    forcedSlots,
  ])

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
              plan. Search runs in a <strong style={{ color: '#a3a3a3' }}>background worker</strong> so the page stays
              responsive; production builds can also solve on the server via{' '}
              <code style={{ fontSize: 12 }}>/api/deck-solve</code>. You can list several valid decks at once; they&apos;re
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
            <span style={{ color: '#a3a3a3' }}>{eligibleCards.length}</span>{' '}
            {eligibleCards.length === 1 ? 'card' : 'cards'} eligible for{' '}
            <span style={{ color: '#d4d4d8' }}>{region === 'jp' ? 'Japan' : 'Global'}</span>
            <span style={{ color: '#78716c', marginLeft: 8 }}>— full eligible pool is searched</span>
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
        {!searchFromCollection && eligibleCards.length >= 30 && (
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
              (searchFromCollection ? ownedInRegion.length < 5 : eligibleCards.length < 5)
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
                (searchFromCollection ? ownedInRegion.length < 5 : eligibleCards.length < 5)
                  ? 'default'
                  : 'pointer',
              opacity:
                authLoading ||
                dataLoading ||
                (searchFromCollection ? ownedInRegion.length < 5 : eligibleCards.length < 5)
                  ? 0.45
                  : 1,
            }}
          >
            {searching ? 'Searching…' : 'Find decks'}
          </button>
        </div>

        {searching && (
          <div style={{ marginBottom: 10, maxWidth: 480 }}>
            {searchProgress?.source === 'server' ? (
              <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Searching on server…</p>
            ) : searchProgress?.source === 'worker' ? (
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
