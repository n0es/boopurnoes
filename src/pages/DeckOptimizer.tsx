import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Link } from 'react-router-dom'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TraineeSummary {
  id: number
  name: string
  title: string | null
  rarity: number
  stat_growth: number[] | null
}

interface AlgorithmInfo {
  id: string
  name: string
  description: string
  status: string
}

interface StatBlock {
  speed: number
  stamina: number
  power: number
  guts: number
  wisdom: number
}

interface DeckScore {
  deck: { cards: [number, number][] }
  projected_stats: StatBlock
  fitness: number
  stat_sources: {
    initial_stats: StatBlock
    training_expected_value: StatBlock
    race_bonus_stats: StatBlock
  }
  warnings: string[]
  explanation: string[]
}

interface OptimizeResponse {
  results: DeckScore[]
  algorithm: string
  elapsed_ms: number
  search_info: {
    generations_run: number
    population_size: number
    total_decks_evaluated: number
    cards_in_pool: number
  }
}

interface OwnedEntry { level: number; uncap: number }
interface CardBasic { id: number; name: string; rarity: string; card_type: string }

// ─── Constants ──────────────────────────────────────────────────────────────

const OPTIMIZER_URL = import.meta.env.VITE_OPTIMIZER_URL || 'http://localhost:3001'
const STAT_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom']
const STAT_COLORS = ['#60a5fa', '#fb923c', '#f87171', '#fbbf24', '#34d399']
const DISTANCES = ['short', 'mile', 'mid', 'long']
const STRATEGIES = ['leading', 'stalking', 'mid_pack', 'chasing']
const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`

const STRATEGY_LABELS: Record<string, string> = {
  leading: 'Front Runner',
  stalking: 'Pace Chaser',
  mid_pack: 'Late Surger',
  chasing: 'End Closer',
}
const DISTANCE_LABELS: Record<string, string> = {
  short: 'Sprint',
  mile: 'Mile',
  mid: 'Medium',
  long: 'Long',
}
const SCENARIOS = [
  { id: 'default', name: 'Default' },
  { id: 'trackblazer', name: 'Trackblazer' },
  { id: 'beyond_dreams', name: 'Beyond Dreams' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeckOptimizer() {
  const { user } = useAuth()

  // Data
  const [trainees, setTrainees] = useState<TraineeSummary[]>([])
  const [algorithms, setAlgorithms] = useState<AlgorithmInfo[]>([])
  const [cards, setCards] = useState<CardBasic[]>([])
  const [ownedMap, setOwnedMap] = useState<Map<number, OwnedEntry> | null>(null)

  // Form state
  const [selectedTrainee, setSelectedTrainee] = useState<number | null>(null)
  const [selectedAlgorithm, setSelectedAlgorithm] = useState('expected_value')
  const [scenario, setScenario] = useState('default')
  const [distance, setDistance] = useState('mid')
  const [strategy, setStrategy] = useState('stalking')
  const [useOwnedOnly, setUseOwnedOnly] = useState(false)
  const [traineeSearch, setTraineeSearch] = useState('')

  // Search params
  const [popSize, setPopSize] = useState(200)
  const [generations, setGenerations] = useState(500)
  const [mutationRate, setMutationRate] = useState(0.15)

  // Results
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<OptimizeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ─── Full-width layout ──────────────────────────────────────────────────
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => { if (root) { root.style.maxWidth = ''; root.style.padding = '' } }
  }, [])

  // ─── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Load trainees from Supabase (we already have this data locally)
    supabase
      .from('trainees')
      .select('id, name, title, rarity, stat_growth')
      .order('id')
      .then(({ data }) => { if (data) setTrainees(data) })

    // Load algorithms from optimizer service
    fetch(`${OPTIMIZER_URL}/api/algorithms`)
      .then(r => r.json())
      .then(setAlgorithms)
      .catch(() => setAlgorithms([
        { id: 'expected_value', name: 'Expected Value', description: 'Deterministic EV scorer', status: 'stable' },
      ]))

    // Load cards for display
    supabase
      .from('support_cards')
      .select('id, name, rarity, card_type')
      .order('id')
      .then(({ data }) => { if (data) setCards(data) })
  }, [])

  // Load owned cards if logged in
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_support_card_collection')
      .select('card_id, level, uncap')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) {
          const m = new Map<number, OwnedEntry>()
          for (const row of data) m.set(row.card_id, { level: row.level, uncap: row.uncap })
          setOwnedMap(m)
        }
      })
  }, [user])

  // ─── Run optimization ───────────────────────────────────────────────────
  const runOptimize = useCallback(async () => {
    if (!selectedTrainee) return
    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const body: any = {
        trainee_id: selectedTrainee,
        algorithm: selectedAlgorithm,
        config: {
          scenario,
          target_distance: distance,
          target_strategy: strategy,
          turns: 72,
        },
        search_params: {
          population_size: popSize,
          generations,
          mutation_rate: mutationRate,
          top_n: 5,
        },
      }

      // If using owned cards only, send the collection
      if (useOwnedOnly && ownedMap) {
        body.owned_cards = Array.from(ownedMap.entries()).map(([card_id, entry]) => ({
          card_id,
          level: entry.level,
          uncap: entry.uncap,
        }))
      }

      const res = await fetch(`${OPTIMIZER_URL}/api/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }

      const data: OptimizeResponse = await res.json()
      setResults(data)
    } catch (e: any) {
      setError(e.message || 'Failed to connect to optimizer service')
    } finally {
      setLoading(false)
    }
  }, [selectedTrainee, selectedAlgorithm, scenario, distance, strategy, useOwnedOnly, ownedMap, popSize, generations, mutationRate])

  const selectedTraineeData = trainees.find(t => t.id === selectedTrainee)
  const cardMap = new Map(cards.map(c => [c.id, c]))

  // Filter trainees by search
  const filteredTrainees = traineeSearch
    ? trainees.filter(t =>
        t.name.toLowerCase().includes(traineeSearch.toLowerCase()) ||
        (t.title && t.title.toLowerCase().includes(traineeSearch.toLowerCase()))
      )
    : trainees

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ position: 'fixed', top: 0, left: 0, padding: '1.5rem 2rem', zIndex: 10 }}>
        <Link to="/" className="back">&larr; back</Link>
      </header>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem', marginTop: '2rem' }}>
        Deck Optimizer
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Find the mathematically optimal 6-card support deck for any trainee.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* ─── Left column: Configuration ─────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Trainee selector */}
          <Section title="Trainee">
            <input
              type="text"
              placeholder="Search trainees..."
              value={traineeSearch}
              onChange={e => setTraineeSearch(e.target.value)}
              style={inputStyle}
            />
            <div style={{
              maxHeight: 200, overflow: 'auto', border: '1px solid #333',
              borderRadius: 6, marginTop: 8
            }}>
              {filteredTrainees.map(t => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTrainee(t.id)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    background: selectedTrainee === t.id ? '#1a1a2e' : 'transparent',
                    borderBottom: '1px solid #222',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.875rem' }}>
                    {t.title ? `[${t.title}] ` : ''}{t.name}
                  </span>
                  {t.stat_growth && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {t.stat_growth.map((g, i) => `${STAT_NAMES[i][0]}:${g}%`).join(' ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Algorithm */}
          <Section title="Algorithm">
            <div style={{ display: 'flex', gap: 8 }}>
              {algorithms.map(a => (
                <button
                  key={a.id}
                  onClick={() => a.status === 'stable' && setSelectedAlgorithm(a.id)}
                  style={{
                    ...chipStyle,
                    background: selectedAlgorithm === a.id ? '#2563eb' : '#1a1a1a',
                    opacity: a.status === 'stable' ? 1 : 0.4,
                    cursor: a.status === 'stable' ? 'pointer' : 'not-allowed',
                  }}
                >
                  {a.name}
                  {a.status !== 'stable' && <span style={{ fontSize: '0.6rem', marginLeft: 4 }}>soon</span>}
                </button>
              ))}
            </div>
          </Section>

          {/* Scenario */}
          <Section title="Scenario">
            <div style={{ display: 'flex', gap: 8 }}>
              {SCENARIOS.map(s => (
                <button key={s.id} onClick={() => setScenario(s.id)}
                  style={{ ...chipStyle, background: scenario === s.id ? '#2563eb' : '#1a1a1a' }}>
                  {s.name}
                </button>
              ))}
            </div>
          </Section>

          {/* Distance + Strategy */}
          <Section title="Target Race">
            <label style={labelStyle}>Distance</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {DISTANCES.map(d => (
                <button key={d} onClick={() => setDistance(d)}
                  style={{ ...chipStyle, background: distance === d ? '#2563eb' : '#1a1a1a' }}>
                  {DISTANCE_LABELS[d]}
                </button>
              ))}
            </div>
            <label style={labelStyle}>Strategy</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {STRATEGIES.map(s => (
                <button key={s} onClick={() => setStrategy(s)}
                  style={{ ...chipStyle, background: strategy === s ? '#2563eb' : '#1a1a1a' }}>
                  {STRATEGY_LABELS[s]}
                </button>
              ))}
            </div>
          </Section>

          {/* Collection filter */}
          {user && ownedMap && (
            <Section title="Card Pool">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={useOwnedOnly}
                  onChange={e => setUseOwnedOnly(e.target.checked)} />
                Only use cards I own ({ownedMap.size} cards)
              </label>
            </Section>
          )}

          {/* Search params (collapsible) */}
          <details>
            <summary style={{ color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', marginBottom: 8 }}>
              Advanced: Search Parameters
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <label style={labelStyle}>Population</label>
                <input type="number" value={popSize} onChange={e => setPopSize(+e.target.value)}
                  style={inputStyle} min={50} max={2000} step={50} />
              </div>
              <div>
                <label style={labelStyle}>Generations</label>
                <input type="number" value={generations} onChange={e => setGenerations(+e.target.value)}
                  style={inputStyle} min={50} max={5000} step={50} />
              </div>
              <div>
                <label style={labelStyle}>Mutation Rate</label>
                <input type="number" value={mutationRate} onChange={e => setMutationRate(+e.target.value)}
                  style={inputStyle} min={0.01} max={0.5} step={0.01} />
              </div>
            </div>
          </details>

          {/* Run button */}
          <button
            onClick={runOptimize}
            disabled={!selectedTrainee || loading}
            style={{
              padding: '12px 24px', borderRadius: 8, border: 'none',
              background: selectedTrainee && !loading ? '#2563eb' : '#333',
              color: '#fff', fontWeight: 600, fontSize: '1rem',
              cursor: selectedTrainee && !loading ? 'pointer' : 'not-allowed',
              transition: 'background 0.2s',
            }}
          >
            {loading ? 'Optimizing...' : 'Find Best Deck'}
          </button>

          {error && (
            <div style={{ color: '#f87171', fontSize: '0.875rem', padding: '8px 12px', background: '#1a0000', borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>

        {/* ─── Right column: Results ──────────────────────────────────── */}
        <div>
          {results && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Meta info */}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Algorithm: {results.algorithm} · {results.elapsed_ms}ms ·
                {results.search_info.total_decks_evaluated.toLocaleString()} decks evaluated ·
                {results.search_info.cards_in_pool} cards in pool
              </div>

              {/* Result cards */}
              {results.results.map((result, rank) => (
                <ResultCard
                  key={rank}
                  rank={rank + 1}
                  result={result}
                  cardMap={cardMap}
                  trainee={selectedTraineeData}
                />
              ))}
            </div>
          )}

          {!results && !loading && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 300, color: 'var(--text-muted)', fontSize: '0.875rem',
              border: '1px dashed #333', borderRadius: 8,
            }}>
              Select a trainee and click "Find Best Deck" to start
            </div>
          )}

          {loading && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 300, color: 'var(--text-muted)', fontSize: '0.875rem',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#9881;</div>
                Running genetic search...
                <br />
                <span style={{ fontSize: '0.75rem' }}>
                  {popSize} population × {generations} generations
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function ResultCard({
  rank, result, cardMap, trainee
}: {
  rank: number
  result: DeckScore
  cardMap: Map<number, CardBasic>
  trainee?: TraineeSummary | null
}) {
  const stats = result.projected_stats
  const total = stats.speed + stats.stamina + stats.power + stats.guts + stats.wisdom
  const [expanded, setExpanded] = useState(rank === 1)

  return (
    <div style={{
      background: '#111', border: '1px solid #222', borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '12px 16px', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: expanded ? '1px solid #222' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 24, height: 24, borderRadius: '50%', background: '#2563eb',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 700,
          }}>
            {rank}
          </span>
          <span style={{ fontWeight: 600 }}>
            Total: {total.toFixed(0)}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            fitness: {result.fitness.toFixed(1)}
          </span>
        </div>
        <span style={{ color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: 16 }}>
          {/* Stat bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {STAT_NAMES.map((name, i) => {
              const val = [stats.speed, stats.stamina, stats.power, stats.guts, stats.wisdom][i]
              const pct = Math.min(100, (val / 1200) * 100)
              return (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 60, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{name}</span>
                  <div style={{ flex: 1, height: 12, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: STAT_COLORS[i], borderRadius: 4,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <span style={{ width: 40, fontSize: '0.75rem', textAlign: 'right' }}>
                    {val.toFixed(0)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Deck cards */}
          <h4 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Deck
          </h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {result.deck.cards.map(([cardId, level], i) => {
              const card = cardMap.get(cardId)
              return (
                <div key={i} style={{
                  background: '#1a1a1a', borderRadius: 6, padding: '6px 10px',
                  fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6,
                  border: '1px solid #333',
                }}>
                  {card && (
                    <img
                      src={`${SUPABASE_STORAGE}/supports/icons/${cardId}.png`}
                      style={{ width: 24, height: 24, borderRadius: 4 }}
                      onError={e => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  <span>{card?.name || `Card #${cardId}`}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Lv{level}</span>
                </div>
              )
            })}
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {result.warnings.map((w, i) => (
                <div key={i} style={{
                  fontSize: '0.8rem', color: '#fbbf24', padding: '4px 8px',
                  background: 'rgba(251,191,36,0.1)', borderRadius: 4, marginBottom: 4,
                }}>
                  &#9888; {w}
                </div>
              ))}
            </div>
          )}

          {/* Explanation (collapsible) */}
          <details>
            <summary style={{ color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}>
              Score breakdown
            </summary>
            <pre style={{
              fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8,
              whiteSpace: 'pre-wrap', lineHeight: 1.5,
            }}>
              {result.explanation.join('\n')}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  border: '1px solid #333', background: '#111', color: '#fff',
  fontSize: '0.875rem', outline: 'none',
}

const chipStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 20, border: '1px solid #333',
  color: '#fff', fontSize: '0.8rem', cursor: 'pointer',
  transition: 'background 0.2s',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)',
  marginBottom: 4,
}
