import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { AptitudeGrid } from '../components/AptitudeGrid'
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Trainee extends ReleaseMetadata {
  id: number
  name: string
  name_jp: string | null
  title: string | null
  rarity: number   // 1 | 2 | 3
  // Aptitude grades (S/A/B/C/D/E/F/G)
  apt_turf: string | null
  apt_dirt: string | null
  apt_short: string | null
  apt_mile: string | null
  apt_mid: string | null
  apt_long: string | null
  apt_leading: string | null
  apt_stalking: string | null
  apt_mid_pack: string | null
  apt_chasing: string | null
  // Stats arrays: [speed, stamina, power, guts, wisdom]
  stats_base: number[] | null
  stats_two_star: number[] | null
  stats_three_star: number[] | null
  stats_four_star: number[] | null
  stats_five_star: number[] | null
  // stat_growth: percentage bonuses [speed, stamina, power, guts, wisdom]
  stat_growth: number[] | null
  skills_evo: Record<string, unknown> | null
  image_path: string | null
  icon_path: string | null
}

export interface SkillRecord {
  id: number
  name: string
  description: string | null
  icon_url: string | null
  rarity: number | null
  cost: number | null
  upgrade_of: number | null
}

export interface AwakeningSkill {
  trainee_id: number
  awakening_level: number  // 2–5
  skills: SkillRecord | null
}

export interface UniqueSkill {
  trainee_id: number
  sort_order: number
  min_star_rank: number
  skills: SkillRecord | null
}

export interface HintSkill {
  trainee_id: number
  skills: SkillRecord | null
}

interface CollectionEntry {
  star_rank: number
  awakening_level: number
}

