import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

interface CatalogHeaderProps {
  title: string
  /** Extra content rendered after the title (e.g. inline filters) */
  children?: ReactNode
}

export function CatalogHeader({ title, children }: CatalogHeaderProps) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(12px)',
      borderBottom: '1px solid #1a1a1a',
    }}>
      <div
        style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <Link to="/umamusume" style={{ color: '#aaa', textDecoration: 'none', fontSize: 13 }}>← Home</Link>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h1>
        {children}
      </div>
    </div>
  )
}
