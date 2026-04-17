import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export function ProfileMenu() {
  const { user, loading, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointer(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  if (loading) return null

  if (!user) return <Link to="/login" className="login">login</Link>

  const initial = (user.email ?? '?')[0].toUpperCase()

  return (
    <div ref={containerRef} className="profile-menu">
      <button
        className="profile-avatar"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initial}
      </button>

      {open && (
        <div className="profile-dropdown" role="menu">
          <a
            className="profile-item"
            role="menuitem"
            href="https://link.boopurno.es/account"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            account settings
          </a>
          <button
            className="profile-item"
            role="menuitem"
            onClick={() => { setOpen(false); void signOut() }}
          >
            logout
          </button>
        </div>
      )}
    </div>
  )
}
