/**
 * AptitudeGrid — grouped aptitude letter-grade display (Track / Distance / Style rows).
 * Shared between Trainees roster detail and Career Simulator stats panel.
 *
 * Accepts either keyed object (from TurnSnapshot.aptitudes) or explicit per-field values.
 */

import type { CSSProperties } from 'react'

// ─── Grade Colors ───────────────────────────────────────────────────────────

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

// ─── Key mapping ────────────────────────────────────────────────────────────

type AptitudeRow = [string, [string, string | null][]]

const APT_KEY_ALIASES: Record<string, string> = {
  turf: 'turf', dirt: 'dirt',
  sprint: 'sprint', short: 'sprint',
  mile: 'mile',
  medium: 'medium', mid: 'medium',
  long: 'long',
  front_runner: 'front_runner', leading: 'front_runner',
  pace_chaser: 'pace_chaser', stalking: 'pace_chaser',
  late_surger: 'late_surger', mid_pack: 'late_surger',
  end_closer: 'end_closer', chasing: 'end_closer',
}

function normalizeKey(k: string): string {
  const lower = k.toLowerCase().replace(/\s+/g, '_')
  return APT_KEY_ALIASES[lower] ?? lower
}

function lookupGrade(map: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    const normalized = normalizeKey(k)
    for (const [mapKey, val] of Object.entries(map)) {
      if (normalizeKey(mapKey) === normalized) return val
    }
  }
  return null
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface AptitudeGridProps {
  /** Keyed aptitude grades from TurnSnapshot or similar (e.g. { turf: "A", dirt: "B", … }). */
  aptitudes: Record<string, string>
  style?: CSSProperties
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AptitudeGrid({ aptitudes, style }: AptitudeGridProps) {
  if (!aptitudes || Object.keys(aptitudes).length === 0) return null

  const rows: AptitudeRow[] = [
    ['Track', [
      ['Turf', lookupGrade(aptitudes, 'turf')],
      ['Dirt', lookupGrade(aptitudes, 'dirt')],
    ]],
    ['Distance', [
      ['Sprint', lookupGrade(aptitudes, 'sprint', 'short')],
      ['Mile', lookupGrade(aptitudes, 'mile')],
      ['Medium', lookupGrade(aptitudes, 'medium', 'mid')],
      ['Long', lookupGrade(aptitudes, 'long')],
    ]],
    ['Style', [
      ['Front', lookupGrade(aptitudes, 'front_runner', 'leading')],
      ['Pace', lookupGrade(aptitudes, 'pace_chaser', 'stalking')],
      ['Late', lookupGrade(aptitudes, 'late_surger', 'mid_pack')],
      ['End', lookupGrade(aptitudes, 'end_closer', 'chasing')],
    ]],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      {rows.map(([rowLabel, items]) => (
        <div key={rowLabel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, color: '#555', width: 54, flexShrink: 0,
            textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center',
          }}>
            {rowLabel}
          </span>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {items.map(([label, grade]) => {
              const gs = grade ? (GRADE_STYLE[grade.toUpperCase()] ?? GRADE_STYLE['G']) : null
              return (
                <div key={label} style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  padding: '5px 4px',
                  background: gs?.bg ?? 'rgba(255,255,255,0.04)',
                  border: `1px solid ${gs?.color ?? '#333'}`,
                  borderRadius: 6, boxSizing: 'border-box',
                }}>
                  <span style={{
                    fontSize: 9, color: gs?.color ?? '#555',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    lineHeight: 1, textAlign: 'center',
                  }}>
                    {label}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: gs?.color ?? '#444',
                    lineHeight: 1, textAlign: 'center',
                  }}>
                    {grade?.toUpperCase() ?? '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export { GRADE_STYLE }
