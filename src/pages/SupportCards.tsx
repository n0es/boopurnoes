import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  CatalogShell,
  CatalogHeader,
  CatalogCollectionControls,
  CatalogGrid,
  RegionFilter,
  FilterPill,
  CardSizeSlider,
} from '../components/catalog'
import {
  hasReleaseInfo,
  releaseSummaryLines,
  passesRegionAvailabilityFilter,
  todayIsoDateLocal,
  type ReleaseMetadata,
} from '../lib/releaseMetadata'
import { useRegionSearchParam } from '../lib/useRegionSearchParam'
import { isMissingTableError } from '../lib/supabaseErrors'
import { maxLevelForUncap } from '../lib/supportCardLevel'

interface SupportCard extends ReleaseMetadata {
  id: number
  name: string
  title: string | null
  rarity: string
  card_type: string
}

interface SupportCardEffect {
  id: number
  effect_name: string
  symbol: string | null
  unlock_level: number
  values_by_level: number[]
}

interface Skill {
  name: string
  description: string | null
  icon_url: string | null
  condition: string | null
}

interface HintSkill {
  id: number
  sort_order: number
  skills: Skill
}

interface EventSkill {
  id: number
  sort_order: number
  skills: Skill
}

interface TrainingEvent {
  id: number
  name: string
  event_type: 'chain' | 'random'
  chain_level: number | null
  sort_order: number
}

interface OwnedEntry {
  level: number
  uncap: number
}

