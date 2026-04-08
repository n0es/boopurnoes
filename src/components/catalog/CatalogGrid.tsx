import type { ReactNode } from 'react'

interface CatalogGridProps {
  loading: boolean
  error: string | null
  emptyMessage?: string
  cardSize: number
  children: ReactNode
}

const MESSAGE_STYLE = { color: '#444', fontSize: 13, padding: 40, textAlign: 'center' as const }

export function CatalogGrid({
  loading,
  error,
  emptyMessage = 'No results found.',
  cardSize,
  children,
}: CatalogGridProps) {
  return (
    <div style={{ padding: 16 }}>
      {loading && (
        <div style={MESSAGE_STYLE}>Loading…</div>
      )}
      {error && (
        <div style={{ color: '#ef4444', fontSize: 13, padding: 40, textAlign: 'center' }}>{error}</div>
      )}
      {!loading && !error && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardSize}px, 100%), 1fr))`,
          gap: 8,
        }}>
          {children}
        </div>
      )}
      {!loading && !error && !hasChildren(children) && (
        <div style={MESSAGE_STYLE}>{emptyMessage}</div>
      )}
    </div>
  )
}

function hasChildren(children: ReactNode): boolean {
  if (children == null) return false
  if (Array.isArray(children)) return children.length > 0
  return true
}
