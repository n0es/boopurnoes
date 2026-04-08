/**
 * EntryDetailViewer — shows what happened at a specific timeline entry:
 * stat deltas (as a signed-gains grid), resource changes, and the full
 * effect log (training breakdown, spark details, etc.).
 *
 * Rendered below the timeline bar when the user clicks a segment.
 * The main stats display now lives in TraineeStatsPanel (above the bar).
 */

import type { TurnSnapshot, TimelineEntrySummary, TimelineEntryDetail } from '../lib/careerSessionApi'
import { UMA_STAT_COLORS, formatSignedStatDelta } from '../lib/umaStatDisplay'
import { StatChangeSentenceList } from './StatChangeSentenceList'

// ─── Props ──────────────────────────────────────────────────────────────────

interface EntryDetailViewerProps {
  entry: TimelineEntrySummary
  snapshot: TurnSnapshot | null
  previousSnapshot: TurnSnapshot | null
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STAT_KEYS: (keyof TurnSnapshot['stats'])[] = ['speed', 'stamina', 'power', 'guts', 'wisdom']

const EVENT_LABELS: Record<string, string> = {
  'Spark of Inspiration': 'Spark of Inspiration',
  'New Year': 'New Year Event',
  'Summer Camp': 'Summer Training Camp',
}

const ACTION_LABELS: Record<string, string> = {
  train_speed: 'Speed Training',
  train_stamina: 'Stamina Training',
  train_power: 'Power Training',
  train_guts: 'Guts Training',
  train_wisdom: 'Wisdom Training',
  rest: 'Rest',
  race: 'Race',
  infirmary: 'Infirmary',
  recreation: 'Recreation',
}

/** Snapshot diff when possible; otherwise infer from `entry.detail` (e.g. first Spark has no previous). */
function resolveDisplayDeltas(
  entry: TimelineEntrySummary,
  snapshot: TurnSnapshot,
  previousSnapshot: TurnSnapshot | null,
): {
  stats: number[]
  skillPointsDelta: number | null
  energyDelta: number | null
  friendshipGains: number[] | null
} | null {
  if (previousSnapshot) {
    const stats = STAT_KEYS.map(key => snapshot.stats[key] - previousSnapshot.stats[key])
    const skillPointsDelta = snapshot.skill_points - previousSnapshot.skill_points
    const energyDelta = snapshot.energy - previousSnapshot.energy
    const n = Math.max(snapshot.friendship.length, previousSnapshot.friendship.length)
    const friendshipGains: number[] = []
    for (let i = 0; i < n; i++) {
      friendshipGains.push(
        (snapshot.friendship[i] ?? 0) - (previousSnapshot.friendship[i] ?? 0),
      )
    }
    return { stats, skillPointsDelta, energyDelta, friendshipGains }
  }

  const d = entry.detail
  if (!d) return null

  if (d.kind === 'spark_of_inspiration') {
    return {
      stats: [...d.stat_gains],
      skillPointsDelta: d.sp_gained,
      energyDelta: null,
      friendshipGains: null,
    }
  }
  if (d.kind === 'training') {
    const t = d.detail
    return {
      stats: [...t.stat_gains],
      skillPointsDelta: t.sp_gain,
      energyDelta: t.energy_change,
      friendshipGains: [...t.friendship_gains],
    }
  }
  if (d.kind === 'custom_event') {
    return {
      stats: d.stat_gains ? [...d.stat_gains] : [0, 0, 0, 0, 0],
      skillPointsDelta: d.sp_gained ?? null,
      energyDelta: d.energy_gained ?? null,
      friendshipGains: null,
    }
  }
  return null
}

function displayDeltasHasLines(
  resolved: { stats: number[]; skillPointsDelta: number | null; energyDelta: number | null; friendshipGains: number[] | null },
): boolean {
  if (resolved.stats.some(s => Math.abs(s) >= 0.5)) return true
  if (resolved.skillPointsDelta != null && Math.abs(resolved.skillPointsDelta) >= 0.5) return true
  if (resolved.energyDelta != null && Math.abs(resolved.energyDelta) >= 0.5) return true
  if (resolved.friendshipGains?.some(g => Math.abs(g) >= 0.5)) return true
  return false
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EntryDetailViewer({
  entry,
  snapshot,
  previousSnapshot,
}: EntryDetailViewerProps) {
  if (!snapshot) return null

  const resolved = resolveDisplayDeltas(entry, snapshot, previousSnapshot)
  const moodDeltaCustom =
    entry.detail?.kind === 'custom_event' ? entry.detail.mood_change ?? null : null

  const hasNumericLines = resolved != null && displayDeltasHasLines(resolved)
  const hasMoodOnly =
    !hasNumericLines &&
    moodDeltaCustom != null &&
    Math.abs(moodDeltaCustom) >= 0.5
  const showChangeList = hasNumericLines || hasMoodOnly

  const deltaTotal = resolved
    ? resolved.stats.reduce((a, b) => a + b, 0)
    : null

  const label = entry.kind === 'event'
    ? EVENT_LABELS[entry.entry_type] || entry.entry_type
    : ACTION_LABELS[entry.entry_type] || entry.entry_type

  const labelColor = entry.kind === 'event'
    ? entry.color || '#c084fc'
    : UMA_STAT_COLORS[
        entry.entry_type.startsWith('train_')
          ? ['speed', 'stamina', 'power', 'guts', 'wisdom'].indexOf(entry.entry_type.replace('train_', ''))
          : -1
      ] || '#a1a1aa'

  return (
    <div style={{
      background: 'rgba(24, 24, 27, 0.95)',
      borderRadius: 16,
      padding: '1rem 1.25rem',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: '0.75rem',
      }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: labelColor }}>
            {label}
          </span>
          <span style={{ fontSize: '0.78rem', color: '#52525b' }}>
            {entry.calendar_label}
          </span>
        </div>
        {deltaTotal != null && deltaTotal !== 0 && (
          <span style={{
            fontSize: '0.82rem', fontWeight: 700,
            color: deltaTotal > 0 ? '#4ade80' : '#f87171',
          }}>
            {formatSignedStatDelta(deltaTotal)} stats
          </span>
        )}
      </div>

      {showChangeList && (
        <StatChangeSentenceList
          stats={resolved?.stats ?? [0, 0, 0, 0, 0]}
          skillPointsDelta={resolved?.skillPointsDelta ?? null}
          energyDelta={resolved?.energyDelta ?? null}
          friendshipGains={resolved?.friendshipGains ?? null}
          moodDelta={moodDeltaCustom}
          style={{ marginBottom: entry.detail ? '0.6rem' : 0 }}
        />
      )}

      {/* Effect log */}
      {entry.detail && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '0.65rem',
        }}>
          <EffectLogSection detail={entry.detail} hideRedundantStats={showChangeList} />
        </div>
      )}
    </div>
  )
}

