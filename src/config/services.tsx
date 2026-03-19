import {
  DashboardIcon,
  DatabaseIcon,
  SettingsIcon,
  TerminalIcon,
  UsersIcon,
  AnalyticsIcon,
  StorageIcon,
} from '../components/Icons'

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
    id: 'dashboard',
    name: 'Dashboard',
    href: '/dashboard',
    icon: DashboardIcon,
  },
  {
    id: 'studio',
    name: 'Studio',
    href: '/studio',
    icon: DatabaseIcon,
  },
  {
    id: 'users',
    name: 'Users',
    href: '/users',
    icon: UsersIcon,
  },
  {
    id: 'analytics',
    name: 'Analytics',
    href: '/analytics',
    icon: AnalyticsIcon,
  },
  {
    id: 'storage',
    name: 'Storage',
    href: '/storage',
    icon: StorageIcon,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    href: '/terminal',
    icon: TerminalIcon,
  },
  {
    id: 'settings',
    name: 'Settings',
    href: '/settings',
    icon: SettingsIcon,
  },
]
