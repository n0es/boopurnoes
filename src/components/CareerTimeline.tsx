/**
 * CareerTimeline — pre-populated entries with a draggable playhead that snaps
 * to gaps between entries (not continuous scrub). Click a segment to inspect below.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { TimelineEntrySummary } from '../lib/careerSessionApi'

interface CareerTimelineProps {
  currentTurn: number
  totalTurns: number
  timeline: TimelineEntrySummary[]
  sliderPosition: number | null
  selectedEntry: number | null
  onSliderChange: (pos: number | null) => void
  onEntrySelect: (index: number) => void
}

const ACTION_COLORS: Record<string, string> = {
  train_speed: '#60a5fa',
  train_stamina: '#fb923c',
  train_power: '#f87171',
  train_guts: '#fbbf24',
  train_wisdom: '#34d399',
  rest: '#a78bfa',
  race: '#f472b6',
  infirmary: '#94a3b8',
  recreation: '#67e8f9',
  pending: '#27272a',
}

function segmentLayout(timeline: TimelineEntrySummary[]) {
  if (timeline.length === 0) return []
  const totalWeight = timeline.reduce((acc, e) => acc + (e.kind === 'event' ? 0.4 : 1.0), 0)
  let posWeight = 0.0
  return timeline.map(entry => {
    const w = entry.kind === 'event' ? 0.4 : 1.0
    const left = (posWeight / totalWeight) * 100
    const width = (w / totalWeight) * 100
    posWeight += w
    return { left, width, entry }
  })
}

/** Only completed entries + the first pending turn; hides the rest of the skeleton. */
function visibleTimelineEntries(full: TimelineEntrySummary[]): TimelineEntrySummary[] {
  if (full.length === 0) return []
  const firstPending = full.findIndex(e => e.kind === 'turn' && e.entry_type === 'pending')
  if (firstPending < 0) return full
  return full.slice(0, firstPending + 1)
}

function sliderToVisibleGapIdx(
  slider: number | null,
  visible: TimelineEntrySummary[],
): number {
  if (visible.length === 0) return 0
  if (slider === null) return 0
  const lastIdx = visible[visible.length - 1].index
  if (slider > lastIdx) return visible.length
  const i = visible.findIndex(e => e.index === slider)
  return i >= 0 ? i + 1 : 0
}

function visibleGapToSlider(g: number, visible: TimelineEntrySummary[]): number | null {
  if (g <= 0 || visible.length === 0) return null
  if (g > visible.length) return visible[visible.length - 1].index
  return visible[g - 1].index
}

/** Gap index 0 = initial state; gap k = after entry k-1 (slider k-1); gap n = after last entry. */
function gapPercents(layout: { left: number; width: number }[]): number[] {
  const gaps: number[] = [0]
  for (let i = 0; i < layout.length; i++) {
    gaps.push(layout[i].left + layout[i].width)
  }
  return gaps
}