const CARD_TYPES = ['speed', 'stamina', 'power', 'guts', 'intelligence', 'friend', 'group']
const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`

function getArtUrl(id: number)      { return `${SUPABASE_STORAGE}/supports/art/${id}.png` }
function getIconUrl(id: number)     { return `${SUPABASE_STORAGE}/supports/icons/${id}.png` }
function getTypeIconUrl(t: string)  { return `${SUPABASE_STORAGE}/icons/${t}.png` }

const RARITY_STYLE: Record<string, { color: string; bg: string }> = {
  SSR: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  SR:  { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  R:   { color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' },
}

type SortField = 'id' | 'name' | 'rarity' | 'card_type'
type SortDir   = 'asc' | 'desc'

const RARITY_ORDER: Record<string, number> = { SSR: 0, SR: 1, R: 2 }

export default function SupportCards() {
  const { user } = useAuth()
  const [cards, setCards]               = useState<SupportCard[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedRarity, setSelectedRarity] = useState<string | null>(null)
  const [search, setSearch]             = useState('')
  const [sortField, setSortField]       = useState<SortField>('id')
  const [sortDir, setSortDir]           = useState<SortDir>('asc')
  const [collectionMode, setCollectionMode] = useState(false)
  const [ownedMap, setOwnedMap]         = useState<Map<number, OwnedEntry> | null>(null)
  const { region: regionFilter, setRegion: setRegionFilter, searchParams, setSearchParams } =
    useRegionSearchParam()
  const unownedMode = searchParams.get('unowned') === '1'
  function toggleUnownedMode() {
    if (!collectionMode) return
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      if (unownedMode) n.delete('unowned')
      else n.set('unowned', '1')
      return n
    }, { replace: true })
  }
  const [modalCard, setModalCard]       = useState<SupportCard | null>(null)
  const [cardSize, setCardSize]         = useState(100) // min card width in px

  const todayIso = todayIsoDateLocal()

  function toggleCollectionMode() {
    if (collectionMode) {
      setSearchParams(p => { const n = new URLSearchParams(p); n.delete('unowned'); return n }, { replace: true })
    }
    setCollectionMode(m => !m)
  }

  useEffect(() => {
    async function fetchCards() {
      setLoading(true); setError(null)
      const { data, error } = await supabase
        .from('support_cards')
        .select('id, name, title, rarity, card_type, released_jp, released_global, release_global_is_approximate, release_source')
        .order('id', { ascending: true })
      if (error) setError(error.message)
      else setCards(data ?? [])
      setLoading(false)
    }
    fetchCards()
  }, [])

  const fetchCollection = useCallback(() => {
    supabase
      .from('user_support_card_collection')
      .select('card_id, level, uncap')
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('user_support_card_collection:', error.message)
          setOwnedMap(new Map())
          return
        }
        const map = new Map<number, OwnedEntry>()
        for (const r of (data ?? []) as { card_id: number; level: number; uncap: number }[]) {
          map.set(r.card_id, { level: r.level, uncap: r.uncap })
        }
        setOwnedMap(map)
      })
  }, [])

  async function addToCollection(cardId: number, level: number, uncap: number) {
    const { error } = await supabase
      .from('user_support_card_collection')
      .upsert({ card_id: cardId, level, uncap, user_id: user!.id }, { onConflict: 'user_id,card_id' })
    if (error) {
      if (isMissingTableError(error)) {
        window.alert('Collection is unavailable: apply database migrations (user_support_card_collection) on the server.')
      }
      return
    }
    await fetchCollection()
  }

  async function removeFromCollection(cardId: number) {
    const { error } = await supabase
      .from('user_support_card_collection')
      .delete()
      .eq('card_id', cardId)
    if (error && !isMissingTableError(error)) console.warn('removeFromCollection:', error.message)
    await fetchCollection()
  }

  useEffect(() => {
    if (collectionMode && user) {
      fetchCollection()
    }
  }, [collectionMode, user, fetchCollection])

  const filtered = cards
    .filter(c => {
      if (selectedType   && c.card_type !== selectedType)                           return false
      if (selectedRarity && c.rarity    !== selectedRarity)                         return false
      if (search         && !c.name.toLowerCase().includes(search.toLowerCase()))   return false
      if (collectionMode && !unownedMode && user && ownedMap !== null && !ownedMap.has(c.id)) return false
      if (!passesRegionAvailabilityFilter(regionFilter, c.released_jp, c.released_global, todayIso)) return false
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      if      (sortField === 'rarity')    cmp = (RARITY_ORDER[a.rarity] ?? 99) - (RARITY_ORDER[b.rarity] ?? 99)
      else if (sortField === 'name')      cmp = a.name.localeCompare(b.name)
      else if (sortField === 'card_type') cmp = a.card_type.localeCompare(b.card_type)
      else                                cmp = a.id - b.id
      return sortDir === 'asc' ? cmp : -cmp
    })

  return (
    <CatalogShell>
      <CatalogHeader title="Support Cards" />

      {/* Filters */}
      <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid #1a1a1a' }}>
        <input
          type="search" placeholder="Search cards…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#1a1a22', border: '1px solid #2a2a38', borderRadius: 8,
            padding: '5px 10px', color: '#fff', fontSize: 12, outline: 'none', width: 160,
          }}
        />
        <RegionFilter value={regionFilter} onChange={setRegionFilter} />
        <div style={{ display: 'flex', gap: 4 }}>
          {(['id', 'name', 'rarity', 'card_type'] as SortField[]).map(field => (
            <FilterPill
              key={field}
              active={sortField === field}
              onClick={() => {
                if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                else { setSortField(field); setSortDir('asc') }
              }}
            >
              {field === 'id' ? 'Default' : field === 'card_type' ? 'Type' : field.charAt(0).toUpperCase() + field.slice(1)}
              {sortField === field && (sortDir === 'asc' ? ' ↑' : ' ↓')}
            </FilterPill>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['SSR', 'SR', 'R'].map(r => {
            const rs = RARITY_STYLE[r]
            return (
              <FilterPill
                key={r}
                active={selectedRarity === r}
                activeColor={rs?.color}
                activeBg={rs?.bg}
                activeBorder={rs?.color}
                onClick={() => setSelectedRarity(selectedRarity === r ? null : r)}
              >
                {r}
              </FilterPill>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CARD_TYPES.map(type => (
            <button key={type}
              onClick={() => setSelectedType(selectedType === type ? null : type)}
              title={type}
              style={{
                padding: '4px 8px', borderRadius: 20, border: '2px solid',
                borderColor: selectedType === type ? '#fff' : 'transparent',
                background: 'transparent', cursor: 'pointer',
                opacity: selectedType && selectedType !== type ? 0.4 : 1,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
            >
              <img src={getTypeIconUrl(type)} alt={type} style={{ width: 28, height: 28, objectFit: 'contain', display: 'block' }} />
            </button>
          ))}
        </div>
        <CatalogCollectionControls
          collectionMode={collectionMode}
          onToggleCollection={toggleCollectionMode}
          unownedMode={unownedMode}
          onToggleUnowned={toggleUnownedMode}
          collectionDisabled={!user}
          warningMessage={collectionMode && !user ? 'Sign in to use collection mode' : undefined}
        />
        <CardSizeSlider
          value={cardSize}
          onChange={setCardSize}
          min={60} max={180}
          count={filtered.length}
          ownedCount={collectionMode && user && ownedMap !== null ? ownedMap.size : undefined}
        />
      </div>

      <CatalogGrid loading={loading} error={error} emptyMessage="No cards found." cardSize={cardSize}>
        {filtered.map(card => (
          <CardTile
            key={card.id}
            card={card}
            owned={collectionMode && !!user && ownedMap !== null && ownedMap.has(card.id)}
            dimmed={collectionMode && unownedMode && !!user && ownedMap !== null && !ownedMap.has(card.id)}
            onClick={() => setModalCard(card)}
          />
        ))}
      </CatalogGrid>

      {modalCard && (
        <CardModal
          card={modalCard}
          user={user}
          owned={ownedMap?.get(modalCard.id) ?? null}
          onClose={() => setModalCard(null)}
          onAdd={async (level, uncap) => { await addToCollection(modalCard.id, level, uncap); setModalCard(null) }}
          onRemove={async () => { await removeFromCollection(modalCard.id); setModalCard(null) }}
          onCardUpdated={(updated) => {
            setCards(prev => prev.map(c => c.id === updated.id ? updated : c))
            setModalCard(updated)
          }}
        />
      )}
    </CatalogShell>
  )
}

// ---------------------------------------------------------------------------
// Card tile
// ---------------------------------------------------------------------------
function CardTile({ card, owned, dimmed, onClick }: {
  card: SupportCard; owned: boolean; dimmed: boolean; onClick: () => void
}) {
  const [artLoaded, setArtLoaded] = useState(false)
  const ownedShadow  = '0 2px 12px rgba(125,211,252,0.25), inset 0 0 0 2px #7dd3fc'
  const defaultShadow = '0 2px 12px rgba(0,0,0,0.5)'
  const hoverOwned   = '0 6px 24px rgba(125,211,252,0.35), inset 0 0 0 2px #7dd3fc'
  const hoverDefault = '0 6px 24px rgba(0,0,0,0.7)'

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', borderRadius: 12, overflow: 'hidden',
        background: '#1a1a22', aspectRatio: '3 / 4',
        boxShadow: owned ? ownedShadow : defaultShadow,
        transition: 'transform 0.15s, box-shadow 0.15s, filter 0.2s ease',
        cursor: 'pointer',
        filter: dimmed ? 'grayscale(1) brightness(0.4)' : 'none',
      }}
      onMouseEnter={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1.03)'
        d.style.boxShadow = owned ? hoverOwned : hoverDefault
        if (dimmed) d.style.filter = 'grayscale(0.2) brightness(0.85)'
      }}
      onMouseLeave={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1)'
        d.style.boxShadow = owned ? ownedShadow : defaultShadow
        if (dimmed) d.style.filter = 'grayscale(1) brightness(0.4)'
      }}
    >
      <img src={getArtUrl(card.id)} alt={card.name} onLoad={() => setArtLoaded(true)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: artLoaded ? 1 : 0, transition: 'opacity 0.3s' }}
      />
      {!artLoaded && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1e1e2a 0%, #2a2a38 50%, #1e1e2a 100%)' }} />
      )}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '32px 8px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', lineHeight: 1.3, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{card.name}</div>
        <div style={{ fontSize: 10, color: '#ccc', marginTop: 2, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{card.rarity}</div>
      </div>
      <div style={{ position: 'absolute', top: 6, left: 6, width: 40, height: 40, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)' }}>
        <img src={getIconUrl(card.id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.8))' }}>
        <img src={getTypeIconUrl(card.card_type)} alt={card.card_type} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Uncap diamonds
// ---------------------------------------------------------------------------
function UncapDiamonds({ value, max = 4, interactive, onChange }: {
  value: number; max?: number; interactive: boolean; onChange?: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value
        return (
          <div
            key={i}
            onClick={() => {
              if (!interactive || !onChange) return
              // click filled last diamond = remove one; otherwise fill up to here
              onChange(i + 1 === value ? i : i + 1)
            }}
            style={{
              width: 12, height: 12,
              transform: 'rotate(45deg)',
              background: filled ? '#60a5fa' : 'transparent',
              border: `2px solid ${filled ? '#60a5fa' : '#4b5563'}`,
              borderRadius: 2,
              cursor: interactive ? 'pointer' : 'default',
              transition: 'background 0.15s, border-color 0.15s',
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card modal
// ---------------------------------------------------------------------------
function CardModal({ card, user, owned, onClose, onAdd, onRemove, onCardUpdated }: {
  card: SupportCard
  user: User | null
  owned: OwnedEntry | null
  onClose: () => void
  onAdd: (level: number, uncap: number) => Promise<void>
  onRemove: () => Promise<void>
  onCardUpdated?: (updated: SupportCard) => void
}) {
  const isOwned = owned !== null
  const [uncap, setUncap]   = useState(owned?.uncap ?? 0)
  const [level, setLevel]   = useState(owned?.level ?? 1)
  const [effects, setEffects] = useState<SupportCardEffect[]>([])
  const [hints, setHints]   = useState<HintSkill[]>([])
  const [eventSkills, setEventSkills] = useState<EventSkill[]>([])
  const [trainingEvents, setTrainingEvents] = useState<TrainingEvent[]>([])
  const [busy, setBusy]     = useState(false)
  const [editing, setEditing] = useState(false)
  const overlayRef          = useRef<HTMLDivElement>(null)

  const maxLevel = maxLevelForUncap(uncap, card.rarity)

  useEffect(() => {
    supabase
      .from('support_card_effects')
      .select('id, effect_name, symbol, unlock_level, values_by_level')
      .eq('card_id', card.id)
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('support_card_effects:', error.message)
          setEffects([])
          return
        }
        setEffects((data ?? []) as SupportCardEffect[])
      })

    supabase
      .from('support_card_hints')
      .select('id, sort_order, skills(name, description, icon_url, condition)')
      .eq('card_id', card.id)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('support_card_hints:', error.message)
          setHints([])
          return
        }
        setHints((data ?? []) as unknown as HintSkill[])
      })

    supabase
      .from('support_card_event_skills')
      .select('id, sort_order, skills(name, description, icon_url, condition)')
      .eq('card_id', card.id)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('support_card_event_skills:', error.message)
          setEventSkills([])
          return
        }
        setEventSkills((data ?? []) as unknown as EventSkill[])
      })

    supabase
      .from('support_card_training_events')
      .select('id, name, event_type, chain_level, sort_order')
      .eq('card_id', card.id)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('support_card_training_events:', error.message)
          setTrainingEvents([])
          return
        }
        setTrainingEvents((data ?? []) as TrainingEvent[])
      })
  }, [card.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const effectsAtLevel = effects
    .filter(e => e.unlock_level <= level && e.values_by_level?.length)
    .map(e => {
      const idx = Math.min(level, e.values_by_level.length - 1)
      return { ...e, value: e.values_by_level[idx] }
    })

  const rarityStyle = RARITY_STYLE[card.rarity] ?? RARITY_STYLE.R

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 16,
      }}
    >
      <div style={{
        background: '#16161e', borderRadius: 16, width: '100%', maxWidth: 780,
        border: '1px solid #2a2a38', boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 32px)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #222', flexShrink: 0 }}>
          <img src={getIconUrl(card.id)} alt="" style={{ width: 36, height: 36, borderRadius: 6, border: '1px solid #333' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{card.name}</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{card.title || card.card_type}</div>
            {hasReleaseInfo(card) && (
              <div style={{ fontSize: 10, color: '#888', marginTop: 6, lineHeight: 1.45 }}>
                {releaseSummaryLines(card).map(line => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {user && (
            <button
              onClick={() => setEditing(true)}
              title="Edit card data"
              style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', cursor: 'pointer', fontSize: 12, padding: '4px 10px', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#a78bfa'; e.currentTarget.style.color = '#a78bfa' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#888' }}
            >Edit</button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '4px 6px' }}
            >×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>

          {/* ── Left: card art ── */}
          <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #222' }}>
            {/* Card art with overlays */}
            <div style={{ position: 'relative', aspectRatio: '3 / 4', flexShrink: 0 }}>
              <img src={getArtUrl(card.id)} alt={card.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {/* bottom gradient */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 45%)' }} />

              {/* Top-left: rarity */}
              <div style={{
                position: 'absolute', top: 8, left: 8,
                background: rarityStyle.bg, border: `1px solid ${rarityStyle.color}`,
                borderRadius: 5, padding: '2px 7px',
                fontSize: 11, fontWeight: 700, color: rarityStyle.color,
              }}>
                {card.rarity}
              </div>

              {/* Top-right: type icon */}
              <img src={getTypeIconUrl(card.card_type)} alt={card.card_type}
                style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.9))' }}
              />

              {/* Bottom: level + uncap */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '8px 10px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                  Lv. {level}
                </span>
                <UncapDiamonds value={uncap} interactive={!isOwned} onChange={v => {
                  setUncap(v)
                  const newMax = maxLevelForUncap(v, card.rarity)
                  if (level > newMax) setLevel(newMax)
                }} />
              </div>
            </div>

            {/* Level controls */}
            <div style={{ padding: '12px 12px 14px', background: '#111117' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button
                  onClick={() => setLevel(l => Math.max(1, l - 1))}
                  disabled={level <= 1 || isOwned}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a38', background: '#1a1a24', color: level <= 1 || isOwned ? '#333' : '#aaa', cursor: level <= 1 || isOwned ? 'default' : 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >−</button>
                <div style={{ flex: 1, textAlign: 'center', fontSize: 22, fontWeight: 700, color: isOwned ? '#7dd3fc' : '#fff' }}>
                  {level}
                </div>
                <button
                  onClick={() => setLevel(l => Math.min(maxLevel, l + 1))}
                  disabled={level >= maxLevel || isOwned}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #2a2a38', background: '#1a1a24', color: level >= maxLevel || isOwned ? '#333' : '#aaa', cursor: level >= maxLevel || isOwned ? 'default' : 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >+</button>
              </div>
              <input
                type="range" min={1} max={maxLevel} value={level}
                disabled={isOwned}
                onChange={e => setLevel(Number(e.target.value))}
                style={{ width: '100%', accentColor: isOwned ? '#7dd3fc' : '#a78bfa', cursor: isOwned ? 'default' : 'pointer', margin: 0, padding: 0, display: 'block' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#444', marginTop: 2 }}>
                <span>1</span><span>{maxLevel}</span>
              </div>
            </div>
          </div>

          {/* ── Middle: support effects ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #222', minWidth: 0 }}>
            <div style={{ padding: '12px 14px 8px', fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
              Support Effects
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px 12px' }}>
              {effectsAtLevel.length === 0 ? (
                <div style={{ padding: '8px 10px', color: '#444', fontSize: 13 }}>No effects at this level.</div>
              ) : (
                effectsAtLevel.map(e => (
                  <div key={e.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', borderRadius: 7, margin: '2px 4px',
                    background: '#1a1a26',
                  }}>
                    <span style={{ fontSize: 12, color: '#ccc' }}>{e.effect_name}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#a5f3fc', marginLeft: 8, whiteSpace: 'nowrap' }}>
                      {e.symbol === 'percent' ? `${e.value}%` : e.symbol === 'level' ? `Lv ${e.value}` : e.value}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Right: skills & events ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ padding: '12px 14px 8px', fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
              Skills &amp; Events
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px 12px' }}>
              {hints.length === 0 && eventSkills.length === 0 && trainingEvents.length === 0 ? (
                <div style={{ padding: '8px 10px', color: '#444', fontSize: 13 }}>No skills data.</div>
              ) : (
                <>
                  {/* Hints */}
                  {hints.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#60a5fa', padding: '4px 10px', letterSpacing: '0.04em' }}>Hints</div>
                      {hints.map(h => (
                        <div key={h.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 10px', borderRadius: 7, margin: '2px 4px',
                          background: '#1a1a26',
                        }}>
                          {h.skills?.icon_url && <img src={h.skills.icon_url} alt="" style={{ width: 20, height: 20, borderRadius: 3, flexShrink: 0 }} />}
                          <span style={{ fontSize: 12, color: '#ccc' }}>{h.skills?.name}</span>
                          {h.skills?.condition && <span style={{ fontSize: 10, color: '#888', marginLeft: 'auto', flexShrink: 0 }}>{h.skills.condition}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Event skills */}
                  {eventSkills.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', padding: '4px 10px', letterSpacing: '0.04em' }}>Event Skills</div>
                      {eventSkills.map(s => (
                        <div key={s.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 10px', borderRadius: 7, margin: '2px 4px',
                          background: '#1a1a26',
                        }}>
                          {s.skills?.icon_url && <img src={s.skills.icon_url} alt="" style={{ width: 20, height: 20, borderRadius: 3, flexShrink: 0 }} />}
                          <span style={{ fontSize: 12, color: '#ccc' }}>{s.skills?.name}</span>
                          {s.skills?.condition && <span style={{ fontSize: 10, color: '#888', marginLeft: 'auto', flexShrink: 0 }}>{s.skills.condition}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Training events */}
                  {trainingEvents.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24', padding: '4px 10px', letterSpacing: '0.04em' }}>Training Events</div>
                      {trainingEvents.map(ev => (
                        <div key={ev.id} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', borderRadius: 7, margin: '2px 4px',
                          background: '#1a1a26',
                        }}>
                          {ev.event_type === 'chain' && (
                            <span style={{ fontSize: 11, color: '#fbbf24', flexShrink: 0 }}>{'❯'.repeat(ev.chain_level ?? 1)}</span>
                          )}
                          {ev.event_type === 'random' && (
                            <span style={{ fontSize: 10, color: '#888', flexShrink: 0 }}>⟡</span>
                          )}
                          <span style={{ fontSize: 12, color: '#ccc' }}>{ev.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid #222', flexShrink: 0, alignItems: 'center' }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #2a2a38', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
          >Close</button>
          {user && isOwned && (
            <button
              onClick={async () => { setBusy(true); await onRemove(); setBusy(false) }}
              disabled={busy}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #f87171', background: '#1f1010', color: busy ? '#666' : '#f87171', cursor: busy ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}
            >{busy ? 'Removing…' : 'Remove'}</button>
          )}
          {user && !isOwned && (
            <button
              onClick={async () => { setBusy(true); await onAdd(level, uncap); setBusy(false) }}
              disabled={busy}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: busy ? '#2a2050' : '#4c3bc0', color: busy ? '#aaa' : '#fff', cursor: busy ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}
            >{busy ? 'Adding…' : 'Add to Collection'}</button>
          )}
          {!user && !isOwned && (
            <span style={{ flex: 1, textAlign: 'center', fontSize: 13, color: '#666' }}>
              <Link to="/login" style={{ color: '#a78bfa' }}>Sign in</Link>
              {' '}to track this card in your collection.
            </span>
          )}
        </div>
      </div>

      {editing && (
        <EditCardModal
          card={card}
          effects={effects}
          onClose={() => setEditing(false)}
          onSaved={(updatedCard, updatedEffects) => {
            setEffects(updatedEffects)
            onCardUpdated?.(updatedCard)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit card modal
// ---------------------------------------------------------------------------
const INPUT_STYLE: React.CSSProperties = {
  background: '#1a1a24', border: '1px solid #333', borderRadius: 6,
  padding: '5px 8px', color: '#fff', fontSize: 13, outline: 'none', width: '100%',
}
const LABEL_STYLE: React.CSSProperties = { fontSize: 11, color: '#888', marginBottom: 3 }
const SYMBOL_OPTIONS = ['none', 'percent', 'level']

interface EditEffectRow {
  id: number | null  // null = new row
  effect_name: string
  symbol: string
  unlock_level: number
  values_by_level: string  // comma-separated for editing
  _deleted?: boolean
}

function EditCardModal({ card, effects, onClose, onSaved }: {
  card: SupportCard
  effects: SupportCardEffect[]
  onClose: () => void
  onSaved: (card: SupportCard, effects: SupportCardEffect[]) => void
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Card fields
  const [name, setName]         = useState(card.name)
  const [title, setTitle]       = useState(card.title ?? '')
  const [rarity, setRarity]     = useState(card.rarity)
  const [cardType, setCardType] = useState(card.card_type)

  // Effects
  const [rows, setRows] = useState<EditEffectRow[]>(() =>
    effects.map(e => ({
      id: e.id,
      effect_name: e.effect_name,
      symbol: e.symbol ?? 'none',
      unlock_level: e.unlock_level,
      values_by_level: e.values_by_level?.join(', ') ?? '',
    }))
  )

  function updateRow(idx: number, patch: Partial<EditEffectRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function addRow() {
    setRows(prev => [...prev, { id: null, effect_name: '', symbol: 'none', unlock_level: 1, values_by_level: '' }])
  }

  function removeRow(idx: number) {
    setRows(prev => {
      const row = prev[idx]
      if (row.id === null) return prev.filter((_, i) => i !== idx)  // unsaved row, just remove
      return prev.map((r, i) => i === idx ? { ...r, _deleted: true } : r)
    })
  }

  async function handleSave() {
    setBusy(true); setError(null)
    try {
      // 1. Update card fields
      const { error: cardErr } = await supabase
        .from('support_cards')
        .update({ name, title: title || null, rarity, card_type: cardType })
        .eq('id', card.id)
      if (cardErr) throw cardErr

      // 2. Handle effect rows
      const toDelete = rows.filter(r => r._deleted && r.id !== null)
      const toUpdate = rows.filter(r => !r._deleted && r.id !== null)
      const toInsert = rows.filter(r => !r._deleted && r.id === null)

      // Delete removed effects
      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from('support_card_effects')
          .delete()
          .in('id', toDelete.map(r => r.id!))
        if (delErr) throw delErr
      }

      // Update existing effects
      for (const row of toUpdate) {
        const vals = row.values_by_level.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
        const { error: upErr } = await supabase
          .from('support_card_effects')
          .update({
            effect_name: row.effect_name,
            symbol: row.symbol,
            unlock_level: row.unlock_level,
            values_by_level: vals,
          })
          .eq('id', row.id!)
        if (upErr) throw upErr
      }

      // Insert new effects
      for (const row of toInsert) {
        if (!row.effect_name.trim()) continue
        const vals = row.values_by_level.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
        const { error: insErr } = await supabase
          .from('support_card_effects')
          .insert({
            card_id: card.id,
            effect_name: row.effect_name,
            symbol: row.symbol,
            unlock_level: row.unlock_level,
            values_by_level: vals,
          })
        if (insErr) throw insErr
      }

      // 3. Re-fetch effects and notify parent
      const { data: freshEffects } = await supabase
        .from('support_card_effects')
        .select('id, effect_name, symbol, unlock_level, values_by_level')
        .eq('card_id', card.id)

      const updatedCard: SupportCard = { ...card, name, title: title || null, rarity, card_type: cardType }
      onSaved(updatedCard, (freshEffects ?? []) as SupportCardEffect[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const visibleRows = rows.filter(r => !r._deleted)

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 16,
      }}
    >
      <div style={{
        background: '#16161e', borderRadius: 16, width: '100%', maxWidth: 640,
        border: '1px solid #2a2a38', boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 32px)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Edit Card #{card.id}</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '4px 6px' }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {/* Card fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div>
              <div style={LABEL_STYLE}>Name</div>
              <input value={name} onChange={e => setName(e.target.value)} style={INPUT_STYLE} />
            </div>
            <div>
              <div style={LABEL_STYLE}>Title</div>
              <input value={title} onChange={e => setTitle(e.target.value)} style={INPUT_STYLE} placeholder="Optional" />
            </div>
            <div>
              <div style={LABEL_STYLE}>Rarity</div>
              <select value={rarity} onChange={e => setRarity(e.target.value)} style={{ ...INPUT_STYLE, cursor: 'pointer' }}>
                {['SSR', 'SR', 'R'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <div style={LABEL_STYLE}>Type</div>
              <select value={cardType} onChange={e => setCardType(e.target.value)} style={{ ...INPUT_STYLE, cursor: 'pointer' }}>
                {CARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Effects */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Effects</span>
            <button
              onClick={addRow}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', cursor: 'pointer', fontSize: 11, padding: '3px 10px' }}
            >+ Add</button>
          </div>

          {visibleRows.length === 0 && (
            <div style={{ color: '#444', fontSize: 13, padding: '8px 0' }}>No effects. Click "+ Add" to create one.</div>
          )}

          {visibleRows.map((row) => {
            const realIdx = rows.indexOf(row)
            return (
              <div key={realIdx} style={{ background: '#1a1a26', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
                  <div>
                    <div style={LABEL_STYLE}>Effect Name</div>
                    <input value={row.effect_name} onChange={e => updateRow(realIdx, { effect_name: e.target.value })} style={INPUT_STYLE} />
                  </div>
                  <div>
                    <div style={LABEL_STYLE}>Symbol</div>
                    <select value={row.symbol} onChange={e => updateRow(realIdx, { symbol: e.target.value })} style={{ ...INPUT_STYLE, width: 90, cursor: 'pointer' }}>
                      {SYMBOL_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={LABEL_STYLE}>Unlock Lv</div>
                    <input
                      type="number" min={0} value={row.unlock_level}
                      onChange={e => updateRow(realIdx, { unlock_level: parseInt(e.target.value, 10) || 0 })}
                      style={{ ...INPUT_STYLE, width: 60, textAlign: 'center' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                  <div style={{ flex: 1 }}>
                    <div style={LABEL_STYLE}>Values by Level (comma-separated)</div>
                    <input
                      value={row.values_by_level}
                      onChange={e => updateRow(realIdx, { values_by_level: e.target.value })}
                      style={INPUT_STYLE}
                      placeholder="e.g. 1, 2, 3, 4, 5"
                    />
                  </div>
                  <button
                    onClick={() => removeRow(realIdx)}
                    title="Delete this effect"
                    style={{ background: 'none', border: '1px solid #4a2020', borderRadius: 6, color: '#f87171', cursor: 'pointer', fontSize: 12, padding: '5px 10px', flexShrink: 0 }}
                  >Delete</button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #222', flexShrink: 0 }}>
          {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #2a2a38', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
            >Cancel</button>
            <button
              onClick={handleSave}
              disabled={busy}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: busy ? '#2a2050' : '#4c3bc0', color: busy ? '#aaa' : '#fff', cursor: busy ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}
            >{busy ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
