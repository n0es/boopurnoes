interface CatalogCollectionControlsProps {
  collectionMode: boolean
  onToggleCollection: () => void
  unownedMode: boolean
  onToggleUnowned: () => void
  collectionDisabled?: boolean
  warningMessage?: string
  /** Omit the “Show Unowned” control (e.g. deck builder). */
  hideUnowned?: boolean
  /** Disable the My Collection toggle (e.g. signed-out deck builder). */
  myCollectionDisabled?: boolean
  /** Tooltip when My Collection is disabled. */
  myCollectionTitle?: string
}

export function CatalogCollectionControls({
  collectionMode,
  onToggleCollection,
  unownedMode,
  onToggleUnowned,
  collectionDisabled,
  warningMessage,
  hideUnowned = false,
  myCollectionDisabled = false,
  myCollectionTitle,
}: CatalogCollectionControlsProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
      {warningMessage && (
        <span style={{ fontSize: 12, color: '#f87171' }}>{warningMessage}</span>
      )}
      {!hideUnowned && (
        <button
          type="button"
          onClick={onToggleUnowned}
          disabled={!collectionMode || collectionDisabled}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', borderRadius: 8, border: '1px solid',
            borderColor: unownedMode ? '#7dd3fc' : '#333',
            background: unownedMode ? '#0c2a3f' : 'transparent',
            color: (collectionMode && unownedMode) ? '#7dd3fc' : '#444',
            cursor: collectionMode && !collectionDisabled ? 'pointer' : 'default',
            fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
            opacity: collectionMode ? 1 : 0.35,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          Show Unowned
        </button>
      )}
      <button
        type="button"
        onClick={onToggleCollection}
        disabled={myCollectionDisabled}
        title={myCollectionTitle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 14px', borderRadius: 8, border: '1px solid',
          borderColor: collectionMode ? '#7dd3fc' : '#333',
          background: collectionMode ? '#0c2a3f' : 'transparent',
          color: collectionMode ? '#7dd3fc' : '#666',
          cursor: myCollectionDisabled ? 'not-allowed' : 'pointer',
          fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
          opacity: myCollectionDisabled ? 0.45 : 1,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill={collectionMode ? '#7dd3fc' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        My Collection
      </button>
    </div>
  )
}
