import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Link } from 'react-router-dom'
import type { ReleaseMetadata } from '../lib/releaseMetadata'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Trainee extends ReleaseMetadata {
  id: number
  name: string
  name_jp: string | null
  title: string | null
  rarity: number
  stat_growth: number[] | null
  icon_path: string | null
}

interface TraineeCollectionEntry {
  star_rank: number
  awakening_level: number
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

interface GenerationUpdate {
  generation: number
  total_generations: number
  best_fitness: number
  top_decks: DeckScore[]
  decks_evaluated: number
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

interface OwnedCardEntry { level: number; uncap: number }
interface CardBasic extends ReleaseMetadata { id: number; name: string; rarity: string; card_type: string }

// ─── Constants ──────────────────────────────────────────────────────────────

// In dev, requests go through Vite's proxy to avoid mixed-content (HTTPS page → HTTP service).
// In production, set VITE_OPTIMIZER_URL to the actual optimizer endpoint.
const OPTIMIZER_URL = import.meta.env.VITE_OPTIMIZER_URL || '/optimizer-api'
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

const RARITY_STYLE: Record<number, { color: string; bg: string }> = {
  1: { color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' },
  2: { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  3: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
}

function getIconUrl(trainee: Trainee) {
  const path = trainee.icon_path ?? `trainees/icons/${trainee.id}.png`
  return `${SUPABASE_STORAGE}/${path}`
}

// ─── SSE Parser ─────────────────────────────────────────────────────────────

/** Parse SSE text chunks from a ReadableStream into typed events. */
function parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onProgress: (data: GenerationUpdate) => void,
  onDone: (data: GenerationUpdate) => void,
  onError: (err: string) => void,
) {
  const decoder = new TextDecoder()
  let buffer = ''

  function processLines() {
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep incomplete line

    let currentEvent = ''
    let currentData = ''

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        currentData = line.slice(5).trim()
      } else if (line === '' && currentData) {
        // Empty line = end of SSE message
        try {
          const parsed = JSON.parse(currentData)
          if (currentEvent === 'done') {
            onDone(parsed)
          } else if (currentEvent === 'progress') {
            onProgress(parsed)
          } else if (currentEvent === 'error') {
            onError(parsed)
          }
        } catch {
          // ignore malformed JSON
        }
        currentEvent = ''
        currentData = ''
      }
    }
  }

  function read(): Promise<void> {
    return reader.read().then(({ done, value }) => {
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      processLines()
      return read()
    })
  }

  return read().catch(err => onError(String(err)))
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeckOptimizer() {
  const { user } = useAuth()

  // Data
  const [trainees, setTrainees] = useState<Trainee[]>([])
  const [traineeCollection, setTraineeCollection] = useState<Map<number, TraineeCollectionEntry>>(new Map())
  const [algorithms, setAlgorithms] = useState<AlgorithmInfo[]>([])
  const [cards, setCards] = useState<CardBasic[]>([])
  const [ownedCardMap, setOwnedCardMap] = useState<Map<number, OwnedCardEntry> | null>(null)

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

  // Results & streaming state
  const [loading, setLoading] = useState(false)
  const [paused, setPaused] = useState(false)
  const [results, setResults] = useState<OptimizeResponse | null>(null)
  const [liveDecks, setLiveDecks] = useState<DeckScore[] | null>(null)
  const [progress, setProgress] = useState<{ gen: number; total: number; fitness: number; evaluated: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ─── Full-width layout ──────────────────────────────────────────────────
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => { if (root) { root.style.maxWidth = ''; root.style.padding = '' } }
  }, [])

  // ─── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('trainees')
      .select('id, name, name_jp, title, rarity, stat_growth, icon_path, released_jp, released_global, release_global_is_approximate, release_source')
      .order('name')
      .then(({ data }) => { if (data) setTrainees(data) })

    fetch(`${OPTIMIZER_URL}/api/algorithms`)
      .then(r => r.json())
      .then(setAlgorithms)
      .catch(() => setAlgorithms([
        { id: 'expected_value', name: 'Expected Value', description: 'Deterministic EV scorer', status: 'stable' },
      ]))

