import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { uma } from '../lib/supabase'
import type { CatalogTitleEntityKind } from '../lib/useCatalogTitleSuggestionPresence'

interface CatalogEntityTitleLineProps {
  kind: CatalogTitleEntityKind
  entityId: number
  title: string | null
  /** Shown muted when `title` is empty (e.g. support card type). */
  displayFallback?: string | null
  /** Trainee modal uses bracketed display. */
  decorate?: 'brackets' | 'none'
  variant: 'compact' | 'comfortable'
  isAdmin: boolean
  adminRoleLoading: boolean
  user: User | null
  hasPendingSuggestions: boolean
  onRefreshSuggestionPresence: () => void | Promise<void>
  onTitleApplied: (newTitle: string | null) => void
}

interface SuggestionRow {
  id: number
  suggested_title: string
  user_id: string
  created_at: string
}

const BTN_SUGGEST: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 5,
  border: '1px solid rgba(148,163,184,0.35)',
  background: 'rgba(148,163,184,0.08)',
  color: '#94a3b8',
  cursor: 'pointer',
  flexShrink: 0,
}

const BTN_SUGGEST_COMPACT: CSSProperties = {
  ...BTN_SUGGEST,
  fontSize: 9,
  padding: '1px 6px',
}

const BTN_EDIT: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 5,
  border: '1px solid rgba(167,139,250,0.45)',
  background: 'rgba(167,139,250,0.12)',
  color: '#c4b5fd',
  cursor: 'pointer',
  flexShrink: 0,
}

const BTN_EDIT_COMPACT: CSSProperties = {
  ...BTN_EDIT,
  fontSize: 9,
  padding: '1px 6px',
}

function AlertDot({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title ?? 'View title suggestions'}
      onClick={e => { e.stopPropagation(); onClick() }}
      onPointerDown={e => e.stopPropagation()}
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: 'none',
        padding: 0,
        background: '#dc2626',
        color: '#fff',
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
      }}
    >!</button>
  )
}

function SuggestTitleModal({ kind, entityId, currentTitle, user, onClose, onAfterSubmit }: {
  kind: CatalogTitleEntityKind
  entityId: number
  currentTitle: string | null
  user: User
  onClose: () => void
  onAfterSubmit: () => void | Promise<void>
}) {
  const [value, setValue] = useState(currentTitle ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Please enter a suggested title.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await uma
      .from('catalog_title_suggestions')
      .upsert(
        {
          entity_type: kind,
          entity_id: entityId,
          user_id: user.id,
          suggested_title: trimmed,
        },
        { onConflict: 'entity_type,entity_id,user_id' }
      )
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await onAfterSubmit()
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 400,
          background: '#16161e',
          border: '1px solid #2a2a38',
          borderRadius: 14,
          padding: '20px 22px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.75)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e5e5', marginBottom: 6 }}>Suggest a title fix</div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 14 }}>
          Current:{' '}
          <span style={{ color: '#94a3b8' }}>{currentTitle?.trim() ? currentTitle : '—'}</span>
        </div>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={3}
          placeholder="Corrected title"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#1a1a24',
            border: '1px solid #333',
            borderRadius: 8,
            padding: '10px 12px',
            color: '#fff',
            fontSize: 13,
            resize: 'vertical',
            marginBottom: 12,
            outline: 'none',
          }}
        />
        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 8,
              border: '1px solid #2a2a38',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 8,
              border: 'none',
              background: busy ? '#2a2050' : '#4c3bc0',
              color: busy ? '#aaa' : '#fff',
              cursor: busy ? 'default' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >{busy ? 'Sending…' : 'Submit'}</button>
        </div>
      </div>
    </div>
  )
}

