/**
 * TurnActionPanel — UI for inputting card placements and choosing a turn action.
 *
 * The player observes the game, enters where each support card ended up,
 * then views the training preview for each facility, and picks an action.
 */

import { useState, useCallback, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type {
  TurnPreview,
  FacilityPreview,
  TurnAction,
  CalendarTurn,
  GameEvent,
} from '../lib/careerSessionApi'

// ─── Constants ──────────────────────────────────────────────────────────────

const FACILITY_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom']
const FACILITY_COLORS = ['#60a5fa', '#fb923c', '#f87171', '#fbbf24', '#34d399']
const STAT_KEYS = ['speed', 'stamina', 'power', 'guts', 'wisdom']

const smallInputStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e4e4e7',
  padding: '0.2rem 0.35rem',
  fontSize: '0.75rem',
}

type SparkGameEvent = Extract<GameEvent, { type: 'spark_of_inspiration' }>

function SparkInspirationPending({
  evt,
  onSubmitEvent,
  submitting,
}: {
  evt: SparkGameEvent
  onSubmitEvent: (event: GameEvent) => void
  submitting: boolean
}) {
  const [stats, setStats] = useState(() => evt.stat_gains.map(g => Math.round(Number(g))))

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#c084fc', marginBottom: '0.5rem' }}>
        Spark of Inspiration
      </div>
      <div style={{ fontSize: '0.78rem', color: '#a1a1aa', marginBottom: '0.35rem' }}>
        {evt.phase === 'april_classic' || evt.phase === 'april_senior'
          ? 'April inheritance spark (2nd / 3rd in the run): stats below are a server roll from your legacy tree; edit if your run differed. Submit before this turn.'
          : 'Spark of Inspiration — confirm or edit gains, then submit.'}
      </div>
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        {FACILITY_NAMES.map((name, si) => (
          <label key={si} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem' }}>
            <span style={{ color: FACILITY_COLORS[si], fontWeight: 600, width: 28 }}>{name.slice(0, 3)}</span>
            <input
              type="number"
              value={stats[si]}
              onChange={e => {
                const next = [...stats]
                next[si] = Number(e.target.value) || 0
                setStats(next)
              }}
              style={{ width: 48, ...smallInputStyle }}
            />
          </label>
        ))}
      </div>
      {(evt.hint_deltas?.length ?? 0) > 0 && (
        <div style={{ fontSize: '0.72rem', color: '#71717a', marginBottom: '0.35rem' }}>
          Hints (roll):{' '}
          {evt.hint_deltas!.map(h => `skill #${h.skill_id} +${h.levels}`).join(' · ')}
        </div>
      )}
      {(evt.aptitude_deltas?.length ?? 0) > 0 && (
        <div style={{ fontSize: '0.72rem', color: '#71717a', marginBottom: '0.35rem' }}>
          Aptitudes (roll):{' '}
          {evt.aptitude_deltas!.map(a => `${a.key} ${a.from_grade}→${a.to_grade}`).join(' · ')}
        </div>
      )}
      <button
        type="button"
        disabled={submitting}
        onClick={() => {
          onSubmitEvent({
            ...evt,
            stat_gains: stats,
          })
        }}
        style={{
          padding: '0.35rem 0.85rem', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(192,132,252,0.25)', color: '#c084fc', fontWeight: 700, fontSize: '0.78rem',
          opacity: submitting ? 0.5 : 1,
        }}
      >
        Submit Spark
      </button>
    </div>
  )
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface TurnActionPanelProps {
  /** Card names for each deck slot (0–5). */
  cardNames: string[]
  /** Current turn preview from the server. */
  preview: TurnPreview | null
  /** Whether we're loading a preview. */
  previewLoading: boolean
  /** Callback to request a preview with given card placements. */
  onRequestPreview: (placements: number[]) => void
  /** Callback when the player submits a game event (Spark of Inspiration, etc.) */
  onSubmitEvent: (event: GameEvent) => void
  /** Callback when the player submits a turn action. */
  onSubmitAction: (params: {
    action: TurnAction
    card_placements: number[]
    training_failed?: boolean
    rest_energy?: number
  }) => void
  /** Whether submission is in progress. */
  submitting: boolean
  /** Whether the career is complete. */
  isComplete: boolean
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TurnActionPanel({
  cardNames,
  preview,
  previewLoading,
  onRequestPreview,
  onSubmitEvent,
  onSubmitAction,
  submitting,
  isComplete,
}: TurnActionPanelProps) {
  // Card placements: 0–4 = facility, 5 = away/vacation
  const [placements, setPlacements] = useState<number[]>([5, 5, 5, 5, 5, 5])
  const [selectedFacility, setSelectedFacility] = useState<number | null>(null)
  const [trainingFailed, setTrainingFailed] = useState(false)
  const [restEnergy, setRestEnergy] = useState<number>(50)

  // Update a single card's placement
  const setPlacement = useCallback((cardIdx: number, facility: number) => {
    setPlacements(prev => {
      const next = [...prev]
      next[cardIdx] = facility
      return next
    })
  }, [])

  // Request preview when placements change
  useEffect(() => {
    onRequestPreview(placements)
  }, [placements, onRequestPreview])

  if (isComplete) {
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#a1a1aa',
        background: 'rgba(24, 24, 27, 0.95)',
        borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e4e4e7', marginBottom: '0.5rem' }}>
          Career Complete
        </div>
        <div>All {preview?.turn_number ?? 78} turns have been played.</div>
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(24, 24, 27, 0.95)',
      borderRadius: 16,
      padding: '1.25rem',
      border: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
    }}>
      {/* Turn header */}
      {preview && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: '#e4e4e7' }}>
              Turn {preview.turn_number}
            </span>
            <span style={{ color: '#71717a', fontSize: '0.82rem', marginLeft: '0.75rem' }}>
              {formatCalendar(preview.calendar)}
            </span>
          </div>
          {preview.is_summer_camp && (
            <span style={{
              background: 'rgba(251,191,36,0.15)', color: '#fbbf24',
              padding: '0.2rem 0.6rem', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700,
            }}>
              Summer Camp
            </span>
          )}
        </div>
      )}

      {/* Pending events — must be submitted before the turn action */}
      {preview?.pending_events.map((evt, i) => (
        <div key={i} style={{
          padding: '0.75rem', borderRadius: 10,
          background: evt.type === 'spark_of_inspiration' ? 'rgba(192,132,252,0.08)' : 'rgba(96,165,250,0.08)',
          border: `1px solid ${evt.type === 'spark_of_inspiration' ? 'rgba(192,132,252,0.2)' : 'rgba(96,165,250,0.15)'}`,
        }}>
          {evt.type === 'spark_of_inspiration' && (
            <SparkInspirationPending
              key={`spark-${preview?.turn_number ?? 0}-${evt.phase}-${evt.stat_gains.join(',')}-${evt.hint_deltas?.map(h => `${h.skill_id}:${h.levels}`).join(';') ?? ''}`}
              evt={evt}
              onSubmitEvent={onSubmitEvent}
              submitting={submitting}
            />
          )}
          {evt.type === 'new_year' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fde68a' }}>New Year</span>
                <span style={{ fontSize: '0.78rem', color: '#a1a1aa', marginLeft: '0.5rem' }}>
                  +{evt.energy_gained} energy, +{evt.sp_gained} SP
                </span>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => onSubmitEvent(evt)}
                style={{
                  padding: '0.35rem 0.85rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'rgba(253,230,138,0.2)', color: '#fde68a', fontWeight: 700, fontSize: '0.78rem',
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                Apply
              </button>
            </div>
          )}
          {evt.type === 'summer_camp_start' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#67e8f9' }}>
                Summer Camp — all facilities at Level 5
              </span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => onSubmitEvent(evt)}
                style={{
                  padding: '0.35rem 0.85rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'rgba(103,232,249,0.15)', color: '#67e8f9', fontWeight: 700, fontSize: '0.78rem',
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Card placements input */}
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>
          Card Placements
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {cardNames.map((name, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                width: 120, fontSize: '0.78rem', color: '#d4d4d8',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {name || `Card ${idx + 1}`}
              </span>
              <div style={{ display: 'flex', gap: '0.2rem' }}>
                {FACILITY_NAMES.map((fName, fIdx) => (
                  <button
                    key={fIdx}
                    type="button"
                    onClick={() => setPlacement(idx, fIdx)}
                    style={{
                      width: 36, height: 24, borderRadius: 4, border: 'none', cursor: 'pointer',
                      fontSize: '0.65rem', fontWeight: 600,
                      background: placements[idx] === fIdx
                        ? FACILITY_COLORS[fIdx] + '40'
                        : 'rgba(255,255,255,0.04)',
                      color: placements[idx] === fIdx ? FACILITY_COLORS[fIdx] : '#52525b',
                    }}
                    title={fName}
                  >
                    {fName.slice(0, 3)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPlacement(idx, 5)}
                  style={{
                    width: 36, height: 24, borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: '0.65rem', fontWeight: 600,
                    background: placements[idx] === 5 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                    color: placements[idx] === 5 ? '#a1a1aa' : '#3f3f46',
                  }}
                >
                  Away
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Loading indicator */}
      {previewLoading && (
        <div style={{ textAlign: 'center', color: '#71717a', fontSize: '0.82rem', padding: '0.5rem' }}>
          Calculating...
        </div>
      )}

      {/* Facility previews */}
      {preview && !previewLoading && (
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>
            Training Preview
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {preview.facility_previews.map((fp, idx) => (
              <FacilityCard
                key={idx}
                preview={fp}
                selected={selectedFacility === idx}
                onClick={() => setSelectedFacility(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        {/* Train */}
        {selectedFacility !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                onSubmitAction({
                  action: { type: 'train', facility: selectedFacility },
                  card_placements: placements,
                  training_failed: trainingFailed,
                })
              }}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: `${FACILITY_COLORS[selectedFacility]}30`,
                color: FACILITY_COLORS[selectedFacility],
                fontWeight: 700, fontSize: '0.85rem',
                opacity: submitting ? 0.5 : 1,
              }}
            >
              Train {FACILITY_NAMES[selectedFacility]}
            </button>
            <label style={{ fontSize: '0.75rem', color: '#71717a', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <input
                type="checkbox"
                checked={trainingFailed}
                onChange={e => setTrainingFailed(e.target.checked)}
              />
              Failed
            </label>
          </div>
        )}

        {/* Rest */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              onSubmitAction({
                action: { type: 'rest' },
                card_placements: placements,
                rest_energy: restEnergy,
              })
            }}
            style={actionBtnStyle('#a78bfa', submitting)}
          >
            Rest
          </button>
          <input
            type="number"
            value={restEnergy}
            onChange={e => setRestEnergy(Number(e.target.value))}
            style={{ width: 50, ...smallInputStyle }}
            title="Energy recovered"
          />
        </div>

        {/* Race */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            onSubmitAction({
              action: { type: 'race' },
              card_placements: placements,
            })
          }}
          style={actionBtnStyle('#f472b6', submitting)}
        >
          Race
        </button>

        {/* Infirmary */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            onSubmitAction({
              action: { type: 'infirmary' },
              card_placements: placements,
            })
          }}
          style={actionBtnStyle('#94a3b8', submitting)}
        >
          Infirmary
        </button>

        {/* Recreation */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            onSubmitAction({
              action: { type: 'recreation' },
              card_placements: placements,
            })
          }}
          style={actionBtnStyle('#67e8f9', submitting)}
        >
          Recreation
        </button>
      </div>
    </div>
  )
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function FacilityCard({
  preview,
  selected,
  onClick,
}: {
  preview: FacilityPreview
  selected: boolean
  onClick: () => void
}) {
  const color = FACILITY_COLORS[preview.facility]

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '1 1 100px',
        minWidth: 100,
        padding: '0.6rem',
        borderRadius: 12,
        border: selected ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.08)',
        background: selected ? `${color}15` : 'rgba(255,255,255,0.03)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '0.8rem', color, marginBottom: '0.35rem' }}>
        {FACILITY_NAMES[preview.facility]}
      </div>
      <div style={{ fontSize: '0.72rem', color: '#d4d4d8' }}>
        {STAT_KEYS.map((_key, i) =>
          preview.stat_gains[i] > 0 ? (
            <span key={i} style={{ color: FACILITY_COLORS[i], marginRight: '0.35rem' }}>
              +{Math.round(preview.stat_gains[i])}
            </span>
          ) : null,
        )}
      </div>
      <div style={{ fontSize: '0.68rem', color: '#71717a', marginTop: '0.25rem' }}>
        SP +{Math.round(preview.sp_gain)} | E {preview.energy_change > 0 ? '+' : ''}{Math.round(preview.energy_change)}
      </div>
      {preview.failure_rate > 0 && (
        <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: '0.15rem' }}>
          Fail: {Math.round(preview.failure_rate * 100)}%
        </div>
      )}
      <div style={{ fontSize: '0.65rem', color: '#52525b', marginTop: '0.15rem' }}>
        {preview.present_cards.length} card{preview.present_cards.length !== 1 ? 's' : ''} present
      </div>
    </button>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCalendar(cal: CalendarTurn): string {
  const yearStr = cal.year.charAt(0).toUpperCase() + cal.year.slice(1)
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const halfStr = cal.half === 'first' ? '1st' : '2nd'
  return `${yearStr} ${months[cal.month]} (${halfStr})`
}

function actionBtnStyle(color: string, disabled: boolean): CSSProperties {
  return {
    padding: '0.5rem 1rem',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    background: `${color}20`,
    color,
    fontWeight: 700,
    fontSize: '0.82rem',
    opacity: disabled ? 0.5 : 1,
  }
}

export default TurnActionPanel