export function CareerTimeline({
  currentTurn,
  totalTurns,
  timeline,
  sliderPosition,
  selectedEntry,
  onSliderChange,
  onEntrySelect,
}: CareerTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const visibleTimeline = useMemo(() => visibleTimelineEntries(timeline), [timeline])
  const hiddenEntryCount = timeline.length - visibleTimeline.length

  const layout = useMemo(() => segmentLayout(visibleTimeline), [visibleTimeline])
  const gaps = useMemo(() => gapPercents(layout), [layout])
  const gapIdx = sliderToVisibleGapIdx(sliderPosition, visibleTimeline)

  const [dragging, setDragging] = useState(false)
  const [hoveredEntryIndex, setHoveredEntryIndex] = useState<number | null>(null)

  const playheadPercent = gaps[gapIdx] ?? 0

  const nearestGapIndex = useCallback(
    (clientX: number): number => {
      if (!trackRef.current || gaps.length === 0) return 0
      const rect = trackRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const target = x * 100
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < gaps.length; i++) {
        const d = Math.abs(gaps[i] - target)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    },
    [gaps],
  )

  const handlePlayheadDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      setDragging(true)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const handlePlayheadMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const g = nearestGapIndex(e.clientX)
      const pos = visibleGapToSlider(g, visibleTimeline)
      void onSliderChange(pos)
    },
    [dragging, nearestGapIndex, onSliderChange, visibleTimeline],
  )

  const handlePlayheadUp = useCallback((e: React.PointerEvent) => {
    setDragging(false)
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const firstPendingEntryIndex = useMemo(() => {
    const e = timeline.find(x => x.kind === 'turn' && x.entry_type === 'pending')
    return e?.index ?? -1
  }, [timeline])

  const latestVisibleSliderIndex =
    visibleTimeline.length > 0 ? visibleTimeline[visibleTimeline.length - 1].index : -1

  return (
    <div
      style={{
        background: 'rgba(24, 24, 27, 0.95)',
        borderRadius: 16,
        padding: '1rem 1.25rem',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem',
      }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e4e4e7' }}>Timeline</span>
          <span style={{ fontSize: '0.78rem', color: '#71717a' }}>
            {currentTurn} / {totalTurns} turns
            {hiddenEntryCount > 0 && (
              <> &middot; +{hiddenEntryCount} later turn{hiddenEntryCount !== 1 ? 's' : ''} hidden</>
            )}
          </span>
        </div>
        <span style={{ fontSize: '0.72rem', color: '#52525b' }}>
          Drag playhead between gaps &middot; Click entry to inspect
        </span>
      </div>

      <div
        ref={trackRef}
        style={{
          position: 'relative', height: 44,
          userSelect: 'none', touchAction: 'none',
        }}
        onPointerMove={e => {
          if (!trackRef.current || layout.length === 0) return
          const rect = trackRef.current.getBoundingClientRect()
          const xf = (e.clientX - rect.left) / rect.width
          let found: number | null = null
          for (let i = 0; i < layout.length; i++) {
            const L = layout[i].left / 100
            const R = (layout[i].left + layout[i].width) / 100
            if (xf >= L && xf <= R) found = i
          }
          setHoveredEntryIndex(found !== null ? layout[found].entry.index : null)
        }}
        onPointerLeave={() => setHoveredEntryIndex(null)}
      >
        <div style={{
          position: 'absolute', top: 16, left: 0, right: 0, height: 12,
          borderRadius: 6, background: 'rgba(255,255,255,0.04)',
        }} />

        {layout.map(seg => {
          const { entry, left, width } = seg
          const isEvent = entry.kind === 'event'
          const color = isEvent
            ? (entry.color || '#c084fc')
            : (ACTION_COLORS[entry.entry_type] || '#52525b')

          const isSliderPos = sliderPosition === entry.index
          const isSelected = selectedEntry === entry.index
          const isHovered = hoveredEntryIndex === entry.index
          const isPending = entry.entry_type === 'pending'
          const isFirstPending = entry.index === firstPendingEntryIndex && isPending

          return (
            <button
              key={entry.index}
              type="button"
              onClick={() => onEntrySelect(entry.index)}
              title={`${entry.calendar_label}: ${entry.entry_type}`}
              style={{
                position: 'absolute',
                top: isEvent ? 10 : 14,
                left: `${left}%`,
                width: `${width}%`,
                height: isEvent ? 28 : 20,
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: isEvent ? '60%' : '82%',
                  height: isPending ? 12 : isEvent ? 14 : 12,
                  borderRadius: isEvent ? 6 : 3,
                  background: isPending ? 'transparent' : color,
                  opacity: isPending ? 1 : isSliderPos ? 1 : isHovered ? 0.85 : 0.65,
                  transition: 'all 0.12s',
                  border: isPending
                    ? `2px dashed ${isFirstPending ? '#60a5fa' : '#52525b'}`
                    : isSliderPos
                      ? '1px solid rgba(255,255,255,0.5)'
                      : 'none',
                  boxShadow: isSelected && !isPending
                    ? `0 0 0 2px ${color}, 0 0 8px ${color}60`
                    : isFirstPending
                      ? '0 0 10px rgba(96,165,250,0.35)'
                      : 'none',
                  animation: isFirstPending ? 'timelinePendingPulse 2s ease-in-out infinite' : undefined,
                  ...(isEvent ? { minHeight: 14 } : {}),
                }}
              />
              {isEvent && (isSliderPos || isHovered || isSelected) && (
                <div style={{
                  position: 'absolute', top: -14,
                  fontSize: '0.58rem', color, whiteSpace: 'nowrap',
                  fontWeight: 700, pointerEvents: 'none',
                }}>
                  {entry.entry_type}
                </div>
              )}
              {isSelected && (
                <div style={{
                  position: 'absolute', bottom: -8,
                  width: 0, height: 0,
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderBottom: `5px solid ${color}`,
                  pointerEvents: 'none',
                }} />
              )}
            </button>
          )
        })}

        {/* Draggable playhead */}
        {visibleTimeline.length > 0 && (
          <div
            role="slider"
            tabIndex={0}
            aria-valuenow={gapIdx}
            aria-valuemin={0}
            aria-valuemax={gaps.length - 1}
            onPointerDown={handlePlayheadDown}
            onPointerMove={handlePlayheadMove}
            onPointerUp={handlePlayheadUp}
            onPointerCancel={handlePlayheadUp}
            style={{
              position: 'absolute',
              top: 4,
              left: `${playheadPercent}%`,
              transform: 'translateX(-50%)',
              width: 14,
              height: 36,
              borderRadius: 4,
              background: 'linear-gradient(180deg, #fafafa, #d4d4d8)',
              boxShadow: '0 0 8px rgba(255,255,255,0.45)',
              cursor: dragging ? 'grabbing' : 'grab',
              zIndex: 5,
              touchAction: 'none',
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes timelinePendingPulse {
          0%, 100% { box-shadow: 0 0 6px rgba(96,165,250,0.25); }
          50% { box-shadow: 0 0 14px rgba(96,165,250,0.55); }
        }
      `}</style>

      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <TimelineButton
          active={sliderPosition === null}
          onClick={() => onSliderChange(null)}
          label="Start"
        />
        {visibleTimeline.length > 0 && latestVisibleSliderIndex >= 0 && (
          <TimelineButton
            active={sliderPosition === latestVisibleSliderIndex}
            onClick={() => onSliderChange(latestVisibleSliderIndex)}
            label="Latest"
          />
        )}
        {visibleTimeline
          .filter(e => e.kind === 'event')
          .map(e => (
            <TimelineButton
              key={e.index}
              active={selectedEntry === e.index}
              onClick={() => onEntrySelect(e.index)}
              label={e.entry_type}
              color={e.color || undefined}
            />
          ))}
      </div>
    </div>
  )
}

function TimelineButton({
  active, onClick, label, color,
}: {
  active: boolean; onClick: () => void; label: string; color?: string
}) {
  const btnColor = color || '#60a5fa'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0.2rem 0.5rem', borderRadius: 6, border: 'none', cursor: 'pointer',
        background: active ? `${btnColor}40` : 'rgba(255,255,255,0.06)',
        color: active ? btnColor : '#71717a',
        fontWeight: 600, fontSize: '0.7rem',
      }}
    >
      {label}
    </button>
  )
}

export default CareerTimeline