// ─── Effect Log ─────────────────────────────────────────────────────────────

function EffectLogSection({
  detail,
  hideRedundantStats,
}: {
  detail: TimelineEntryDetail
  hideRedundantStats: boolean
}) {
  switch (detail.kind) {
    case 'training': {
      const d = detail.detail
      return (
        <div style={{ fontSize: '0.78rem', color: '#a1a1aa', lineHeight: 1.6 }}>
          <div style={{ color: '#e4e4e7', fontWeight: 600, marginBottom: '0.35rem' }}>Training breakdown</div>
          <div>
            Fail {d.failed ? 'yes' : 'no'} · Rate {(d.failure_rate * 100).toFixed(1)}%
            {d.present_card_indices.length > 0 && (
              <> · Cards at facility: {d.present_card_indices.join(', ')}</>
            )}
          </div>
        </div>
      )
    }
    case 'spark_of_inspiration': {
      const phaseNames: Record<string, string> = {
        career_start: 'Career start — 1st spark (fixed blues + red table + rolled hints)',
        april_classic: 'April — Classic year (rolled blues / hints / reds)',
        april_senior: 'April — Senior year (rolled blues / hints / reds)',
      }
      const hints = detail.hint_deltas ?? []
      const apts = detail.aptitude_deltas ?? []
      return (
        <div style={{ fontSize: '0.78rem', color: '#a1a1aa', lineHeight: 1.6 }}>
          <div style={{ color: '#e4e4e7', fontWeight: 600, marginBottom: '0.35rem' }}>
            {phaseNames[detail.phase] ?? detail.phase}
          </div>
          {!hideRedundantStats && (
            <StatChangeSentenceList
              stats={detail.stat_gains}
              skillPointsDelta={detail.sp_gained}
              energyDelta={null}
              style={{ marginBottom: '0.35rem' }}
            />
          )}
          {apts.length > 0 && (
            <div style={{ marginTop: '0.35rem' }}>
              <span style={{ color: '#e4e4e7', fontWeight: 600 }}>Aptitudes: </span>
              {apts.map(a => (
                <span key={`${a.key}-${a.to_grade}`} style={{ marginRight: '0.5rem' }}>
                  {a.key} {a.from_grade}→{a.to_grade}
                </span>
              ))}
            </div>
          )}
          {hints.length > 0 && (
            <div style={{ marginTop: '0.35rem' }}>
              <span style={{ color: '#e4e4e7', fontWeight: 600 }}>Skill hints: </span>
              {hints.map(h => (
                <span key={`${h.skill_id}-${h.levels}`} style={{ marginRight: '0.5rem' }}>
                  skill #{h.skill_id} +{h.levels} lvl
                </span>
              ))}
            </div>
          )}
        </div>
      )
    }
    case 'new_year':
      return (
        <div style={{ fontSize: '0.78rem', color: '#a1a1aa' }}>
          <div style={{ color: '#e4e4e7', fontWeight: 600, marginBottom: '0.35rem' }}>New Year</div>
          Energy +{Math.round(detail.energy_gained)} · SP +{Math.round(detail.sp_gained)}
        </div>
      )
    case 'summer_camp_start':
      return (
        <div style={{ fontSize: '0.78rem', color: '#a1a1aa' }}>
          Summer training camp started (facilities treated as level 5 for training).
        </div>
      )
    case 'buy_skill':
      return (
        <div style={{ fontSize: '0.78rem', color: '#a1a1aa' }}>
          <div style={{ color: '#e4e4e7', fontWeight: 600, marginBottom: '0.35rem' }}>Skill Purchased</div>
          {detail.name} Lv{detail.level} · SP cost: −{Math.round(detail.sp_cost)}
        </div>
      )
    case 'acquire_item':
      return (
        <div style={{ fontSize: '0.78rem', color: '#a1a1aa' }}>
          <div style={{ color: '#e4e4e7', fontWeight: 600, marginBottom: '0.35rem' }}>Item Acquired</div>
          {detail.name}{detail.quantity > 1 ? ` ×${detail.quantity}` : ''}
        </div>
      )
    case 'custom_event':
      return (
        <div style={{ fontSize: '0.78rem', color: '#a1a1aa', lineHeight: 1.6 }}>
          <div style={{ color: '#e4e4e7', fontWeight: 600, marginBottom: '0.35rem' }}>{detail.description}</div>
          {!hideRedundantStats && detail.stat_gains && (
            <StatChangeSentenceList
              stats={detail.stat_gains}
              skillPointsDelta={detail.sp_gained ?? null}
              energyDelta={detail.energy_gained ?? null}
              moodDelta={detail.mood_change ?? null}
              style={{ marginBottom: '0.35rem' }}
            />
          )}
        </div>
      )
    default:
      return null
  }
}

export default EntryDetailViewer
