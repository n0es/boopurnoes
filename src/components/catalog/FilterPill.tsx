import type { ReactNode } from 'react'

interface FilterPillProps {
  active: boolean
  activeColor?: string
  activeBg?: string
  activeBorder?: string
  onClick: () => void
  children: ReactNode
}

export function FilterPill({
  active,
  activeColor = '#a78bfa',
  activeBg = 'rgba(167,139,250,0.15)',
  activeBorder,
  onClick,
  children,
}: FilterPillProps) {
  const border = active ? (activeBorder ?? activeColor) : '#2a2a38'

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 20,
        padding: '4px 10px',
        border: `1px solid ${border}`,
        background: active ? activeBg : 'transparent',
        color: active ? activeColor : '#555',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}
