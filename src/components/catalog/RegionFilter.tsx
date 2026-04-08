import type { RegionAvailabilityFilter } from '../../lib/releaseMetadata'
import { FilterPill } from './FilterPill'

const OPTIONS: [RegionAvailabilityFilter, string][] = [
  ['jp', 'Japan'],
  ['global', 'Global'],
]

interface RegionFilterProps {
  value: RegionAvailabilityFilter
  onChange: (v: RegionAvailabilityFilter) => void
}

export function RegionFilter({ value, onChange }: RegionFilterProps) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, color: '#444', fontWeight: 600 }}>Server</span>
      {OPTIONS.map(([key, label]) => (
        <FilterPill
          key={key}
          active={value === key}
          activeColor="#93c5fd"
          activeBg="rgba(100,181,246,0.12)"
          activeBorder="#64b5f6"
          onClick={() => onChange(key)}
        >
          {label}
        </FilterPill>
      ))}
    </div>
  )
}
