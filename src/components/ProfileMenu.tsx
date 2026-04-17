import { useRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../lib/AuthContext'

const LINK_ORIGIN = import.meta.env.VITE_LINK_ORIGIN ?? 'https://link.boopurno.es'

function oauthAvatarFromUser(user: User): string | null {
  const m = user.user_metadata
  if (!m || typeof m !== 'object') return null
  const a = (m as { avatar_url?: unknown }).avatar_url
  const p = (m as { picture?: unknown }).picture
  if (typeof a === 'string' && a.trim()) return a.trim()
  if (typeof p === 'string' && p.trim()) return p.trim()
  return null
}

export function ProfileMenu() {
  const { user, session, loading, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [meAvatar, setMeAvatar] = useState<string | null | undefined>(undefined)
  const [imgBroken, setImgBroken] = useState(false)
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

  useEffect(() => {
    if (!user || !session?.access_token) {
      setMeAvatar(undefined)
      return
    }

    const fallback = oauthAvatarFromUser(user)
    setMeAvatar(undefined)

    const ac = new AbortController()
    fetch(`${LINK_ORIGIN}/api/me`, {
      signal: ac.signal,
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() as Promise<{ avatar_url?: unknown }> : null))
      .then((data) => {
        if (ac.signal.aborted) return
        if (!data) {
          setMeAvatar(fallback)
          return
        }
        const u = data.avatar_url
        setMeAvatar(typeof u === 'string' && u.trim() ? u.trim() : null)
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return
        setMeAvatar(fallback)
      })

    return () => ac.abort()
  }, [user, session?.access_token])

  useEffect(() => {
    setImgBroken(false)
  }, [meAvatar, user?.id])

  if (loading) return null

  if (!user) return <Link to="/login" className="login">login</Link>

  const initial = (user.email ?? '?')[0].toUpperCase()
  const oauthFallback = oauthAvatarFromUser(user)
  const displayUrl = meAvatar !== undefined ? meAvatar : oauthFallback
  const showPhoto = Boolean(displayUrl && !imgBroken)

  return (
    <div ref={containerRef} className="profile-menu">
      <button
        type="button"
        className="profile-avatar"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {showPhoto ? (
          <img src={displayUrl!} alt="" decoding="async" onError={() => setImgBroken(true)} />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="profile-dropdown" role="menu">
          <a
            className="profile-item"
            role="menuitem"
            href={`${LINK_ORIGIN}/account`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            account settings
          </a>
          <button
            type="button"
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
