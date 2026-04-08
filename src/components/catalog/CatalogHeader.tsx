import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

interface CatalogHeaderProps {
  title: string
  collectionMode: boolean
  onToggleCollection: () => void
  unownedMode: boolean
  onToggleUnowned: () => void
  collectionDisabled?: boolean
  warningMessage?: string
  /** Extra content rendered between title and collection buttons */
  children?: ReactNode
}

export function CatalogHeader({
  title,
  collectionMode,
  onToggleCollection,
  unownedMode,
  onToggleUnowned,
  collectionDisabled,
  warningMessage,
  children,
}: CatalogHeaderProps) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(12px)',
      borderBottom: '1px solid #1a1a1a',
    }}>
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/umamusume" style={{ color: '#aaa', textDecoration: 'none', fontSize: 13 }}>← Home</Link>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h1>
        {children}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {warningMessage && (
            <span style={{ fontSize: 12, color: '#f87171' }}>{warningMessage}</span>
          )}
          <button
            onClick={onToggleUnowned}
            disabled={!collectionMode || collectionDisabled}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', borderRadius: 8, border: '1px solid',
              borderColor: unownedMode ? '#7dd3fc' : '#333',
              background: unownedMode ? '#0c2a3f' : 'transparent',
              color: (collectionMode && unownedMode) ? '#7dd3fc' : '#444',
              cursor: collectionMode && !collectionDisabled ? 'pointer' : 'default',
              fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
              opacity: collectionMode ? 1 : 0.35,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            Show Unowned
          </button>
          <button
            onClick={onToggleCollection}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', borderRadius: 8, border: '1px solid',
              borderColor: collectionMode ? '#7dd3fc' : '#333',
              background: collectionMode ? '#0c2a3f' : 'transparent',
              color: collectionMode ? '#7dd3fc' : '#666',
              cursor: 'pointer', fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={collectionMode ? '#7dd3fc' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            My Collection
          </button>
        </div>
      </div>
    </div>
  )
}
