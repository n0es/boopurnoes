import { SupabaseIcon } from '../components/Icons'

export interface Service {
  id: string
  name: string
  href: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  external?: boolean
}

// Add new services here - they'll automatically appear in the menu
export const services: Service[] = [
  {
    id: 'studio',
    name: 'Supabase Studio',
    href: 'https://supabase.boopurno.es/',
    icon: SupabaseIcon,
  },
]
