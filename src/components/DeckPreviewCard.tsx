import type { CSSProperties, ReactNode } from 'react'
import { maxLevelForUncap, uncapDisplayForTrainLevel } from '../lib/supportCardLevel'

const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`

/** Thickness of the rarity frame drawn *inside* the artwork (clips the image). */
const BORDER_INSET = 4

/** Wildcard-only inset border (vibrant pink, in-game style). */
const WILDCARD_PINK = '#ff6699'

const SSR_GRADIENT =
  'linear-gradient(135deg, #f472b6 0%, #c084fc 12%, #7c3aed 26%, #2563eb 42%, #38bdf8 56%, #2dd4bf 72%, #facc15 100%)'

function typeIconUrl(cardType: string) {
  return `${SUPABASE_STORAGE}/icons/${cardType}.png`
}

function typeLabel(cardType: string): string {
  const m: Record<string, string> = {
    speed: 'Speed',
    stamina: 'Stamina',
    power: 'Power',
    guts: 'Guts',
    intelligence: 'Wit',
    friend: 'Friend',
    group: 'Group',
  }
  return m[cardType] ?? cardType
}

const RARITY_BADGE_W = 38
const RARITY_BADGE_H = 22

function RarityBadge({ rarity }: { rarity: string }) {
  const r = rarity.toUpperCase()
  const isSSR = r === 'SSR'
  const isSR = r === 'SR'
  return (
    <div
      style={{
        position: 'absolute',
        top: 2,
        left: 2,
        zIndex: 4,
        width: RARITY_BADGE_W,
        height: RARITY_BADGE_H,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        fontSize: isSSR ? 10 : 11,
        fontWeight: 800,
        letterSpacing: isSSR ? '-0.04em' : 0.02,
        color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.75)',
        background: isSSR
          ? 'linear-gradient(145deg, #e879f9 0%, #a855f7 40%, #6366f1 100%)'
          : isSR
            ? 'linear-gradient(180deg, #fcd34d 0%, #d97706 100%)'
            : 'linear-gradient(180deg, #9ca3af 0%, #4b5563 100%)',
        border: '1px solid rgba(255,255,255,0.35)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
      }}
    >
      <span
        style={{
          display: 'block',
          lineHeight: 1,
          transform: isSSR ? 'scaleX(0.88)' : undefined,
          transformOrigin: 'center',
        }}
      >
        {r}
      </span>
    </div>
  )
}

function TypeIcon({ cardType }: { cardType: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 2,
        right: 2,
        zIndex: 4,
        width: 30,
        height: 30,
        borderRadius: 7,
        background: 'rgba(15,23,42,0.45)',
        border: '1px solid rgba(255,255,255,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      <img
        src={typeIconUrl(cardType)}
        alt={typeLabel(cardType)}
        title={typeLabel(cardType)}
        style={{ width: 24, height: 24, objectFit: 'contain', display: 'block' }}
      />
    </div>
  )
}

function UncapRow({ value, max = 4, compact }: { value: number; max?: number; compact?: boolean }) {
  const gap = compact ? 2 : 3
  const d = compact ? 7 : 9
  return (
    <div style={{ display: 'flex', gap, alignItems: 'center' }}>
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value
        return (
          <div
            key={i}
            style={{
              width: d,
              height: d,
              transform: 'rotate(45deg)',
              background: filled ? '#22d3ee' : 'transparent',
              border: `1.5px solid ${filled ? '#67e8f9' : '#94a3b8'}`,
              borderRadius: 1,
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}

function InsetRarityBorder({ rarity, wildcard }: { rarity: string; wildcard: boolean }) {
  if (wildcard) {
    return (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          borderRadius: 12,
          boxShadow: `inset 0 0 0 ${BORDER_INSET}px ${WILDCARD_PINK}`,
          pointerEvents: 'none',
        }}
      />
    )
  }

  const r = rarity.toUpperCase()

  if (r === 'SSR') {
    const ring: CSSProperties = {
      position: 'absolute',
      inset: 0,
      zIndex: 3,
      borderRadius: 12,
      padding: BORDER_INSET,
      background: SSR_GRADIENT,
      WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      WebkitMaskComposite: 'xor',
      mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      maskComposite: 'exclude',
      pointerEvents: 'none',
    }
    return <div style={ring} aria-hidden />
  }

  const color = r === 'SR' ? '#d4af37' : '#78716c'
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        borderRadius: 12,
        boxShadow: `inset 0 0 0 ${BORDER_INSET}px ${color}`,
        pointerEvents: 'none',
      }}
    />
  )
}

function CardShell({
  rarity,
  wildcard,
  children,
}: {
  rarity: string
  wildcard: boolean
  children: ReactNode
}) {
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '3 / 4',
        width: '100%',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#0f172a',
        boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
      }}
    >
      {children}
      <InsetRarityBorder rarity={rarity} wildcard={wildcard} />
    </div>
  )
}

export interface DeckPreviewCardProps {
  artSrc: string
  name: string
  rarity: string
  cardType: string
  displayLevel: number
  /** Wildcard slot: pink border, raised level row, bottom type strip (e.g. Friends). */
  wildcard?: boolean
  /** Narrower card + type for dense lists (e.g. deck builder results). */
  compact?: boolean
}

export function DeckPreviewCard({
  artSrc,
  name,
  rarity,
  cardType,
  displayLevel,
  wildcard = false,
  compact = false,
}: DeckPreviewCardProps) {
  const uncapDiamonds = uncapDisplayForTrainLevel(displayLevel, rarity)
  const cw = compact ? 102 : 132
  const levelFs = compact ? 12 : 15
  const nameFs = compact ? 10 : 11

  const levelFooter = (
    <div
      style={{
        padding: wildcard
          ? compact
            ? '5px 6px 6px'
            : '7px 8px 9px'
          : compact
            ? '7px 6px 6px'
            : '10px 8px 8px',
        paddingBottom: wildcard ? (compact ? 6 : 9) : Math.max(compact ? 6 : 8, BORDER_INSET + 2),
        background: 'linear-gradient(to top, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.78) 50%, transparent 100%)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: compact ? 4 : 6,
      }}
    >
      <UncapRow value={uncapDiamonds} compact={compact} />
      <span
        style={{
          fontSize: levelFs,
          fontWeight: 800,
          color: '#5c3d2e',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          letterSpacing: -0.02,
          lineHeight: 1,
        }}
      >
        Lvl {displayLevel}
      </span>
    </div>
  )

  return (
    <div style={{ width: cw, flexShrink: 0 }}>
      <CardShell rarity={rarity} wildcard={wildcard}>
        <img
          src={artSrc}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            zIndex: 0,
          }}
        />
        <RarityBadge rarity={rarity} />
        <TypeIcon cardType={cardType} />

        {wildcard ? (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {levelFooter}
            <div
              style={{
                background: WILDCARD_PINK,
                padding: compact ? '5px 6px 6px' : '7px 8px 8px',
                textAlign: 'center',
                color: '#fff',
                fontSize: compact ? 11 : 13,
                fontWeight: 600,
                letterSpacing: 0.03,
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                textShadow: '0 1px 2px rgba(0,0,0,0.2)',
              }}
            >
              Friends
            </div>
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 2,
            }}
          >
            {levelFooter}
          </div>
        )}
      </CardShell>
      <div
        style={{
          marginTop: compact ? 6 : 8,
          fontSize: nameFs,
          color: '#d4d4d8',
          lineHeight: 1.35,
          fontWeight: 500,
          textAlign: 'center',
        }}
      >
        {name}
      </div>
    </div>
  )
}

export function plannedDisplayLevel(rarity: string, uncap: number, wildcard: boolean): number {
  return maxLevelForUncap(wildcard ? 4 : uncap, rarity)
}
