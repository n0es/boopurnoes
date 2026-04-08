import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

const COOKIE_DOMAIN = '.boopurno.es'

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    document.cookie = `sb-access-token=${session.access_token}; domain=${COOKIE_DOMAIN}; path=/; max-age=3600; secure; samesite=lax`
    if (session.refresh_token) {
      document.cookie = `sb-refresh-token=${session.refresh_token}; domain=${COOKIE_DOMAIN}; path=/; max-age=2592000; secure; samesite=lax`
    }
  } else {
    document.cookie = `sb-access-token=; domain=${COOKIE_DOMAIN}; path=/; max-age=0; secure; samesite=lax`
    document.cookie = `sb-refresh-token=; domain=${COOKIE_DOMAIN}; path=/; max-age=0; secure; samesite=lax`
  }
})
