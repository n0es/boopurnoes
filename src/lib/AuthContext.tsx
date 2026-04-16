import { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Link passes session tokens in the URL hash after login (cross-domain handoff).
    // Supabase's detectSessionInUrl only handles this for implicit flow, but we use
    // PKCE by default, so parse the hash manually.
    const hash = window.location.hash.substring(1)
    const params = new URLSearchParams(hash)
    let accessToken = params.get('access_token')
    let refreshToken = params.get('refresh_token')

    // Fall back to shared domain cookies written by link.boopurno.es
    if (!accessToken || !refreshToken) {
      const cookies = Object.fromEntries(
        document.cookie.split('; ').filter(Boolean).map(c => {
          const eq = c.indexOf('=')
          return [c.slice(0, eq), c.slice(eq + 1)]
        })
      )
      accessToken = accessToken || cookies['sb-access-token'] || null
      refreshToken = refreshToken || cookies['sb-refresh-token'] || null
    }

    const init = accessToken && refreshToken
      ? supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ data }) => {
            window.history.replaceState({}, '', window.location.pathname + window.location.search)
            return data.session
          })
      : supabase.auth.getSession().then(({ data }) => data.session)

    init.then((session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    // Redirect through link's logout so it clears its own session too
    window.location.href = `https://link.boopurno.es/logout?next=${encodeURIComponent(window.location.origin + '/')}`
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
