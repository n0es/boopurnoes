import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface SupportCard {
  id: number
  name: string
  rarity: string
  card_type: string
}

const CARD_TYPES = ['speed', 'stamina', 'power', 'guts', 'intelligence', 'friend', 'group']

const SUPABASE_STORAGE = 'https://supabase.boopurno.es/storage/v1/object/public/umamusume'

function getArtUrl(id: number) {
  return `${SUPABASE_STORAGE}/supports/art/${id}.png`
}

function getIconUrl(id: number) {
  return `${SUPABASE_STORAGE}/supports/icons/${id}.png`
}

function getTypeIconUrl(cardType: string) {
  return `${SUPABASE_STORAGE}/icons/${cardType}.png`
}

export default function SupportCards() {
  const [cards, setCards] = useState<SupportCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedRarity, setSelectedRarity] = useState<string | null>(null)

  useEffect(() => {
    async function fetchCards() {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('support_cards')
        .select('id, name, rarity, card_type')
        .order('id', { ascending: true })

      if (error) {
        setError(error.message)
      } else {
        setCards(data ?? [])
      }
      setLoading(false)
    }

    fetchCards()
  }, [])

  const filtered = cards.filter(card => {
    if (selectedType && card.card_type !== selectedType) return false
    if (selectedRarity && card.rarity !== selectedRarity) return false
    return true
  })

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', color: '#fff', fontFamily: 'sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/" style={{ color: '#aaa', textDecoration: 'none', fontSize: 14 }}>← Home</a>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Support Cards</h1>
      </div>

      {/* Filters */}
      <div style={{ padding: '20px 32px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Rarity filters */}
        <div style={{ display: 'flex', gap: 8 }}>
          {['SSR', 'SR', 'R'].map(r => (
            <button
              key={r}
              onClick={() => setSelectedRarity(selectedRarity === r ? null : r)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: '1px solid',
                borderColor: selectedRarity === r ? '#e8b4f8' : '#444',
                background: selectedRarity === r ? '#3a1f4a' : 'transparent',
                color: selectedRarity === r ? '#e8b4f8' : '#aaa',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 28, background: '#333' }} />

        {/* Type filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CARD_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setSelectedType(selectedType === type ? null : type)}
              style={{
                padding: '4px 8px',
                borderRadius: 20,
                border: '2px solid',
                borderColor: selectedType === type ? '#fff' : 'transparent',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: selectedType && selectedType !== type ? 0.4 : 1,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
              title={type}
            >
              <img
                src={getTypeIconUrl(type)}
                alt={type}
                style={{ width: 28, height: 28, objectFit: 'contain' }}
              />
            </button>
          ))}
        </div>

        <span style={{ marginLeft: 'auto', color: '#666', fontSize: 13 }}>
          {filtered.length} card{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Content */}
      <div style={{ padding: '8px 32px 48px' }}>
        {loading && (
          <div style={{ textAlign: 'center', color: '#666', paddingTop: 80 }}>Loading cards…</div>
        )}

        {error && (
          <div style={{ color: '#f87171', background: '#2a1a1a', borderRadius: 8, padding: '12px 16px', maxWidth: 400 }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
          }}>
            {filtered.map(card => (
              <CardTile key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CardTile({ card }: { card: SupportCard }) {
  const [artLoaded, setArtLoaded] = useState(false)

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#1a1a22',
        aspectRatio: '3 / 4',
        boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.7)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.5)'
      }}
    >
      {/* Full art background */}
      <img
        src={getArtUrl(card.id)}
        alt={card.name}
        onLoad={() => setArtLoaded(true)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: artLoaded ? 1 : 0,
          transition: 'opacity 0.3s',
        }}
      />

      {/* Skeleton while loading */}
      {!artLoaded && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, #1e1e2a 0%, #2a2a38 50%, #1e1e2a 100%)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      )}

      {/* Bottom gradient + name */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '32px 8px 8px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', lineHeight: 1.3, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
          {card.name}
        </div>
        <div style={{ fontSize: 10, color: '#ccc', marginTop: 2, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
          {card.rarity}
        </div>
      </div>

      {/* Top-left: card icon */}
      <div style={{
        position: 'absolute',
        top: 6,
        left: 6,
        width: 40,
        height: 40,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 2px 6px rgba(0,0,0,0.7)',
        border: '1px solid rgba(255,255,255,0.15)',
      }}>
        <img
          src={getIconUrl(card.id)}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      {/* Top-right: card type icon */}
      <div style={{
        position: 'absolute',
        top: 6,
        right: 6,
        width: 28,
        height: 28,
        filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.8))',
      }}>
        <img
          src={getTypeIconUrl(card.card_type)}
          alt={card.card_type}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    </div>
  )
}
