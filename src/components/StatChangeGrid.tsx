/**
 * StatChangeGrid — five training stats (Speed…Wisdom) with consistent colors
 * and optional signed change underneath (green / red), matching timeline / spark UI.
 */

import type { CSSProperties } from 'react'
import { UMA_STAT_COLORS, UMA_STAT_NAMES, formatSignedStatDelta } from '../lib/umaStatDisplay'

const N = 5

type DisplayMode = 'snapshot' | 'signedGains'

export interface StatChangeGridProps {
  /**
   * Five numbers in order: speed, stamina, power, guts, wisdom.
   * In `snapshot` mode: absolute values (main line).
   * In `signedGains` mode: gains/losses (single main line, colored by sign).
   */
  values: readonly number[]
  /**
   * Optional per-stat change under the main value (snapshot mode only). Ignored when displayMode is `signedGains`.
   */
  deltas?: readonly (number | null | undefined)[] | null
  displayMode?: DisplayMode
  labelMode?: 'full' | 'abbrev'
  density?: 'comfortable' | 'compact'
  /** Tint border/background when delta is non-zero (snapshot mode). */
  emphasizeNonZeroDelta?: boolean
  /**
   * When true, stats with |value| < emptyThreshold render main value as "—" and muted (inheritance bonus row).
   */
  treatSmallAsEmpty?: boolean
  emptyThreshold?: number
  /** `inheritanceBlue`: non-empty cells use blue tint; `perStat`: delta emphasis uses each stat color. */
  cellTone?: 'perStat' | 'inheritanceBlue'
  style?: CSSProperties
}

export function StatChangeGrid({
  values,
  deltas = null,
  displayMode = 'snapshot',
  labelMode = 'full',
  density = 'comfortable',
  emphasizeNonZeroDelta = true,
  treatSmallAsEmpty = false,
  emptyThreshold = 0.5,
  cellTone = 'perStat',
  style,
}: StatChangeGridProps) {
  const gap = density === 'compact' ? '0.35rem' : '0.5rem'
  const pad = density === 'compact' ? '0.45rem 0.5rem' : '0.5rem 0.6rem'
  const labelSize = density === 'compact' ? '0.65rem' : '0.68rem'
  const valueSize = density === 'compact' ? '0.95rem' : '1rem'
  const deltaSize = '0.78rem'

  const vals = padFiveNumbers(values)
  const dts = deltas
    ? padFiveNullable(deltas.map(d => (d == null ? null : Number(d))))
    : [null, null, null, null, null]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${N}, 1fr)`,
        gap,
        ...style,
      }}
    >
      {vals.map((rawValue, i) => {
        const statColor = UMA_STAT_COLORS[i]
        const label = labelMode === 'abbrev' ? UMA_STAT_NAMES[i].slice(0, 3) : UMA_STAT_NAMES[i]

        if (displayMode === 'signedGains') {
          const v = rawValue
          const isNearZero = Math.abs(v) < emptyThreshold
          const signed = formatSignedStatDelta(v)
          const mainColor = isNearZero ? '#52525b' : v > 0 ? '#4ade80' : '#f87171'
          return (
            <div
              key={i}
              style={{
                background: isNearZero ? 'rgba(255,255,255,0.03)' : `${statColor}10`,
                borderRadius: 10,
                padding: pad,
                border: `1px solid ${isNearZero ? 'rgba(255,255,255,0.05)' : `${statColor}30`}`,
              }}
            >
              <div style={{ fontSize: labelSize, color: statColor, fontWeight: 700, marginBottom: '0.15rem' }}>
                {label}
              </div>
              <div style={{ fontSize: valueSize, fontWeight: 700, color: mainColor }}>
                {isNearZero ? '—' : signed}
              </div>
            </div>
          )
        }

        const emptyMain = treatSmallAsEmpty && Math.abs(rawValue) < emptyThreshold
        const mainDisplay = emptyMain ? '—' : String(Math.round(rawValue))

        const delta = dts[i]
        const hasDelta = delta != null && delta !== 0
        const statTint = emphasizeNonZeroDelta && hasDelta && cellTone === 'perStat'
        const blueTone = cellTone === 'inheritanceBlue' && !emptyMain

        let background: string
        let border: string
        if (blueTone) {
          background = emptyMain ? 'rgba(255,255,255,0.02)' : 'rgba(96,165,250,0.08)'
          border = `1px solid ${emptyMain ? 'rgba(255,255,255,0.05)' : 'rgba(96,165,250,0.22)'}`
        } else if (statTint) {
          background = `${statColor}10`
          border = `1px solid ${statColor}30`
        } else {
          background = 'rgba(255,255,255,0.03)'
          border = '1px solid rgba(255,255,255,0.05)'
        }

        const mainNumberColor = emptyMain ? '#52525b' : blueTone ? '#93c5fd' : '#e4e4e7'

        return (
          <div
            key={i}
            style={{
              background,
              borderRadius: 10,
              padding: pad,
              border,
            }}
          >
            <div style={{
              fontSize: labelSize,
              color: statColor,
              fontWeight: 700,
              marginBottom: '0.2rem',
            }}>
              {label}
            </div>
            <div style={{
              fontSize: valueSize,
              fontWeight: 700,
              color: mainNumberColor,
            }}>
              {blueTone && !emptyMain ? `+${Math.round(rawValue)}` : mainDisplay}
            </div>
            {hasDelta && (
              <div style={{
                fontSize: deltaSize,
                fontWeight: 700,
                color: (delta as number) > 0 ? '#4ade80' : '#f87171',
                marginTop: '0.15rem',
              }}
              >
                {formatSignedStatDelta(delta as number)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function padFiveNumbers(values: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < N; i++) out.push(Number(values[i] ?? 0))
  return out
}

function padFiveNullable(values: readonly (number | null | undefined)[]): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < N; i++) {
    const v = values[i]
    out.push(v == null ? null : Number(v))
  }
  return out
}
