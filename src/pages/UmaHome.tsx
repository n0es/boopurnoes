import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useEffect } from 'react'

export default function UmaHome() {
  const { user, loading, signOut } = useAuth()

  useEffect(() => {
    const root = document.getElementById('root')
    if (root) {
      root.style.maxWidth = 'none'
      root.style.padding = '0'
    }
    return () => {
      if (root) {
        root.style.maxWidth = ''
        root.style.padding = ''
      }
    }
  }, [])

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ position: 'fixed', top: 0, left: 0, padding: '1.5rem 2rem', zIndex: 10 }}>
        <Link to="/" className="back">
          &larr; back
        </Link>
      </header>
      <header style={{ position: 'fixed', top: 0, right: 0, padding: '1.5rem 2rem', zIndex: 10 }}>
        {!loading &&
          (user ? (
            <button type="button" className="login" onClick={signOut}>
              logout
            </button>
          ) : (
            <Link to="/login" className="login">
              login
            </Link>
          ))}
      </header>

      <main style={{ marginTop: '2rem' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            marginBottom: '0.5rem',
          }}
        >
          Uma Musume
        </h1>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.875rem',
            marginBottom: '2rem',
            maxWidth: '42rem',
            lineHeight: 1.6,
          }}
        >
          Browse trainees and support cards, track your collection, and explore skill data.
        </p>

        <section className="services">
          <h2>tools</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '1rem',
            }}
          >
            <ToolCard
              title="Trainees"
              description="Character stats, aptitudes, growth, and your roster."
              to="/trainees"
            />
            <ToolCard
              title="Support Cards"
              description="Card library, levels, and skill data."
              to="/support-cards"
            />
          </div>
        </section>

        {!user && (
          <section
            className="services"
            style={{ marginTop: '3rem', textAlign: 'center' }}
          >
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                marginBottom: '1rem',
                maxWidth: '28rem',
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
            >
              Sign in to save your collection and sync training data.
            </p>
            <Link to="/login" style={{ color: 'var(--text)', textDecoration: 'none', fontSize: '0.875rem' }}>
              login
            </Link>
          </section>
        )}
      </main>
    </div>
  )
}

function ToolCard({
  title,
  description,
  to,
}: {
  title: string
  description: string
  to: string
}) {
  return (
    <Link
      to={to}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
        padding: '1.25rem',
        borderRadius: 4,
        border: '1px solid #262626',
        background: 'transparent',
        transition: 'border-color 0.2s ease, background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#404040'
        e.currentTarget.style.background = '#111'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#262626'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <div
        style={{
          fontSize: '1rem',
          fontWeight: 500,
          marginBottom: '0.5rem',
          color: 'var(--text)',
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--text-muted)',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
    </Link>
  )
}
