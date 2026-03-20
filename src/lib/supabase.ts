import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    document.cookie = `sb-access-token=${session.access_token}; domain=.boopurno.es; path=/; max-age=3600; secure; samesite=lax`;
  } else {
    document.cookie = `sb-access-token=; domain=.boopurno.es; path=/; max-age=0; secure; samesite=lax`;
  }
});
