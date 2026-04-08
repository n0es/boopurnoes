/**
 * Compact stat/resource lines like the in-game log: "Speed went up by 5."
 * Increases tint "up" + value orange; decreases tint "down" + value sky blue.
 */

import type { CSSProperties, ReactElement } from 'react'
import { UMA_STAT_NAMES } from '../lib/umaStatDisplay'

const BASE = '#d6d3d1'
const UP = '#fb923c'
const DOWN = '#38bdf8'

export interface StatChangeSentenceListProps {
  /** Five values: speed … wisdom; zero/ignored entries are skipped. */
  stats: readonly number[]
  /** Skill points delta (optional). */
  skillPointsDelta?: number | null
  /** Energy delta (optional). */
  energyDelta?: number | null
  /** Per support-slot friendship deltas (optional); only non-zero lines shown. */
  friendshipGains?: readonly number[] | null
  /** Custom events: discrete mood swing (−1 / +1, etc.). */
  moodDelta?: number | null
  style?: CSSProperties
}

export function StatChangeSentenceList({
  stats,
  skillPointsDelta = null,
  energyDelta = null,
  friendshipGains = null,
  moodDelta = null,
  style,
}: StatChangeSentenceListProps) {
  const lines: ReactElement[] = []

  for (let i = 0; i < 5; i++) {
    const v = Number(stats[i] ?? 0)
    if (Math.abs(v) < 0.5) continue
    lines.push(
      <SentenceLine key={`stat-${i}`} subject={UMA_STAT_NAMES[i]} delta={v} />,
    )
  }

  if (skillPointsDelta != null && Math.abs(skillPointsDelta) >= 0.5) {
    lines.push(
      <SentenceLine key="sp" subject="Skill Pts" delta={skillPointsDelta} />,
    )
  }

  if (energyDelta != null && Math.abs(energyDelta) >= 0.5) {
    lines.push(
      <SentenceLine key="energy" subject="Energy" delta={energyDelta} />,
    )
  }

  if (friendshipGains?.length) {
    friendshipGains.forEach((g, idx) => {
      const v = Number(g ?? 0)
      if (Math.abs(v) < 0.5) return
      lines.push(
        <SentenceLine
          key={`fr-${idx}`}
          subject={`Friendship (support ${idx + 1})`}
          delta={v}
        />,
      )
    })
  }

  if (moodDelta != null && Math.abs(moodDelta) >= 0.5) {
    lines.push(<SentenceLine key="mood" subject="Mood" delta={moodDelta} />)
  }

  if (lines.length === 0) return null

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '0.55rem 0.75rem',
        fontSize: '0.82rem',
        lineHeight: 1.55,
        ...style,
      }}
    >
      {lines}
    </div>
  )
}

function SentenceLine({ subject, delta }: { subject: string; delta: number }) {
  const up = delta > 0
  const dir = up ? 'up' : 'down'
  const accent = up ? UP : DOWN
  const n = Math.round(Math.abs(delta))

  return (
    <div style={{ color: BASE }}>
      {subject} went{' '}
      <span style={{ color: accent, fontWeight: 700 }}>{dir}</span>
      {' '}by{' '}
      <span style={{ color: accent, fontWeight: 700 }}>{n}</span>
      .
    </div>
  )
}
