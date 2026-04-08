interface CardSizeSliderProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  count: number
  ownedCount?: number
}

export function CardSizeSlider({
  value,
  onChange,
  min = 70,
  max = 200,
  count,
  ownedCount,
}: CardSizeSliderProps) {
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#444' }}>Size</span>
        <input
          type="range" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ width: 70, accentColor: '#a78bfa' }}
        />
      </div>
      <div style={{ fontSize: 11, color: '#444' }}>
        {count}
        {ownedCount != null && (
          <span style={{ color: '#7dd3fc' }}> · {ownedCount} owned</span>
        )}
      </div>
    </div>
  )
}
