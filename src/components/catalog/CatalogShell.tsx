import { useEffect, type ReactNode } from 'react'

export function CatalogShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => {
      if (root) { root.style.maxWidth = ''; root.style.padding = '' }
    }
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: 'sans-serif' }}>
      {children}
    </div>
  )
}