export interface TrainingEvent {
  id: number
  trainee_id: number
  name: string
  category: string | null
  sort_order: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`

function getPortraitUrl(trainee: Trainee) {
  const path = trainee.image_path ?? `trainees/art/${trainee.id}.png`
  return `${SUPABASE_STORAGE}/${path}`
}
function getIconUrl(trainee: Trainee) {
  const path = trainee.icon_path ?? `trainees/icons/${trainee.id}.png`
  return `${SUPABASE_STORAGE}/${path}`
}

const STAT_COLORS = ['#60a5fa', '#fb923c', '#f87171', '#fbbf24', '#34d399']
const STAT_MAX = 1200  // approx bar ceiling

function traineeAptitudeMap(t: Trainee): Record<string, string> {
  const m: Record<string, string> = {}
  if (t.apt_turf) m.turf = t.apt_turf
  if (t.apt_dirt) m.dirt = t.apt_dirt
  if (t.apt_short) m.sprint = t.apt_short
  if (t.apt_mile) m.mile = t.apt_mile
  if (t.apt_mid) m.medium = t.apt_mid
  if (t.apt_long) m.long = t.apt_long
  if (t.apt_leading) m.front_runner = t.apt_leading
  if (t.apt_stalking) m.pace_chaser = t.apt_stalking
  if (t.apt_mid_pack) m.late_surger = t.apt_mid_pack
  if (t.apt_chasing) m.end_closer = t.apt_chasing
  return m
}

const RARITY_STYLE: Record<number, { color: string; bg: string }> = {
  1: { color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' },
  2: { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  3: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
}

const STAR_KEYS: Record<number, keyof Trainee> = {
  1: 'stats_base',
  2: 'stats_two_star',
  3: 'stats_three_star',
  4: 'stats_four_star',
  5: 'stats_five_star',
}

function getStatsForRank(trainee: Trainee, rank: number): number[] {
  const val = trainee[STAR_KEYS[rank]] as number[] | null
  return val ?? trainee.stats_base ?? [0, 0, 0, 0, 0]
}


// ─── Micro-components ─────────────────────────────────────────────────────────


// ─── Trainee tile ─────────────────────────────────────────────────────────────

function TraineeTile({ trainee, dimmed, onClick }: { trainee: Trainee; dimmed?: boolean; onClick: () => void }) {
  const [artLoaded, setArtLoaded] = useState(false)
  const shadow = '0 2px 12px rgba(0,0,0,0.5)'
  const hoverShadow = '0 6px 24px rgba(0,0,0,0.7)'
  const rs = RARITY_STYLE[trainee.rarity] ?? RARITY_STYLE[1]

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', borderRadius: 12, overflow: 'hidden',
        background: '#1a1a22', aspectRatio: '3 / 4',
        boxShadow: shadow,
        transition: 'transform 0.15s, box-shadow 0.15s, filter 0.15s',
        cursor: 'pointer',
        filter: dimmed ? 'grayscale(1) brightness(0.4)' : 'none',
      }}
      onMouseEnter={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1.03)'
        d.style.boxShadow = hoverShadow
        if (dimmed) d.style.filter = 'grayscale(0.2) brightness(0.85)'
      }}
      onMouseLeave={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1)'
        d.style.boxShadow = shadow
        if (dimmed) d.style.filter = 'grayscale(1) brightness(0.4)'
      }}
    >
      <img
        src={getPortraitUrl(trainee)} alt={trainee.name}
        onLoad={() => setArtLoaded(true)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', opacity: artLoaded ? 1 : 0, transition: 'opacity 0.3s' }}
      />
      {!artLoaded && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1e1e2a 0%, #2a2a38 50%, #1e1e2a 100%)' }} />
      )}
      {/* Rarity badge */}
      <div style={{
        position: 'absolute', top: 6, left: 6,
        background: rs.bg, border: `1px solid ${rs.color}`,
        borderRadius: 5, padding: '1px 5px',
        fontSize: 10, fontWeight: 700, color: rs.color, lineHeight: 1.5,
      }}>
        {'★'.repeat(trainee.rarity)}
      </div>
      {/* Bottom gradient + name */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '28px 8px 8px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', lineHeight: 1.3, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
          {trainee.name}
        </div>
        {trainee.title && (
          <div style={{ fontSize: 9, color: '#bbb', marginTop: 1, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
            {trainee.title}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Cost badge ───────────────────────────────────────────────────────────────

function CostBadge({ cost }: { cost: number }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, color: '#94a3b8', flexShrink: 0,
      background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.25)',
      borderRadius: 3, padding: '0px 4px', letterSpacing: '0.02em',
    }}>
      {cost} SP
    </span>
  )
}

// ─── Skills tab content ───────────────────────────────────────────────────────

function SkillsTab({ awakening, unique, hint, potentialLevel }: {
  awakening: AwakeningSkill[]
  unique: UniqueSkill[]
  hint: HintSkill[]
  potentialLevel: number
}) {
  const visibleAwakening = awakening.filter(s => s.awakening_level <= potentialLevel)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Awakening skills */}
      <section>
        <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
          Awakening Skills
        </div>
        {visibleAwakening.length === 0
          ? <div style={{ fontSize: 12, color: '#333' }}>None</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {visibleAwakening.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', background: '#1a1a26', borderRadius: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#a78bfa', flexShrink: 0,
                    background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)',
                    borderRadius: 4, padding: '1px 5px', marginTop: 1,
                  }}>
                    {s.awakening_level}★
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 12, color: '#ccc' }}>{s.skills?.name}</span>
                      {s.skills?.cost != null && <CostBadge cost={s.skills.cost} />}
                    </div>
                    {s.skills?.description && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{s.skills.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* Unique skills */}
      <section>
        <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
          Unique Skills
        </div>
        {unique.length === 0
          ? <div style={{ fontSize: 12, color: '#333' }}>None</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {unique.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', background: '#1a1a26', borderRadius: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#fbbf24', flexShrink: 0,
                    background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)',
                    borderRadius: 4, padding: '1px 5px', marginTop: 1,
                  }}>
                    {s.min_star_rank}★+
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 12, color: '#ccc' }}>{s.skills?.name}</span>
                      <CostBadge cost={180} />
                    </div>
                    {s.skills?.description && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{s.skills.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* Hint skills */}
      <section>
        <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
          Hint Skills
        </div>
        {hint.length === 0
          ? <div style={{ fontSize: 12, color: '#333' }}>None</div>
          : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {hint.map((s, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, color: '#aaa',
                  background: '#1a1a26', border: '1px solid #2a2a38',
                  borderRadius: 5, padding: '3px 8px',
                }}>
                  {s.skills?.name}
                  {s.skills?.cost != null && <CostBadge cost={s.skills.cost} />}
                </span>
              ))}
            </div>
          )}
      </section>

    </div>
  )
}

// ─── Events tab content ───────────────────────────────────────────────────────

function EventsTab({ events }: { events: TrainingEvent[] }) {
  if (events.length === 0) {
    return <div style={{ fontSize: 12, color: '#333' }}>No career events.</div>
  }

  // Group by category
  const order: string[] = []
  const grouped: Record<string, TrainingEvent[]> = {}
  for (const ev of events) {
    const cat = ev.category ?? 'Other'
    if (!grouped[cat]) { grouped[cat] = []; order.push(cat) }
    grouped[cat].push(ev)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {order.map(cat => (
        <div key={cat}>
          <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>
            {cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {grouped[cat].map(ev => (
              <div key={ev.id} style={{
                padding: '6px 10px', background: '#1a1a26', borderRadius: 6,
                fontSize: 12, color: '#bbb',
              }}>
                {ev.name}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Trainee modal ────────────────────────────────────────────────────────────

const STAT_SHORT = ['Spd', 'Stm', 'Pwr', 'Guts', 'Wit']

function TraineeModal({ trainee, onClose, onCollectionChange, initialTab, initialRank, initialPot, onTabChange, onRankChange, onPotChange }: {
  trainee: Trainee
  onClose: () => void
  onCollectionChange?: () => void
  initialTab?: 'skills' | 'events'
  initialRank?: number
  initialPot?: number
  onTabChange?: (tab: 'skills' | 'events') => void
  onRankChange?: (rank: number) => void
  onPotChange?: (pot: number) => void
}) {
  const { user } = useAuth()
  const [starRank, setStarRank] = useState(initialRank ?? trainee.rarity)
  const [potentialLevel, setPotentialLevel] = useState(initialPot ?? 1)
  const [activeTab, setActiveTab] = useState<'skills' | 'events'>(initialTab ?? 'skills')

  const changeStarRank = useCallback((r: number) => { setStarRank(r); onRankChange?.(r) }, [onRankChange])
  const changePotentialLevel = useCallback((l: number) => { setPotentialLevel(l); onPotChange?.(l) }, [onPotChange])
  const changeActiveTab = useCallback((t: 'skills' | 'events') => { setActiveTab(t); onTabChange?.(t) }, [onTabChange])

  const [awakening, setAwakening] = useState<AwakeningSkill[]>([])
  const [unique, setUnique] = useState<UniqueSkill[]>([])
  const [hint, setHint] = useState<HintSkill[]>([])
  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [collectionEntry, setCollectionEntry] = useState<CollectionEntry | null>(null)
  const [saving, setSaving] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const stats = getStatsForRank(trainee, starRank)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const id = trainee.id
    supabase
      .from('trainee_awakening_skills')
      .select('awakening_level, skills(id, name, description, icon_url, rarity, cost, upgrade_of)')
      .eq('trainee_id', id)
      .order('awakening_level')
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('trainee_awakening_skills:', error.message)
          setAwakening([])
          return
        }
        setAwakening((data ?? []) as unknown as AwakeningSkill[])
      })
    supabase
      .from('trainee_unique_skills')
      .select('sort_order, min_star_rank, skills(id, name, description, icon_url, rarity, cost, upgrade_of)')
      .eq('trainee_id', id)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('trainee_unique_skills:', error.message)
          setUnique([])
          return
        }
        setUnique((data ?? []) as unknown as UniqueSkill[])
      })
    supabase
      .from('trainee_hint_skills')
      .select('skills(id, name, description, icon_url, rarity, cost, upgrade_of)')
      .eq('trainee_id', id)
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('trainee_hint_skills:', error.message)
          setHint([])
          return
        }
        setHint((data ?? []) as unknown as HintSkill[])
      })
    supabase
      .from('trainee_training_events')
      .select('*')
      .eq('trainee_id', id)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) {
          if (!isMissingTableError(error)) console.warn('trainee_training_events:', error.message)
          setEvents([])
          return
        }
        setEvents((data ?? []) as TrainingEvent[])
      })
  }, [trainee.id])

  // Load existing collection entry for this trainee (deps: trainee + user only — URL sync
  // callbacks must stay stable from the parent or this re-runs every render and fights closeModal.)
  useEffect(() => {
    if (!user) { return }
    let cancelled = false
    supabase
      .from('user_trainee_collection')
      .select('star_rank, awakening_level')
      .eq('user_id', user.id)
      .eq('trainee_id', trainee.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          setCollectionEntry(data as CollectionEntry)
          changeStarRank(data.star_rank)
          changePotentialLevel(data.awakening_level)
        } else {
          setCollectionEntry(null)
        }
      })
    return () => { cancelled = true }
  }, [trainee.id, user, changeStarRank, changePotentialLevel])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    const { error } = await supabase
      .from('user_trainee_collection')
      .upsert(
        { user_id: user.id, trainee_id: trainee.id, star_rank: starRank, awakening_level: potentialLevel },
        { onConflict: 'user_id,trainee_id' }
      )
    if (!error) { setCollectionEntry({ star_rank: starRank, awakening_level: potentialLevel }); onCollectionChange?.() }
    setSaving(false)
  }

  async function handleRemove() {
    if (!user) return
    setSaving(true)
    const { error } = await supabase
      .from('user_trainee_collection')
      .delete()
      .eq('user_id', user.id)
      .eq('trainee_id', trainee.id)
    if (!error) { setCollectionEntry(null); onCollectionChange?.() }
    setSaving(false)
  }

  return (
    <>
      {/* ── Overlay ── */}
      <div
        ref={overlayRef}
        onPointerDown={e => {
          if (e.target !== overlayRef.current) return
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          zIndex: 100, padding: 16, overflowY: 'auto',
        }}
      >
        <div style={{
          background: '#16161e', borderRadius: 16, width: '100%', maxWidth: 480,
          border: '1px solid #2a2a38', boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100dvh - 32px)', overflow: 'hidden',
          margin: 'auto',
        }}>

          {/* ── 1. Hero image ── */}
          <div style={{ position: 'relative', height: 'min(260px, 38dvh)', flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', height: '100%' }}>
              <img
                src={getPortraitUrl(trainee)} alt={trainee.name}
                style={{ float: 'left', height: '100%', width: 'auto', objectFit: 'contain', objectPosition: 'top left', display: 'block', WebkitMaskImage: 'linear-gradient(to right, black 55%, transparent 100%)', maskImage: 'linear-gradient(to right, black 55%, transparent 100%)' }}
              />
            </div>
            {/* Fade into modal bg at bottom */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #16161e 0%, rgba(22,22,30,0.55) 38%, transparent 65%)' }} />
            {/* Top vignette for button legibility */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 28%)' }} />

            {/* Close — top-left */}
            <button
              onClick={onClose}
              style={{
                position: 'absolute', top: 10, left: 10,
                width: 30, height: 30, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                color: '#ccc', cursor: 'pointer', fontSize: 18, lineHeight: 1,
              }}
            >×</button>

            {/* Top-right: text + icon, stars below */}
            <div style={{ position: 'absolute', top: 10, right: 14, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <div style={{ textAlign: 'right' }}>
                  {trainee.title && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                      [{trainee.title}]
                    </div>
                  )}
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.9)', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
                    {trainee.name}
                  </div>
                  {hasReleaseInfo(trainee) && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 6, textAlign: 'right', lineHeight: 1.45 }}>
                      {releaseSummaryLines(trainee).map(line => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
                <img src={getIconUrl(trainee)} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1, 2, 3, 4, 5].map(r => (
                  <span key={r} style={{ fontSize: 28, lineHeight: 1, color: r <= starRank ? '#fbbf24' : 'rgba(255,255,255,0.2)', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>★</span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                Potential Lv. {potentialLevel}
              </div>
            </div>

            {/* Bottom-right: edit + save buttons */}
            {user && (
              <div style={{ position: 'absolute', bottom: 14, right: 14, display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setEditOpen(true)}
                  style={{
                    width: 34, height: 34, padding: 0, borderRadius: 7,
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    color: '#ccc', cursor: 'pointer', fontSize: 15,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >✎</button>
                {collectionEntry ? (
                  <button
                    onClick={handleRemove}
                    disabled={saving}
                    style={{
                      padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                      background: saving ? '#1e1e2a' : 'rgba(248,113,113,0.12)',
                      border: `1px solid ${saving ? '#2a2a38' : 'rgba(248,113,113,0.4)'}`,
                      color: saving ? '#444' : '#f87171', cursor: saving ? 'default' : 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {saving ? 'Removing…' : 'Remove'}
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                      background: saving ? '#1e1e2a' : 'rgba(167,139,250,0.22)',
                      border: `1px solid ${saving ? '#2a2a38' : '#a78bfa55'}`,
                      color: saving ? '#444' : '#a78bfa', cursor: saving ? 'default' : 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {saving ? 'Saving…' : 'Add to Collection'}
                  </button>
                )}
              </div>
            )}

            {/* Edit overlay */}
            {editOpen && (
              <div
                onClick={() => setEditOpen(false)}
                style={{
                  position: 'fixed', inset: 0, zIndex: 100,
                  background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: '#16161e', border: '1px solid #2a2a38', borderRadius: 16,
                    padding: '28px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
                    minWidth: 240,
                  }}
                >
                  <img src={getIconUrl(trainee)} alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />
                  {trainee.title && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>[{trainee.title}]</div>
                  )}
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: -12 }}>{trainee.name}</div>

                  {/* Star rank */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Star Rank</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button onClick={() => changeStarRank(Math.max(1, starRank - 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        −
                      </button>
                      <div style={{ display: 'flex', gap: 3, width: 112, justifyContent: 'center' }}>
                        {[1, 2, 3, 4, 5].map(r => (
                          <svg key={r} width="20" height="20" viewBox="0 0 24 24" fill={r <= starRank ? '#fbbf24' : 'none'} stroke={r <= starRank ? '#fbbf24' : '#2a2a38'} strokeWidth="2" strokeLinejoin="round">
                            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                          </svg>
                        ))}
                      </div>
                      <button onClick={() => changeStarRank(Math.min(5, starRank + 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        +
                      </button>
                    </div>
                  </div>

                  {/* Potential level */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Potential Level</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button onClick={() => changePotentialLevel(Math.max(1, potentialLevel - 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        −
                      </button>
                      <span style={{ fontSize: 22, color: '#a78bfa', width: 112, textAlign: 'center', display: 'inline-block' }}>{potentialLevel}</span>
                      <button onClick={() => changePotentialLevel(Math.min(5, potentialLevel + 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        +
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      if (collectionEntry) await handleSave()
                      setEditOpen(false)
                    }}
                    style={{
                      width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: 'rgba(167,139,250,0.18)', border: '1px solid #a78bfa55',
                      color: '#a78bfa', cursor: 'pointer',
                    }}
                  >Done</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Scrollable content ── */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

            {/* ── 2. Stats table ── */}
            <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #1a1a22' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    {STAT_SHORT.map((name, i) => (
                      <th key={name} style={{
                        textAlign: 'center', fontSize: 9, fontWeight: 700,
                        color: STAT_COLORS[i], letterSpacing: '0.06em', textTransform: 'uppercase',
                        paddingBottom: 6, borderBottom: `1px solid ${STAT_COLORS[i]}28`,
                      }}>
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Values */}
                  <tr>
                    {stats.map((val, i) => (
                      <td key={i} style={{ textAlign: 'center', paddingTop: 8, paddingBottom: 2 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: STAT_COLORS[i], lineHeight: 1 }}>{val}</span>
                      </td>
                    ))}
                  </tr>
                  {/* Mini bars */}
                  <tr>
                    {stats.map((val, i) => (
                      <td key={i} style={{ padding: '4px 6px 3px' }}>
                        <div style={{ height: 3, background: '#1e1e28', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min((val / STAT_MAX) * 100, 100)}%`,
                            height: '100%', background: STAT_COLORS[i], borderRadius: 2,
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                      </td>
                    ))}
                  </tr>
                  {/* Growth % */}
                  {trainee.stat_growth && (
                    <tr>
                      {trainee.stat_growth.map((val, i) => (
                        <td key={i} style={{ textAlign: 'center', paddingTop: 3, paddingBottom: 2 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            color: val > 0 ? STAT_COLORS[i] : val < 0 ? '#f87171' : '#333',
                          }}>
                            {val > 0 ? '+' : ''}{val}%
                          </span>
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── 3. Aptitudes ── */}
            <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #1a1a22' }}>
              <AptitudeGrid aptitudes={traineeAptitudeMap(trainee)} />
            </div>

            {/* ── 4. Skills + Career Events tabs ── */}
            <div style={{ borderBottom: '1px solid #1a1a22' }}>
              <div style={{ display: 'flex' }}>
                {(['skills', 'events'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => changeActiveTab(tab)}
                    style={{
                      flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                      padding: '10px 14px 9px', fontSize: 12,
                      fontWeight: activeTab === tab ? 600 : 400,
                      color: activeTab === tab ? '#e5e5e5' : '#555',
                      borderBottom: `2px solid ${activeTab === tab ? '#a78bfa' : 'transparent'}`,
                      transition: 'color 0.15s', marginBottom: -1,
                    }}
                  >
                    {tab === 'skills' ? 'Skills' : 'Career Events'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '14px 16px 24px' }}>
              {activeTab === 'skills' && <SkillsTab awakening={awakening} unique={unique} hint={hint} potentialLevel={potentialLevel} />}
              {activeTab === 'events' && <EventsTab events={events} />}
            </div>

          </div>

        </div>
      </div>

    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Trainees() {
  const { user } = useAuth()
  const { region: regionFilter, setRegion: setRegionFilter, searchParams, setSearchParams } =
    useRegionSearchParam()
  const [trainees, setTrainees] = useState<Trainee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const sort = (searchParams.get('sort') ?? 'name-asc') as 'name-asc' | 'name-desc' | 'rarity'

  function setSort(value: 'name-asc' | 'name-desc' | 'rarity') {
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      if (value === 'name-asc') n.delete('sort')
      else n.set('sort', value)
      return n
    }, { replace: true })
  }
  const [selectedRarity, setSelectedRarity] = useState<number | null>(null)
  const [cardSize, setCardSize] = useState(110)
  const collectionMode = searchParams.get('collection') === '1'

  const paramId = searchParams.get('trainee')
  const modalTrainee = useMemo(() => {
    if (!paramId || trainees.length === 0) return null
    return trainees.find(t => String(t.id) === paramId) ?? null
  }, [paramId, trainees])

  const syncTraineeTabToUrl = useCallback((tab: 'skills' | 'events') => {
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      n.set('tab', tab)
      return n
    }, { replace: true })
  }, [setSearchParams])

  const syncTraineeRankToUrl = useCallback((rank: number) => {
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      n.set('rank', String(rank))
      return n
    }, { replace: true })
  }, [setSearchParams])

  const syncTraineePotToUrl = useCallback((pot: number) => {
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      n.set('pot', String(pot))
      return n
    }, { replace: true })
  }, [setSearchParams])

  function toggleCollectionMode() {
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      if (collectionMode) { n.delete('collection'); n.delete('unowned') }
      else n.set('collection', '1')
      return n
    }, { replace: true })
  }
  const todayIso = todayIsoDateLocal()

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
  const [collectionIds, setCollectionIds] = useState<Set<number> | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    supabase
      .from('trainees')
      .select('*')
      .order('id', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setTrainees((data ?? []) as Trainee[])
        setLoading(false)
      })
  }, [])

  const refreshCollection = useCallback(() => {
    if (!user) return
    supabase
      .from('user_trainee_collection')
      .select('trainee_id')
      .then(({ data }) => {
        setCollectionIds(new Set((data ?? []).map((r: { trainee_id: number }) => r.trainee_id)))
      })
  }, [user])

  useEffect(() => {
    if (collectionMode && user) {
      refreshCollection()
    }
  }, [collectionMode, user, refreshCollection])

  const openModal = useCallback((t: Trainee) => {
    setSearchParams(p => {
      const n = new URLSearchParams(p)
      n.set('trainee', String(t.id))
      if (!n.has('tab')) n.set('tab', 'skills')
      if (!n.has('rank')) n.set('rank', String(t.rarity))
      if (!n.has('pot')) n.set('pot', '1')
      return n
    }, { replace: true })
  }, [setSearchParams])

  const closeModal = useCallback(() => {
    // Defer clearing ?trainee= so the gesture that closed the modal cannot retarget
    // the grid tile and reopen (pointerdown + next frame is more reliable than click).
    setTimeout(() => {
      setSearchParams(p => {
        const n = new URLSearchParams(p)
        n.delete('trainee')
        n.delete('tab')
        n.delete('rank')
        n.delete('pot')
        return n
      }, { replace: true })
    }, 50)
  }, [setSearchParams])

  function handleSearchChange(value: string) {
    setSearch(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchParams(p => {
        const n = new URLSearchParams(p)
        if (value) n.set('q', value)
        else n.delete('q')
        return n
      }, { replace: true })
    }, 300)
  }

  const filtered = trainees
    .filter(t => {
      if (selectedRarity !== null && t.rarity !== selectedRarity) return false
      if (search) {
        const q = search.toLowerCase()
        if (!t.name.toLowerCase().includes(q) && !(t.name_jp ?? '').toLowerCase().includes(q)) return false
      }
      if (collectionMode && !unownedMode && user && collectionIds !== null && !collectionIds.has(t.id)) return false
      if (!passesRegionAvailabilityFilter(regionFilter, t.released_jp, t.released_global, todayIso)) return false
      return true
    })
    .sort((a, b) => {
      if (sort === 'rarity') return b.rarity - a.rarity || a.name.localeCompare(b.name)
      if (sort === 'name-desc') return b.name.localeCompare(a.name)
      return a.name.localeCompare(b.name)
    })

  return (
    <CatalogShell>
      <CatalogHeader title="Trainees" />

      {/* Filters */}
      <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid #1a1a1a' }}>
        <input
          type="text" placeholder="Search…" value={search}
          onChange={e => handleSearchChange(e.target.value)}
          style={{
            background: '#1a1a22', border: '1px solid #2a2a38', borderRadius: 8,
            padding: '5px 10px', color: '#fff', fontSize: 12, outline: 'none', width: 160,
          }}
        />
        <RegionFilter value={regionFilter} onChange={setRegionFilter} />
        <div style={{ display: 'flex', gap: 4 }}>
          {([null, 1, 2, 3] as const).map(r => {
            const rs = r !== null ? RARITY_STYLE[r] : null
            return (
              <FilterPill
                key={r ?? 'all'}
                active={selectedRarity === r}
                activeColor={rs?.color ?? '#ccc'}
                activeBg={rs?.bg ?? 'rgba(255,255,255,0.05)'}
                activeBorder={rs?.color ?? '#888'}
                onClick={() => setSelectedRarity(r)}
              >
                {r === null ? 'All' : '★'.repeat(r)}
              </FilterPill>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['name-asc', 'A→Z'], ['name-desc', 'Z→A'], ['rarity', '★ Rarity']] as const).map(([val, label]) => (
            <FilterPill
              key={val}
              active={sort === val}
              onClick={() => setSort(val)}
            >
              {label}
            </FilterPill>
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
          min={70} max={200}
          count={filtered.length}
          ownedCount={collectionMode && user && collectionIds !== null ? collectionIds.size : undefined}
        />
      </div>

      {/* Block pointer events to grid while modal open so nothing underneath steals the closing gesture. */}
      <div style={{ pointerEvents: modalTrainee ? 'none' : 'auto' }}>
        <CatalogGrid loading={loading} error={error} emptyMessage="No trainees found." cardSize={cardSize}>
          {filtered.map(t => (
            <TraineeTile
              key={t.id}
              trainee={t}
              dimmed={collectionMode && unownedMode && !!user && collectionIds !== null && !collectionIds.has(t.id)}
              onClick={() => openModal(t)}
            />
          ))}
        </CatalogGrid>
      </div>

      {modalTrainee && (
        <TraineeModal
          trainee={modalTrainee}
          onClose={closeModal}
          onCollectionChange={refreshCollection}
          initialTab={(searchParams.get('tab') as 'skills' | 'events') ?? 'skills'}
          initialRank={Number(searchParams.get('rank')) || modalTrainee.rarity}
          initialPot={Number(searchParams.get('pot')) || 1}
          onTabChange={syncTraineeTabToUrl}
          onRankChange={syncTraineeRankToUrl}
          onPotChange={syncTraineePotToUrl}
        />
      )}
    </CatalogShell>
  )
}