    supabase
      .from('support_cards')
      .select('id, name, rarity, card_type, released_jp, released_global, release_global_is_approximate, release_source')
      .order('id')
      .then(({ data }) => { if (data) setCards(data) })
  }, [])

  // Load user's trainee collection
  useEffect(() => {
    if (!user) { setTraineeCollection(new Map()); return }
    supabase
      .from('user_trainee_collection')
      .select('trainee_id, star_rank, awakening_level')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const m = new Map<number, TraineeCollectionEntry>()
        if (data) {
          for (const row of data) {
            m.set(row.trainee_id, { star_rank: row.star_rank, awakening_level: row.awakening_level })
          }
        }
        setTraineeCollection(m)
      })
  }, [user])

  // Load owned support cards if logged in
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_support_card_collection')
      .select('card_id, level, uncap')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) {
          const m = new Map<number, OwnedCardEntry>()
          for (const row of data) m.set(row.card_id, { level: row.level, uncap: row.uncap })
          setOwnedCardMap(m)
        }
      })
  }, [user])

  // ─── Derived: only show owned trainees ────────────────────────────────
  const ownedTrainees = trainees.filter(t => traineeCollection.has(t.id))

  const filteredTrainees = traineeSearch
    ? ownedTrainees.filter(t =>
        t.name.toLowerCase().includes(traineeSearch.toLowerCase()) ||
        (t.title && t.title.toLowerCase().includes(traineeSearch.toLowerCase())) ||
        (t.name_jp && t.name_jp.toLowerCase().includes(traineeSearch.toLowerCase()))
      )
    : ownedTrainees

  const selectedTraineeData = trainees.find(t => t.id === selectedTrainee) ?? null
  const selectedCollection = selectedTrainee ? traineeCollection.get(selectedTrainee) ?? null : null
  const cardMap = new Map(cards.map(c => [c.id, c]))

  // ─── Pause / Resume ───────────────────────────────────────────────────
  const togglePause = useCallback(async () => {
    const endpoint = paused ? 'resume' : 'pause'
    await fetch(`${OPTIMIZER_URL}/api/optimize/${endpoint}`, { method: 'POST' }).catch(() => {})
    setPaused(!paused)
  }, [paused])

  // ─── Run optimization (streaming) ─────────────────────────────────────
  const runOptimize = useCallback(async () => {
    if (!selectedTrainee || !selectedCollection) return
    setLoading(true)
    setPaused(false)
    setError(null)
    setResults(null)
    setLiveDecks(null)
    setProgress(null)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const body: Record<string, unknown> = {
        trainee_id: selectedTrainee,
        star_rank: selectedCollection.star_rank,
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

      if (useOwnedOnly && ownedCardMap) {
        body.owned_cards = Array.from(ownedCardMap.entries()).map(([card_id, entry]) => ({
          card_id,
          level: entry.level,
          uncap: entry.uncap,
        }))
      }

      const res = await fetch(`${OPTIMIZER_URL}/api/optimize/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }

      if (!res.body) throw new Error('No response body (streaming not supported)')

      const reader = res.body.getReader()

      const startTime = Date.now()

      await parseSSE(
        reader,
        // onProgress
        (update) => {
          setLiveDecks(update.top_decks)
          setProgress({
            gen: update.generation,
            total: update.total_generations,
            fitness: update.best_fitness,
            evaluated: update.decks_evaluated,
          })
        },
        // onDone
        (update) => {
          const elapsed = Date.now() - startTime
          setResults({
            results: update.top_decks,
            algorithm: selectedAlgorithm,
            elapsed_ms: elapsed,
            search_info: {
              generations_run: update.total_generations,
              population_size: popSize,
              total_decks_evaluated: update.decks_evaluated,
              cards_in_pool: 0,
            },
          })
          setLiveDecks(null)
          setProgress(null)
          setLoading(false)
        },
        // onError
        (err) => {
          setError(String(err))
          setLoading(false)
        },
      )

      // Stream ended without a done event (connection closed)
      setLoading(false)
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'Failed to connect to optimizer service')
      }
      setLoading(false)
    }
  }, [selectedTrainee, selectedCollection, selectedAlgorithm, scenario, distance, strategy, useOwnedOnly, ownedCardMap, popSize, generations, mutationRate])

  // Show whichever results are available: final or live
  const displayDecks = results?.results ?? liveDecks
  const isStreaming = loading && !results

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ position: 'fixed', top: 0, left: 0, padding: '1.5rem 2rem', zIndex: 10 }}>
        <Link to="/umamusume" className="back">&larr; back</Link>
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

          {/* Trainee selector — icon grid */}
          <Section title={`Your Trainees (${ownedTrainees.length})`}>
            {ownedTrainees.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No trainees in your collection. Add some on the <Link to="/trainees" style={{ color: '#60a5fa' }}>Trainees</Link> page.
              </p>
            )}

            {ownedTrainees.length > 8 && (
              <input
                type="text"
                placeholder="Search..."
                value={traineeSearch}
                onChange={e => setTraineeSearch(e.target.value)}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
            )}

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
              gap: 6,
              maxHeight: 320, overflowY: 'auto',
              padding: 2,
            }}>
              {filteredTrainees.map(t => {
                const col = traineeCollection.get(t.id)!
                return (
                  <TraineeTile
                    key={t.id}
                    trainee={t}
                    starRank={col.star_rank}
                    potentialLevel={col.awakening_level}
                    selected={selectedTrainee === t.id}
                    onClick={() => setSelectedTrainee(t.id)}
                  />
                )
              })}
            </div>

            {/* Show selected trainee info */}
            {selectedTraineeData && selectedCollection && (
              <div style={{
                marginTop: 10, padding: '8px 12px', background: '#1a1a2e',
                borderRadius: 6, border: '1px solid #2a2a3e',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <img
                  src={getIconUrl(selectedTraineeData)}
                  style={{ width: 36, height: 36, objectFit: 'contain' }}
                  onError={e => (e.currentTarget.style.display = 'none')}
                />
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                    {selectedTraineeData.title ? `[${selectedTraineeData.title}] ` : ''}{selectedTraineeData.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {'★'.repeat(selectedCollection.star_rank)}{'☆'.repeat(5 - selectedCollection.star_rank)}
                    {' · '}Potential Lv.{selectedCollection.awakening_level}
                    {selectedTraineeData.stat_growth && (
                      <span style={{ marginLeft: 8 }}>
                        {selectedTraineeData.stat_growth.map((g, i) => `${STAT_NAMES[i][0]}:${g}%`).join(' ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* Algorithm */}
          <Section title="Algorithm">
            <div style={{ display: 'flex', gap: 8 }}>
              {algorithms.map(a => {
                const isSelectable = a.status === 'stable' || a.status === 'experimental';
                return (
                  <button
                    key={a.id}
                    onClick={() => isSelectable && setSelectedAlgorithm(a.id)}
                    style={{
                      ...chipStyle,
                      background: selectedAlgorithm === a.id ? '#2563eb' : '#1a1a1a',
                      opacity: isSelectable ? 1 : 0.4,
                      cursor: isSelectable ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {a.name}
                    {!isSelectable && <span style={{ fontSize: '0.6rem', marginLeft: 4 }}>soon</span>}
                    {a.status === 'experimental' && <span style={{ fontSize: '0.6rem', marginLeft: 4, color: '#ca8a04' }}>new</span>}
                  </button>
                );
              })}
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
          {user && ownedCardMap && (
            <Section title="Card Pool">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={useOwnedOnly}
                  onChange={e => setUseOwnedOnly(e.target.checked)} />
                Only use cards I own ({ownedCardMap.size} cards)
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

          {/* Run / Pause / Resume buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={runOptimize}
              disabled={!selectedTrainee || !selectedCollection || loading}
              style={{
                flex: 1, padding: '12px 24px', borderRadius: 8, border: 'none',
                background: selectedTrainee && selectedCollection && !loading ? '#2563eb' : '#333',
                color: '#fff', fontWeight: 600, fontSize: '1rem',
                cursor: selectedTrainee && selectedCollection && !loading ? 'pointer' : 'not-allowed',
                transition: 'background 0.2s',
              }}
            >
              {loading ? 'Running...' : 'Find Best Deck'}
            </button>

            {loading && (
              <button
                onClick={togglePause}
                style={{
                  padding: '12px 20px', borderRadius: 8, border: 'none',
                  background: paused ? '#16a34a' : '#ca8a04',
                  color: '#fff', fontWeight: 600, fontSize: '0.9rem',
                  cursor: 'pointer', transition: 'background 0.2s',
                  minWidth: 100,
                }}
              >
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
            )}
          </div>

          {error && (
            <div style={{ color: '#f87171', fontSize: '0.875rem', padding: '8px 12px', background: '#1a0000', borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>

        {/* ─── Right column: Results ──────────────────────────────────── */}
        <div>
          {/* Progress bar + stats during streaming */}
          {isStreaming && progress && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-muted)',
              }}>
                <span>
                  Generation {progress.gen} / {progress.total}
                  {paused && <span style={{ color: '#ca8a04', marginLeft: 8 }}>PAUSED</span>}
                </span>
                <span>{progress.evaluated.toLocaleString()} decks evaluated</span>
              </div>
              <div style={{
                width: '100%', height: 6, background: '#1a1a1a',
                borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(progress.gen / progress.total) * 100}%`,
                  height: '100%',
                  background: paused
                    ? 'linear-gradient(90deg, #ca8a04, #eab308)'
                    : 'linear-gradient(90deg, #2563eb, #60a5fa)',
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{
                fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4,
                textAlign: 'right',
              }}>
                Best fitness: {progress.fitness.toFixed(1)}
              </div>
            </div>
          )}

          {/* Final results metadata */}
          {results && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
              Algorithm: {results.algorithm} · {results.elapsed_ms}ms ·{' '}
              {results.search_info.total_decks_evaluated.toLocaleString()} decks evaluated
            </div>
          )}

          {/* Live or final deck results */}
          {displayDecks && displayDecks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {isStreaming && (
                <div style={{
                  fontSize: '0.75rem', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {results ? 'Final Results' : 'Live Top 5'}
                </div>
              )}
              {displayDecks.map((result, rank) => (
                <ResultCard
                  key={rank}
                  rank={rank + 1}
                  result={result}
                  cardMap={cardMap}
                  isLive={isStreaming && !results}
                />
              ))}
            </div>
          )}

          {!displayDecks && !loading && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 300, color: 'var(--text-muted)', fontSize: '0.875rem',
              border: '1px dashed #333', borderRadius: 8,
            }}>
              {ownedTrainees.length > 0
                ? 'Select a trainee and click "Find Best Deck" to start'
                : user
                  ? 'Add trainees to your collection first'
                  : 'Log in to use the deck optimizer'
              }
            </div>
          )}

          {loading && !displayDecks && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 300, color: 'var(--text-muted)', fontSize: '0.875rem',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>&#9881;</div>
                Initializing genetic search...
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

function TraineeTile({
  trainee, starRank, potentialLevel, selected, onClick,
}: {
  trainee: Trainee
  starRank: number
  potentialLevel: number
  selected: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const rs = RARITY_STYLE[trainee.rarity] ?? RARITY_STYLE[1]

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
        background: selected ? '#1a1a2e' : '#111',
        border: selected ? '2px solid #2563eb' : '2px solid transparent',
        transition: 'border-color 0.15s, transform 0.15s',
        transform: hover ? 'scale(1.05)' : 'scale(1)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '6px 4px 4px',
      }}
    >
      {/* Hover tooltip */}
      {hover && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          background: '#222', color: '#fff', fontSize: '0.7rem', padding: '4px 8px',
          borderRadius: 4, whiteSpace: 'nowrap', zIndex: 20, marginBottom: 4,
          pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
        }}>
          {trainee.title ? `[${trainee.title}] ` : ''}{trainee.name}
        </div>
      )}

      {/* Icon */}
      <img
        src={getIconUrl(trainee)}
        alt=""
        style={{ width: 48, height: 48, objectFit: 'contain' }}
        onError={e => {
          e.currentTarget.style.display = 'none'
        }}
      />

      {/* Potential level */}
      <div style={{
        fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600,
        marginTop: 2,
      }}>
        Lv.{potentialLevel}
      </div>

      {/* Stars */}
      <div style={{
        fontSize: '0.55rem', lineHeight: 1, letterSpacing: -1,
        color: rs.color,
      }}>
        {'★'.repeat(starRank)}
        <span style={{ color: '#333' }}>{'★'.repeat(Math.max(0, 5 - starRank))}</span>
      </div>
    </div>
  )
}

function ResultCard({
  rank, result, cardMap, isLive,
}: {
  rank: number
  result: DeckScore
  cardMap: Map<number, CardBasic>
  isLive?: boolean
}) {
  const stats = result.projected_stats
  const total = stats.speed + stats.stamina + stats.power + stats.guts + stats.wisdom
  const [expanded, setExpanded] = useState(rank === 1)

  return (
    <div style={{
      background: '#111',
      border: isLive ? '1px solid #2563eb33' : '1px solid #222',
      borderRadius: 8,
      overflow: 'hidden',
      transition: 'border-color 0.3s',
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
