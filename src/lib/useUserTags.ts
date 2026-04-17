import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export function useUserTags(user: User | null) {
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(!!user)

  useEffect(() => {
    if (!user) {
      setTags([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    supabase
      .from('link_user_tags')
      .select('link_tags(name)')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('useUserTags:', error.message)
          setTags([])
        } else {
          const names = (data ?? [])
            .map((row: any) => row.link_tags?.name)
            .filter(Boolean) as string[]
          setTags(names)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [user?.id])

  return { tags, loading }
}
