import { useMemo, useState } from 'react'
import { DeckPreviewCard } from './DeckPreviewCard'

const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`

function artUrl(id: number) {
  return `${SUPABASE_STORAGE}/supports/art/${id}.png`
}

export interface DeckBuilderPickableCard {
  id: number
  name: string
  rarity: string
  card_type: string
  displayLevel: number
  wildcardPreview: boolean
}

export type DeckBuilderForcedSlot = { cardId: number; level: number } | null

interface DeckBuilderForcedSlotsProps {
  slots: DeckBuilderForcedSlot[]
  onSlotsChange: (next: DeckBuilderForcedSlot[]) => void
  /** Cards allowed when opening the picker for `slotIndex`. */
  pickableForSlot: (slotIndex: number) => DeckBuilderPickableCard[]
  getSlotPreview: (slotIndex: number) => DeckBuilderPickableCard | undefined
  /** Default training level when a card is chosen (usually max for uncap). */
  defaultTrainLevel: (cardId: number, slotIndex: number) => number
  /** Max training level for the current card in `slotIndex` (1–max). */
  maxTrainLevel: (slotIndex: number) => number
  disabled?: boolean
}

const SLOT_LABELS = ['1', '2', '3', '4', '5', 'Friend']

export function DeckBuilderForcedSlots({
  slots,
  onSlotsChange,
  pickableForSlot,
  getSlotPreview,
  defaultTrainLevel,
  maxTrainLevel,
  disabled = false,
}: DeckBuilderForcedSlotsProps) {
  const [pickerSlot, setPickerSlot] = useState<number | null>(null)
  const [query, setQuery] = useState('')

  const list = useMemo(() => {
    if (pickerSlot === null) return []
    const raw = pickableForSlot(pickerSlot)
    const q = query.trim().toLowerCase()
    if (!q) return raw
    return raw.filter(c => c.name.toLowerCase().includes(q))
  }, [pickerSlot, pickableForSlot, query])

  function clearSlot(i: number) {
    const next: DeckBuilderForcedSlot[] = [...slots]
    next[i] = null
    onSlotsChange(next)
  }

  function pickCard(cardId: number) {
    if (pickerSlot === null) return
    const next: DeckBuilderForcedSlot[] = [...slots]
    const lv = defaultTrainLevel(cardId, pickerSlot)
    next[pickerSlot] = { cardId, level: lv }
    onSlotsChange(next)
    setPickerSlot(null)
    setQuery('')
  }

  function setTrainLevel(slotIndex: number, raw: string) {
    const s = slots[slotIndex]
    if (!s) return
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const maxLv = maxTrainLevel(slotIndex)
    const level = Math.max(1, Math.min(Math.floor(n), maxLv))
    const next: DeckBuilderForcedSlot[] = [...slots]
    next[slotIndex] = { cardId: s.cardId, level }
    onSlotsChange(next)
  }

  function clearAll() {
    onSlotsChange([null, null, null, null, null, null])
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#a3a3a3' }}>Fixed cards (optional)</span>
        <button
          type="button"
          disabled={disabled || slots.every(s => s == null)}
          onClick={clearAll}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: '#71717a',
            fontSize: 11,
            cursor: slots.every(s => s == null) || disabled ? 'default' : 'pointer',
            opacity: slots.every(s => s == null) || disabled ? 0.4 : 1,
          }}
        >
          Clear fixed
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 6,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {SLOT_LABELS.map((label, i) => {
          const card = getSlotPreview(i)
          const isFriend = i === 5
          return (
            <div key={i} style={{ flexShrink: 0, width: 102 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: isFriend ? '#fda4af' : '#71717a',
                  textAlign: 'center',
                  marginBottom: 4,
                  letterSpacing: 0.04,
                }}
              >
                {label}
              </div>
              {card ? (
                <div style={{ position: 'relative' }}>
                  <DeckPreviewCard
                    artSrc={artUrl(card.id)}
                    name={card.name}
                    rarity={card.rarity}
                    cardType={card.card_type}
                    displayLevel={card.displayLevel}
                    wildcard={card.wildcardPreview}
                    compact
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => clearSlot(i)}
                    aria-label="Remove card"
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(0,0,0,0.75)',
                      color: '#e5e5e5',
                      fontSize: 12,
                      lineHeight: 1,
                      cursor: disabled ? 'default' : 'pointer',
                      padding: 0,
                      zIndex: 10,
                    }}
                  >
                    ×
                  </button>
                  <label
                    style={{
                      display: 'block',
                      marginTop: 6,
                      fontSize: 9,
                      color: '#71717a',
                      textAlign: 'center',
                    }}
                  >
                    Lv
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={maxTrainLevel(i)}
                      value={slots[i]!.level}
                      disabled={disabled}
                      onChange={e => setTrainLevel(i, e.target.value)}
                      style={{
                        marginLeft: 4,
                        width: 44,
                        padding: '2px 4px',
                        fontSize: 11,
                        borderRadius: 4,
                        border: '1px solid #2a2a38',
                        background: '#1a1a22',
                        color: '#e5e5e5',
                        boxSizing: 'border-box',
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPickerSlot(i)}
                    style={{
                      marginTop: 6,
                      width: '100%',
                      padding: '4px 0',
                      fontSize: 10,
                      borderRadius: 6,
                      border: '1px solid #2a2a38',
                      background: '#14141a',
                      color: '#a1a1aa',
                      cursor: disabled ? 'default' : 'pointer',
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setQuery('')
                    setPickerSlot(i)
                  }}
                  style={{
                    width: '100%',
                    aspectRatio: '3 / 4',
                    maxHeight: 136,
                    borderRadius: 12,
                    border: '2px dashed rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.45 : 1,
                    boxSizing: 'border-box',
                  }}
                >
                  <span style={{ fontSize: 20, color: '#52525b', lineHeight: 1 }}>+</span>
                  <span style={{ fontSize: 10, color: '#71717a', fontWeight: 600 }}>Choose</span>
                </button>
              )}
            </div>
          )
        })}
      </div>

      {pickerSlot !== null && (
        <div
          role="dialog"
          aria-modal
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => {
            setPickerSlot(null)
            setQuery('')
          }}
        >
          <div
            style={{
              width: 'min(440px, 100%)',
              maxHeight: 'min(520px, 85vh)',
              background: '#12121a',
              borderRadius: 12,
              border: '1px solid #2a2a38',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #252530' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e5e5', marginBottom: 8 }}>
                Slot {SLOT_LABELS[pickerSlot]} — pick a card
              </div>
              <input
                type="search"
                placeholder="Search by name…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: '#1a1a22',
                  border: '1px solid #2a2a38',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '6px 8px' }}>
              {list.length === 0 ? (
                <div style={{ padding: 16, fontSize: 12, color: '#71717a', textAlign: 'center' }}>
                  No cards match.
                </div>
              ) : (
                list.map(c => {
                  const takenElsewhere = slots.some(
                    (s, idx) => idx !== pickerSlot && s != null && s.cardId === c.id,
                  )
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={takenElsewhere}
                      onClick={() => pickCard(c.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        marginBottom: 4,
                        borderRadius: 8,
                        border: '1px solid transparent',
                        background: 'transparent',
                        cursor: takenElsewhere ? 'default' : 'pointer',
                        opacity: takenElsewhere ? 0.35 : 1,
                        textAlign: 'left',
                      }}
                    >
                      <img
                        src={artUrl(c.id)}
                        alt=""
                        style={{
                          width: 40,
                          height: 53,
                          objectFit: 'cover',
                          borderRadius: 6,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#e5e5e5',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#71717a' }}>
                          {c.rarity} · {c.card_type}
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
            <div style={{ padding: 10, borderTop: '1px solid #252530' }}>
              <button
                type="button"
                onClick={() => {
                  setPickerSlot(null)
                  setQuery('')
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #3f3f46',
                  background: '#1c1c24',
                  color: '#a1a1aa',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