function AdminEditTitleModal({ kind, entityId, currentTitle, onClose, onSaved }: {
  kind: CatalogTitleEntityKind
  entityId: number
  currentTitle: string | null
  onClose: () => void
  onSaved: (t: string | null) => void
}) {
  const [value, setValue] = useState(currentTitle ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const trimmed = value.trim()
    const next = trimmed.length ? trimmed : null
    setBusy(true)
    setError(null)
    const table = kind === 'trainee' ? 'trainees' : 'support_cards'
    const { error: err } = await uma
      .from(table)
      .update({ title: next })
      .eq('id', entityId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved(next)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          background: '#16161e',
          border: '1px solid #2a2a38',
          borderRadius: 14,
          padding: '20px 22px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.75)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e5e5', marginBottom: 14 }}>Edit title (admin)</div>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Title (leave empty to clear)"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#1a1a24',
            border: '1px solid #333',
            borderRadius: 8,
            padding: '10px 12px',
            color: '#fff',
            fontSize: 13,
            marginBottom: 12,
            outline: 'none',
          }}
        />
        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 8,
              border: '1px solid #2a2a38',
              background: 'transparent',
              color: '#888',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 8,
              border: 'none',
              background: busy ? '#2a2050' : '#4c3bc0',
              color: busy ? '#aaa' : '#fff',
              cursor: busy ? 'default' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function AdminReviewSuggestionsModal({ kind, entityId, onClose, onTitleApplied, onRefreshSuggestionPresence }: {
  kind: CatalogTitleEntityKind
  entityId: number
  onClose: () => void
  onTitleApplied: (newTitle: string | null) => void
  onRefreshSuggestionPresence: () => void | Promise<void>
}) {
  const [rows, setRows] = useState<SuggestionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await uma
      .from('catalog_title_suggestions')
      .select('id, suggested_title, user_id, created_at')
      .eq('entity_type', kind)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true })
    setLoading(false)
    if (error) {
      console.warn('suggestions load:', error.message)
      setRows([])
      return
    }
    setRows((data ?? []) as SuggestionRow[])
  }, [kind, entityId])

  useEffect(() => { void load() }, [load])

  async function accept(row: SuggestionRow) {
    setBusyId(row.id)
    const table = kind === 'trainee' ? 'trainees' : 'support_cards'
    const { error: uErr } = await uma
      .from(table)
      .update({ title: row.suggested_title.trim() })
      .eq('id', entityId)
    if (uErr) {
      console.warn('accept title:', uErr.message)
      setBusyId(null)
      return
    }
    const { error: dErr } = await uma.from('catalog_title_suggestions').delete().eq('id', row.id)
    if (dErr) console.warn('delete suggestion:', dErr.message)
    onTitleApplied(row.suggested_title.trim())
    setBusyId(null)
    await load()
    await onRefreshSuggestionPresence()
  }

  async function remove(row: SuggestionRow) {
    setBusyId(row.id)
    const { error } = await uma.from('catalog_title_suggestions').delete().eq('id', row.id)
    if (error) console.warn('delete suggestion:', error.message)
    setBusyId(null)
    await load()
    await onRefreshSuggestionPresence()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          maxHeight: 'min(480px, 85dvh)',
          background: '#16161e',
          border: '1px solid #2a2a38',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.75)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #222', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e5e5e5' }}>Title suggestions</span>
          <button
            type="button"
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '2px 6px' }}
          >×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 18px' }}>
          {loading ? (
            <div style={{ color: '#555', fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: '#555', fontSize: 13 }}>No pending suggestions.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(row => (
                <div
                  key={row.id}
                  style={{
                    background: '#1a1a26',
                    borderRadius: 10,
                    padding: '12px 14px',
                    border: '1px solid #2a2a38',
                  }}
                >
                  <div style={{ fontSize: 13, color: '#e5e5e5', lineHeight: 1.4, marginBottom: 8 }}>{row.suggested_title}</div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 10 }}>
                    {new Date(row.created_at).toLocaleString()} · user {row.user_id.slice(0, 8)}…
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void remove(row)}
                      style={{
                        flex: 1,
                        padding: '7px 0',
                        borderRadius: 7,
                        border: '1px solid rgba(248,113,113,0.45)',
                        background: 'rgba(248,113,113,0.08)',
                        color: '#f87171',
                        cursor: busyId === row.id ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                        opacity: busyId === row.id ? 0.5 : 1,
                      }}
                    >Delete</button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void accept(row)}
                      style={{
                        flex: 1,
                        padding: '7px 0',
                        borderRadius: 7,
                        border: 'none',
                        background: busyId === row.id ? '#2a2050' : '#4c3bc0',
                        color: busyId === row.id ? '#aaa' : '#fff',
                        cursor: busyId === row.id ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >Accept</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function CatalogEntityTitleLine(props: CatalogEntityTitleLineProps) {
  const {
    kind,
    entityId,
    title,
    displayFallback,
    decorate = 'none',
    variant,
    isAdmin,
    adminRoleLoading,
    user,
    hasPendingSuggestions,
    onRefreshSuggestionPresence,
    onTitleApplied,
  } = props

  const [suggestOpen, setSuggestOpen] = useState(false)
  const [adminEditOpen, setAdminEditOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const primary = title?.trim() ?? ''
  const showFallback = !primary && !!displayFallback?.trim()
  const suggestStyle = variant === 'compact' ? BTN_SUGGEST_COMPACT : BTN_SUGGEST
  const editStyle = variant === 'compact' ? BTN_EDIT_COMPACT : BTN_EDIT

  const textStyle: CSSProperties = variant === 'compact'
    ? { fontSize: 9, color: '#bbb', lineHeight: 1.3, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }
    : { fontSize: 11, color: 'rgba(255,255,255,0.5)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }

  let textContent: ReactNode = null
  if (primary) {
    textContent = decorate === 'brackets' ? `[${primary}]` : primary
  } else if (showFallback) {
    textContent = <span style={{ ...textStyle, opacity: 0.75 }}>{displayFallback}</span>
  }

  const showAdminChrome = !adminRoleLoading && isAdmin

  return (
    <>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: variant === 'compact' ? 4 : 6,
          maxWidth: '100%',
        }}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {textContent !== null && <span style={textStyle}>{textContent}</span>}
        {user && (
          <button
            type="button"
            style={suggestStyle}
            onClick={e => { e.stopPropagation(); setSuggestOpen(true) }}
            onPointerDown={e => e.stopPropagation()}
          >Suggest</button>
        )}
        {showAdminChrome && (
          <>
            <button
              type="button"
              style={editStyle}
              onClick={e => { e.stopPropagation(); setAdminEditOpen(true) }}
              onPointerDown={e => e.stopPropagation()}
            >Edit</button>
            {hasPendingSuggestions && (
              <AlertDot onClick={() => setReviewOpen(true)} />
            )}
          </>
        )}
      </span>

      {suggestOpen && user && (
        <SuggestTitleModal
          kind={kind}
          entityId={entityId}
          currentTitle={title}
          user={user}
          onClose={() => setSuggestOpen(false)}
          onAfterSubmit={onRefreshSuggestionPresence}
        />
      )}
      {adminEditOpen && (
        <AdminEditTitleModal
          kind={kind}
          entityId={entityId}
          currentTitle={title}
          onClose={() => setAdminEditOpen(false)}
          onSaved={t => { onTitleApplied(t); void onRefreshSuggestionPresence() }}
        />
      )}
      {reviewOpen && showAdminChrome && (
        <AdminReviewSuggestionsModal
          kind={kind}
          entityId={entityId}
          onClose={() => setReviewOpen(false)}
          onTitleApplied={onTitleApplied}
          onRefreshSuggestionPresence={onRefreshSuggestionPresence}
        />
      )}
    </>
  )
}
