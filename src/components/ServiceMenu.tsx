import { useState } from 'react'
import { MenuIcon, CloseIcon } from './Icons'
import { services } from '../config/services'

export default function ServiceMenu() {
  const [isOpen, setIsOpen] = useState(false)

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
        {services.map((service, index) => {
          const Icon = service.icon

          return (
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
                <Icon size={20} />
              </span>
              <span className="menu-item-name">{service.name}</span>
            </a>
          )
        })}
      </nav>
    </div>
  )
}
