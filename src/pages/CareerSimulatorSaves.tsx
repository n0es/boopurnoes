import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { deleteCareerSimulatorSave, listCareerSimulatorSaves, type CareerSimulatorSaveListItem } from '../lib/careerSimulatorCloud'

function formatUpdated(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }
  catch {
    return iso
  }
}

export default function CareerSimulatorSaves() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<CareerSimulatorSaveListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) return
    setError(null)
    setLoading(true)
    try {
      const data = await listCareerSimulatorSaves()
      setRows(data)
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load saves')
    }
    finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => { if (root) { root.style.maxWidth = ''; root.style.padding = '' } }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      return
    }
    void refresh()
  }, [user, authLoading, refresh])

  async function onDelete(id: string, name: string) {
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return
    setDeletingId(id)
    setError(null)
    try {
      await deleteCareerSimulatorSave(id)
      setRows(r => r.filter(x => x.id !== id))
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
    finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a0a',
      backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.12) 0%, transparent 45%)',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        padding: '1rem 2rem',
        background: 'rgba(10, 10, 10, 0.75)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/career-simulator" style={{ textDecoration: 'none', color: '#a1a1aa', fontSize: '0.9rem' }}>← Editor</Link>
          <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>Saved career runs</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link
            to="/career-simulator"
            style={{
              padding: '0.4rem 0.85rem', borderRadius: 10, textDecoration: 'none',
              background: 'rgba(96,165,250,0.2)', color: '#93c5fd', fontWeight: 600, fontSize: '0.85rem',
            }}
          >
            New run
          </Link>
          <Link to="/umamusume" style={{ padding: '0.4rem 0.85rem', borderRadius: 10, textDecoration: 'none', color: '#71717a', fontSize: '0.85rem' }}>
            Uma home
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
        {authLoading && <p style={{ color: '#a1a1aa' }}>Loading…</p>}

        {!authLoading && !user && (
          <div style={{
            padding: '1.25rem', borderRadius: 16,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <p style={{ margin: '0 0 1rem', color: '#e4e4e7' }}>Sign in to save career runs to your account and open them from any device.</p>
            <Link
              to="/login"
              state={{ from: '/career-simulator/saves' }}
              style={{
                display: 'inline-block', padding: '0.5rem 1rem', borderRadius: 10,
                background: 'linear-gradient(135deg, #2563eb, #9333ea)', color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: '0.9rem',
              }}
            >
              Log in
            </Link>
          </div>
        )}

        {user && (
          <>
            {error && (
              <div style={{
                marginBottom: '1rem', padding: '0.75rem', borderRadius: 10,
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: '0.85rem',
              }}>{error}</div>
            )}
            {loading && <p style={{ color: '#a1a1aa' }}>Loading your saves…</p>}
            {!loading && rows.length === 0 && (
              <p style={{ color: '#71717a' }}>
                No saved runs yet. Open the{' '}
                <Link to="/career-simulator" style={{ color: '#60a5fa' }}>Career Simulator</Link>
                , configure a run, then use <strong style={{ color: '#d4d4d8' }}>Save to account</strong>.
              </p>
            )}
            {!loading && rows.length > 0 && (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {rows.map(row => (
                  <li
                    key={row.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.85rem 1rem', borderRadius: 14,
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => navigate(`/career-simulator/run/${row.id}`)}
                      style={{
                        flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                        color: '#fafafa', padding: 0,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{row.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#71717a', marginTop: 4 }}>Updated {formatUpdated(row.updated_at)}</div>
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === row.id}
                      onClick={() => onDelete(row.id, row.name)}
                      style={{
                        padding: '0.35rem 0.65rem', borderRadius: 8, border: '1px solid rgba(248,113,113,0.35)',
                        background: 'rgba(248,113,113,0.08)', color: '#f87171', cursor: 'pointer', fontSize: '0.78rem', flexShrink: 0,
                        opacity: deletingId === row.id ? 0.5 : 1,
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
