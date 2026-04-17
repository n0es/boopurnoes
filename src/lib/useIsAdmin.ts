import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export function useIsAdmin(user: User | null) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(!!user)

  useEffect(() => {
    if (!user) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('profiles role:', error.message)
          setIsAdmin(false)
        } else {
          setIsAdmin(data?.role === 'admin')
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [user?.id])

  return { isAdmin, loading }
}
