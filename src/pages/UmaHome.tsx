import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useEffect } from 'react'

export default function UmaHome() {
  const { user } = useAuth()

  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => {
      if (root) { root.style.maxWidth = ''; root.style.padding = '' }
    }
  }, [])

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#0a0a0a', 
      backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.15) 0%, transparent 50%), radial-gradient(circle at 100% 0%, rgba(168, 85, 247, 0.1) 0%, transparent 40%)',
      color: '#fff', 
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      
      {/* Navbar */}
      <nav style={{ 
        position: 'sticky', top: 0, zIndex: 50,
        padding: '1rem 2rem',
        background: 'rgba(10, 10, 10, 0.7)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ 
            width: 32, height: 32, borderRadius: 8, 
            background: 'linear-gradient(135deg, #2563eb, #9333ea)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: '1.2rem', boxShadow: '0 0 15px rgba(37, 99, 235, 0.5)'
          }}>U</div>
          <span style={{ fontSize: '1.2rem', fontWeight: 700, letterSpacing: '-0.02em' }}>UmaTools</span>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <Link to="/" style={{ color: '#a1a1aa', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500, transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = '#a1a1aa'}>Developer Profile</Link>
          {!user && (
            <Link to="/login" style={{ 
              padding: '0.5rem 1.25rem', borderRadius: 20, 
              background: 'rgba(255, 255, 255, 0.1)', color: '#fff', 
              textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600,
              border: '1px solid rgba(255, 255, 255, 0.2)', transition: 'background 0.2s'
            }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}>
              Sign In
            </Link>
          )}
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '6rem 2rem 4rem' }}>
        {/* Header Hero */}
        <header style={{ marginBottom: '4rem', textAlign: 'center' }}>
          <h1 style={{ 
            fontSize: 'clamp(2.5rem, 5vw, 3.5rem)', fontWeight: 800, margin: '0 0 1rem 0', letterSpacing: '-0.03em',
            background: 'linear-gradient(to right, #fff, #a1a1aa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            Master the Track
          </h1>
          <p style={{ color: '#a1a1aa', fontSize: '1.1rem', maxWidth: 600, margin: '0 auto', lineHeight: 1.6 }}>
            A comprehensive suite of tools designed to optimize your training runs, build perfect decks, and manage your legacy inheritance in Uma Musume.
          </p>
        </header>

        {/* Tools Grid */}
        <main style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', 
          gap: '1.5rem' 
        }}>
          
          <ToolCard 
            title="Deck Optimizer" 
            description="Use genetic algorithms and Monte Carlo simulations to find the mathematically perfect 6-card support deck for any scenario."
            to="/deck-optimizer"
            icon="🧬"
            color="#3b82f6"
          />

          <ToolCard 
            title="Run Analyzer" 
            description="Log your training sessions turn-by-turn and compare your decisions against real-time algorithm predictions."
            to="/run-analyzer"
            icon="📊"
            color="#ec4899"
          />

          <ToolCard 
            title="Run Comparison" 
            description="Input starting conditions and actual results to compare with the optimizer's projections and calibrate its accuracy."
            to="/run-comparison"
            icon="⚖️"
            color="#f43f5e"
          />

          <ToolCard 
            title="Legacy Veterans" 
            description="Manage your hall of fame. Track Spark inheritance, G1 race histories, and plan perfect lineages."
            to="/veterans"
            icon="🏆"
            color="#eab308"
          />

          <ToolCard 
            title="Trainees DB" 
            description="Browse character stats, aptitudes, growth rates, and manage your personal roster."
            to="/trainees"
            icon="🐎"
            color="#22c55e"
          />

          <ToolCard 
            title="Support Cards DB" 
            description="Explore the full library of support cards, their effects at every level, and unique skills."
            to="/support-cards"
            icon="🃏"
            color="#a855f7"
          />

          <ToolCard 
            title="Data Importer" 
            description="Import new support cards directly from Gametora to keep your local database up to date."
            to="/import-support-card"
            icon="📥"
            color="#64748b"
          />

        </main>

        {!user && (
          <div style={{ 
            marginTop: '5rem', padding: '3rem', 
            background: 'linear-gradient(145deg, rgba(37, 99, 235, 0.1), rgba(168, 85, 247, 0.05))', 
            borderRadius: 24, textAlign: 'center', 
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.75rem', fontWeight: 700 }}>Unlock Your Full Potential</h3>
            <p style={{ color: '#a1a1aa', fontSize: '1.1rem', maxWidth: 500, margin: '0 auto 2rem auto' }}>
              Create an account to save your collection, sync your training runs, and access advanced optimization features.
            </p>
            <Link to="/login" style={{ 
              display: 'inline-flex', padding: '1rem 2.5rem', 
              background: '#fff', color: '#000', borderRadius: 30, 
              textDecoration: 'none', fontWeight: 700, fontSize: '1rem',
              transition: 'transform 0.2s, boxShadow 0.2s',
              boxShadow: '0 4px 15px rgba(255,255,255,0.2)'
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              Get Started for Free
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function ToolCard({ title, description, to, icon, color }: { title: string, description: string, to: string, icon: string, color: string }) {
  return (
    <Link to={to} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{ 
        padding: '2rem', 
        background: 'rgba(255, 255, 255, 0.03)', 
        borderRadius: 20, 
        border: '1px solid rgba(255, 255, 255, 0.08)',
        height: '100%',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
      onMouseEnter={e => {
        const target = e.currentTarget;
        target.style.transform = 'translateY(-6px)';
        target.style.background = 'rgba(255, 255, 255, 0.06)';
        target.style.borderColor = `rgba(${hexToRgb(color)}, 0.5)`;
        target.style.boxShadow = `0 20px 40px rgba(0,0,0,0.4), 0 0 20px rgba(${hexToRgb(color)}, 0.15)`;
        const glow = target.querySelector('.glow-effect') as HTMLElement;
        if (glow) glow.style.opacity = '1';
      }}
      onMouseLeave={e => {
        const target = e.currentTarget;
        target.style.transform = 'translateY(0)';
        target.style.background = 'rgba(255, 255, 255, 0.03)';
        target.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        target.style.boxShadow = 'none';
        const glow = target.querySelector('.glow-effect') as HTMLElement;
        if (glow) glow.style.opacity = '0';
      }}
      >
        <div className="glow-effect" style={{
          position: 'absolute', top: 0, right: 0, width: '150px', height: '150px',
          background: `radial-gradient(circle at top right, rgba(${hexToRgb(color)}, 0.2), transparent 70%)`,
          opacity: 0, transition: 'opacity 0.3s ease', pointerEvents: 'none'
        }} />
        
        <div style={{ 
          width: 56, height: 56, borderRadius: 16, background: `rgba(${hexToRgb(color)}, 0.15)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.75rem', marginBottom: '1.5rem', border: `1px solid rgba(${hexToRgb(color)}, 0.3)`
        }}>
          {icon}
        </div>
        
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: '0 0 0.75rem 0', color: '#fff' }}>{title}</h2>
        <p style={{ fontSize: '0.95rem', color: '#a1a1aa', margin: 0, lineHeight: 1.6 }}>{description}</p>
      </div>
    </Link>
  )
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? 
    `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
    '255, 255, 255';
}
