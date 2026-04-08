/**
 * TraineeStatsPanel — full snapshot view of trainee state at a timeline position.
 * Controlled by the timeline slider; shows stats, resources, aptitudes, hints,
 * learned skills, items, conditions, and support card friendship.
 */

import type { TurnSnapshot, StatBlock, LearnedSkill, HeldItem } from '../lib/careerSessionApi'
import { StatChangeGrid } from './StatChangeGrid'
import { UMA_STAT_COLORS } from '../lib/umaStatDisplay'
import { AptitudeGrid } from './AptitudeGrid'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CardSlotInfo {
  card_id: number
  level: number
  name: string
  card_type: string
  rarity: string
}

export interface TraineeStatsPanelProps {
  snapshot: TurnSnapshot | null
  traineeName?: string
  traineeTitle?: string
  traineeArtUrl?: string
  cardInfo?: CardSlotInfo[]
  blueInheritance?: StatBlock | null
  isInitial?: boolean
  loading?: boolean
  skillNameById?: Record<number, string>
  supabaseStorageUrl?: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STAT_KEYS: (keyof StatBlock)[] = ['speed', 'stamina', 'power', 'guts', 'wisdom']
const STAT_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom']

const MOOD_LABELS: Record<string, { label: string; color: string }> = {
  very_good: { label: 'Very Good', color: '#4ade80' },
  good: { label: 'Good', color: '#86efac' },
  normal: { label: 'Normal', color: '#fbbf24' },
  bad: { label: 'Bad', color: '#fb923c' },
  very_bad: { label: 'Very Bad', color: '#f87171' },
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TraineeStatsPanel({
  snapshot,
  traineeName,
  traineeTitle,
  traineeArtUrl,
  cardInfo,
  blueInheritance,
  isInitial = false,
  loading = false,
  skillNameById,
  supabaseStorageUrl,
}: TraineeStatsPanelProps) {
  if (!snapshot) return null

  const moodInfo = MOOD_LABELS[snapshot.mood] ?? { label: snapshot.mood, color: '#a1a1aa' }
  const statTotal = STAT_KEYS.reduce((acc, k) => acc + snapshot.stats[k], 0)

  const blueDeltas = isInitial && blueInheritance
    ? STAT_KEYS.map(k => blueInheritance[k])
    : null

  const hints = Object.entries(snapshot.hint_levels)
  const skills: LearnedSkill[] = snapshot.learned_skills ?? []
  const items: HeldItem[] = snapshot.items ?? []
  const hasAptitudes = snapshot.aptitudes && Object.keys(snapshot.aptitudes).length > 0

  const getCardIconUrl = (cardId: number) =>
    supabaseStorageUrl ? `${supabaseStorageUrl}/supports/icons/${cardId}.png` : ''
  const getTypeIconUrl = (cardType: string) =>
    supabaseStorageUrl ? `${supabaseStorageUrl}/icons/${cardType}.png` : ''

  return (
    <div style={{
      background: 'rgba(24, 24, 27, 0.95)',
      borderRadius: 16,
      padding: '1.25rem',
      border: '1px solid rgba(255,255,255,0.08)',
      opacity: loading ? 0.6 : 1,
      transition: 'opacity 0.15s',
    }}>
      {/* Trainee header */}
      {traineeName && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          marginBottom: '1rem',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          {traineeArtUrl && (
            <img
              src={traineeArtUrl}
              alt=""
              style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }}
              onError={e => (e.currentTarget.style.display = 'none')}
            />
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#e4e4e7' }}>{traineeName}</div>
            {traineeTitle && (
              <div style={{ fontSize: '0.72rem', color: '#71717a' }}>{traineeTitle}</div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#e4e4e7' }}>{Math.round(statTotal)}</div>
            <div style={{ fontSize: '0.65rem', color: '#71717a' }}>Total Stats</div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      {isInitial && blueDeltas && blueDeltas.some(d => Math.abs(d) >= 0.5) && (
        <div style={{
          fontSize: '0.68rem', color: '#60a5fa', fontWeight: 700,
          marginBottom: '0.3rem', letterSpacing: '0.02em',
        }}>
          Blue inheritance shown as +gains (applied in 1st spark)
        </div>
      )}
      <StatChangeGrid
        values={STAT_KEYS.map(k => snapshot.stats[k])}
        deltas={blueDeltas}
        density="comfortable"
        emphasizeNonZeroDelta
        cellTone="perStat"
        style={{ marginBottom: '0.75rem' }}
      />

      {/* Resources row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem',
        marginBottom: '0.75rem',
      }}>
        <ResourceBadge label="SP" value={Math.round(snapshot.skill_points)} color="#c084fc" />
        <ResourceBadge label="Energy" value={Math.round(snapshot.energy)} color="#22d3ee" />
        <ResourceBadge label="Mood" value={moodInfo.label} color={moodInfo.color} />
        <ResourceBadge label="Fans" value={snapshot.total_fans >= 1000 ? `${(snapshot.total_fans / 1000).toFixed(1)}k` : String(Math.round(snapshot.total_fans))} color="#f472b6" />
      </div>

      {/* Aptitudes + Skill Hints side by side */}
      {(hasAptitudes || hints.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.6rem' }}>
          {hasAptitudes ? (
            <PanelSection label="Aptitudes">
              <AptitudeGrid aptitudes={snapshot.aptitudes!} />
            </PanelSection>
          ) : <div />}
          {hints.length > 0 ? (
            <PanelSection label="Skill Hints">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignContent: 'flex-start' }}>
                {hints.map(([id, level]) => (
                  <span key={id} style={{
                    padding: '0.15rem 0.45rem', borderRadius: 5,
                    background: 'rgba(96,165,250,0.1)',
                    border: '1px solid rgba(96,165,250,0.2)',
                    fontSize: '0.7rem', color: '#93c5fd',
                  }}>
                    {skillNameById?.[Number(id)] ?? `#${id}`} Lv{level}
                  </span>
                ))}
              </div>
            </PanelSection>
          ) : <div />}
        </div>
      )}

      {/* Learned Skills */}
      {skills.length > 0 && (
        <PanelSection label="Learned Skills">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {skills.map(s => (
              <span key={s.skill_id} style={{
                padding: '0.15rem 0.45rem', borderRadius: 5,
                background: 'rgba(56,189,248,0.1)',
                border: '1px solid rgba(56,189,248,0.2)',
                fontSize: '0.7rem', color: '#7dd3fc',
              }}>
                {s.name} Lv{s.level}
              </span>
            ))}
          </div>
        </PanelSection>
      )}

      {/* Items (Trackblazer only) */}
      {items.length > 0 && (
        <PanelSection label="Items">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {items.map(it => (
              <span key={it.item_id} style={{
                padding: '0.15rem 0.45rem', borderRadius: 5,
                background: 'rgba(251,146,60,0.1)',
                border: '1px solid rgba(251,146,60,0.2)',
                fontSize: '0.7rem', color: '#fdba74',
              }}>
                {it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ''}
              </span>
            ))}
          </div>
        </PanelSection>
      )}

      {/* Conditions */}
      {snapshot.conditions.length > 0 && (
        <PanelSection label="Conditions">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {snapshot.conditions.map((c, i) => (
              <span key={i} style={{
                padding: '0.15rem 0.45rem', borderRadius: 5,
                background: 'rgba(163,163,163,0.08)',
                border: '1px solid rgba(163,163,163,0.15)',
                fontSize: '0.7rem', color: '#a3a3a3',
              }}>
                {formatCondition(c)}
              </span>
            ))}
          </div>
        </PanelSection>
      )}

      {/* Support Card Friendship */}
      {cardInfo && cardInfo.length > 0 && (
        <PanelSection label="Support Cards">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
            {cardInfo.map((card, i) => {
              const friendship = snapshot.friendship[i] ?? 0
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.3rem 0.5rem', borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  {supabaseStorageUrl && (
                    <>
                      <img
                        src={getCardIconUrl(card.card_id)}
                        alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                        onError={e => (e.currentTarget.style.display = 'none')}
                      />
                      <img
                        src={getTypeIconUrl(card.card_type)}
                        alt="" style={{ width: 12, height: 12, flexShrink: 0 }}
                        onError={e => (e.currentTarget.style.display = 'none')}
                      />
                    </>
                  )}
                  <span style={{ fontSize: '0.7rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#d4d4d8' }}>
                    {card.name}
                  </span>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
                    color: friendship >= 80 ? '#34d399' : friendship > 0 ? '#fbbf24' : '#71717a',
                  }}>
                    {Math.round(friendship)}
                  </span>
                </div>
              )
            })}
          </div>
        </PanelSection>
      )}

      {/* Footer: facility levels + races */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: '0.72rem', color: '#71717a',
        marginTop: '0.5rem',
      }}>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          {STAT_NAMES.map((name, i) => (
            <span key={i}>
              <span style={{ color: UMA_STAT_COLORS[i], fontWeight: 600 }}>{name.slice(0, 3)}</span>{' '}
              Lv{snapshot.facility_levels[i]} ({snapshot.facility_trains[i]})
            </span>
          ))}
        </div>
        <span>Races: {snapshot.races_run}</span>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ResourceBadge({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      padding: '0.4rem 0.5rem', borderRadius: 10, textAlign: 'center',
      background: `${color}10`,
      border: `1px solid ${color}25`,
    }}>
      <div style={{ fontSize: '0.6rem', color, fontWeight: 700, marginBottom: '0.15rem' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e4e4e7' }}>{value}</div>
    </div>
  )
}

function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{
        fontSize: '0.65rem', fontWeight: 700, color: '#71717a',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        marginBottom: '0.3rem',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCondition(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
}
