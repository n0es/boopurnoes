import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Trainee {
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
const STAT_MAX    = 1200  // approx bar ceiling

const GRADE_STYLE: Record<string, { color: string; bg: string }> = {
  S: { color: '#fbbf24', bg: 'rgba(251,191,36,0.18)' },
  A: { color: '#f87171', bg: 'rgba(248,113,113,0.18)' },
  B: { color: '#fb923c', bg: 'rgba(251,146,60,0.18)' },
  C: { color: '#a3e635', bg: 'rgba(163,230,53,0.18)' },
  D: { color: '#60a5fa', bg: 'rgba(96,165,250,0.18)' },
  E: { color: '#9ca3af', bg: 'rgba(156,163,175,0.18)' },
  F: { color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  G: { color: '#4b5563', bg: 'rgba(75,85,99,0.15)' },
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

function TraineeTile({ trainee, onClick }: { trainee: Trainee; onClick: () => void }) {
  const [artLoaded, setArtLoaded] = useState(false)
  const shadow      = '0 2px 12px rgba(0,0,0,0.5)'
  const hoverShadow = '0 6px 24px rgba(0,0,0,0.7)'
  const rs = RARITY_STYLE[trainee.rarity] ?? RARITY_STYLE[1]

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', borderRadius: 12, overflow: 'hidden',
        background: '#1a1a22', aspectRatio: '3 / 4',
        boxShadow: shadow,
        transition: 'transform 0.15s, box-shadow 0.15s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1.03)'
        d.style.boxShadow = hoverShadow
      }}
      onMouseLeave={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1)'
        d.style.boxShadow = shadow
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
        {trainee.name_jp && (
          <div style={{ fontSize: 9, color: '#bbb', marginTop: 1, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
            {trainee.name_jp}
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

function TraineeModal({ trainee, onClose }: { trainee: Trainee; onClose: () => void }) {
  const { user }                          = useAuth()
  const [starRank, setStarRank]           = useState(trainee.rarity)
  const [potentialLevel, setPotentialLevel] = useState(1)
  const [activeTab, setActiveTab]         = useState<'skills' | 'events'>('skills')
  const [awakening, setAwakening]         = useState<AwakeningSkill[]>([])
  const [unique, setUnique]               = useState<UniqueSkill[]>([])
  const [hint, setHint]                   = useState<HintSkill[]>([])
  const [events, setEvents]               = useState<TrainingEvent[]>([])
  const [collectionEntry, setCollectionEntry] = useState<CollectionEntry | null>(null)
  const [saving, setSaving]               = useState(false)
  const [editOpen, setEditOpen]           = useState(false)
  const overlayRef  = useRef<HTMLDivElement>(null)

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
    Promise.all([
      supabase.from('trainee_awakening_skills').select('awakening_level, skills(id, name, description, icon_url, rarity, cost, upgrade_of)').eq('trainee_id', id).order('awakening_level'),
      supabase.from('trainee_unique_skills').select('sort_order, min_star_rank, skills(id, name, description, icon_url, rarity, cost, upgrade_of)').eq('trainee_id', id).order('sort_order'),
      supabase.from('trainee_hint_skills').select('skills(id, name, description, icon_url, rarity, cost, upgrade_of)').eq('trainee_id', id),
      supabase.from('trainee_training_events').select('*').eq('trainee_id', id).order('sort_order'),
    ]).then(([awk, uniq, ht, ev]) => {
      setAwakening((awk.data ?? []) as unknown as AwakeningSkill[])
      setUnique((uniq.data ?? []) as unknown as UniqueSkill[])
      setHint((ht.data ?? []) as unknown as HintSkill[])
      setEvents((ev.data ?? []) as TrainingEvent[])
    })
  }, [trainee.id])

  // Load existing collection entry for this trainee
  useEffect(() => {
    if (!user) { setCollectionEntry(null); return }
    supabase
      .from('user_trainee_collection')
      .select('star_rank, awakening_level')
      .eq('user_id', user.id)
      .eq('trainee_id', trainee.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCollectionEntry(data as CollectionEntry)
          setStarRank(data.star_rank)
          setPotentialLevel(data.awakening_level)
        } else {
          setCollectionEntry(null)
        }
      })
  }, [trainee.id, user])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    const { error } = await supabase
      .from('user_trainee_collection')
      .upsert(
        { user_id: user.id, trainee_id: trainee.id, star_rank: starRank, awakening_level: potentialLevel },
        { onConflict: 'user_id,trainee_id' }
      )
    if (!error) setCollectionEntry({ star_rank: starRank, awakening_level: potentialLevel })
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
    if (!error) setCollectionEntry(null)
    setSaving(false)
  }

  return (
    <>
      {/* ── Overlay ── */}
      <div
        ref={overlayRef}
        onClick={e => { if (e.target === overlayRef.current) onClose() }}
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
                style={{ float: 'left', height: '100%', width: 'auto', objectFit: 'contain', objectPosition: 'top left', display: 'block' }}
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
                </div>
                <img src={getIconUrl(trainee)} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1,2,3,4,5].map(r => (
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
                      <button onClick={() => setStarRank(r => Math.max(1, r - 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        −
                      </button>
                      <div style={{ display: 'flex', gap: 3, width: 112, justifyContent: 'center' }}>
                        {[1,2,3,4,5].map(r => (
                          <svg key={r} width="20" height="20" viewBox="0 0 24 24" fill={r <= starRank ? '#fbbf24' : 'none'} stroke={r <= starRank ? '#fbbf24' : '#2a2a38'} strokeWidth="2" strokeLinejoin="round">
                            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                          </svg>
                        ))}
                      </div>
                      <button onClick={() => setStarRank(r => Math.min(5, r + 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        +
                      </button>
                    </div>
                  </div>

                  {/* Potential level */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Potential Level</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button onClick={() => setPotentialLevel(l => Math.max(1, l - 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        −
                      </button>
                      <span style={{ fontSize: 22, color: '#a78bfa', width: 112, textAlign: 'center', display: 'inline-block' }}>{potentialLevel}</span>
                      <button onClick={() => setPotentialLevel(l => Math.min(5, l + 1))} style={{ width: 28, height: 28, borderRadius: 6, background: '#1a1a26', border: '1px solid #2a2a38', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #1a1a22', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {([
                ['Track',    [['Turf', trainee.apt_turf], ['Dirt', trainee.apt_dirt]]],
                ['Distance', [['Sprint', trainee.apt_short], ['Mile', trainee.apt_mile], ['Medium', trainee.apt_mid], ['Long', trainee.apt_long]]],
                ['Style',    [['Front', trainee.apt_leading], ['Pace', trainee.apt_stalking], ['Late', trainee.apt_mid_pack], ['End', trainee.apt_chasing]]],
              ] as [string, [string, string | null][]][]).map(([rowLabel, items]) => (
                <div key={rowLabel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#555', width: 54, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>{rowLabel}</span>
                  <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                    {items.map(([label, grade]) => {
                      const gs = grade ? (GRADE_STYLE[grade.toUpperCase()] ?? GRADE_STYLE['G']) : null
                      return (
                        <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '5px 4px', background: gs?.bg ?? 'rgba(255,255,255,0.04)', border: `1px solid ${gs?.color ?? '#333'}`, borderRadius: 6, boxSizing: 'border-box' }}>
                          <span style={{ fontSize: 9, color: gs?.color ?? '#555', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1, textAlign: 'center' }}>{label}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: gs?.color ?? '#444', lineHeight: 1, textAlign: 'center' }}>{grade?.toUpperCase() ?? '—'}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* ── 4. Skills + Career Events tabs ── */}
            <div style={{ borderBottom: '1px solid #1a1a22' }}>
              <div style={{ display: 'flex' }}>
                {(['skills', 'events'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
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
  const [trainees, setTrainees]           = useState<Trainee[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [search, setSearch]               = useState('')
  const [selectedRarity, setSelectedRarity] = useState<number | null>(null)
  const [modalTrainee, setModalTrainee]   = useState<Trainee | null>(null)
  const [cardSize, setCardSize]           = useState(110)

  // Expand root to full width (same pattern as SupportCards)
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => {
      if (root) { root.style.maxWidth = ''; root.style.padding = '' }
    }
  }, [])

  useEffect(() => {
    setLoading(true)
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

  const filtered = trainees.filter(t => {
    if (selectedRarity !== null && t.rarity !== selectedRarity) return false
    if (search) {
      const q = search.toLowerCase()
      if (!t.name.toLowerCase().includes(q) && !(t.name_jp ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>

      {/* Toolbar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #1a1a1a',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#666', letterSpacing: '0.06em', marginRight: 4 }}>
          Trainees
        </span>

        {/* Search */}
        <input
          type="text" placeholder="Search…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#1a1a22', border: '1px solid #2a2a38', borderRadius: 8,
            padding: '5px 10px', color: '#fff', fontSize: 12, outline: 'none', width: 160,
          }}
        />

        {/* Rarity filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([null, 1, 2, 3] as const).map(r => {
            const rs = r !== null ? RARITY_STYLE[r] : null
            const active = selectedRarity === r
            return (
              <button
                key={r ?? 'all'}
                onClick={() => setSelectedRarity(r)}
                style={{
                  borderRadius: 20, padding: '4px 10px',
                  border: active ? `1px solid ${rs?.color ?? '#888'}` : '1px solid #2a2a38',
                  background: active ? (rs?.bg ?? 'rgba(255,255,255,0.05)') : 'transparent',
                  color: active ? (rs?.color ?? '#ccc') : '#555',
                  cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                {r === null ? 'All' : '★'.repeat(r)}
              </button>
            )
          })}
        </div>

        {/* Size slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 10, color: '#444' }}>Size</span>
          <input
            type="range" min={70} max={200} value={cardSize}
            onChange={e => setCardSize(Number(e.target.value))}
            style={{ width: 70, accentColor: '#a78bfa' }}
          />
        </div>

        {/* Count */}
        <div style={{ fontSize: 11, color: '#333' }}>
          {filtered.length} trainee{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Grid */}
      <div style={{ padding: 16 }}>
        {loading && (
          <div style={{ color: '#444', fontSize: 13, padding: 40, textAlign: 'center' }}>Loading…</div>
        )}
        {error && (
          <div style={{ color: '#ef4444', fontSize: 13, padding: 40, textAlign: 'center' }}>{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ color: '#444', fontSize: 13, padding: 40, textAlign: 'center' }}>No trainees found.</div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardSize}px, 100%), 1fr))`,
            gap: 8,
          }}>
            {filtered.map(t => (
              <TraineeTile key={t.id} trainee={t} onClick={() => setModalTrainee(t)} />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalTrainee && (
        <TraineeModal trainee={modalTrainee} onClose={() => setModalTrainee(null)} />
      )}
    </div>
  )
}
