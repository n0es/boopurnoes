import { useState, useEffect } from 'react'
import { MenuIcon, CloseIcon } from './Icons'
import { supabase } from '../lib/supabase'

interface Service {
  id: string
  name: string
  href: string
  icon_url: string
}

export default function ServiceMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [services, setServices] = useState<Service[]>([])

  useEffect(() => {
    supabase
      .from('services')
      .select('id, name, href, icon_url')
      .order('name')
      .then(({ data }) => {
        if (data) setServices(data)
      })
  }, [])

  return (
    <div className="service-menu">
      <button
        className="menu-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
      >
        <span className={`menu-icon ${isOpen ? 'hidden' : ''}`}>
          <MenuIcon size={20} />
        </span>
        <span className={`close-icon ${isOpen ? '' : 'hidden'}`}>
          <CloseIcon size={20} />
        </span>
      </button>

      <nav className={`menu-dropdown ${isOpen ? 'open' : ''}`}>
        {services.map((service, index) => (
          <a
            key={service.id}
            href={service.href}
            target="_blank"
            rel="noopener noreferrer"
            className="menu-item"
            style={{ '--delay': `${index * 0.03}s` } as React.CSSProperties}
            onClick={() => setIsOpen(false)}
          >
            <span className="menu-item-icon">
              <img src={service.icon_url} alt="" width={20} height={20} />
            </span>
            <span className="menu-item-name">{service.name}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}
