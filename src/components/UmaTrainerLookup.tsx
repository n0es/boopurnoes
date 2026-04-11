import { useCallback, useEffect, useState } from 'react'
import {
  fetchUmaSupportCardSearch,
  formatTrainerIdForDisplay,
  umaDatabaseFilteredUrl,
} from '../lib/umaMoeApi'
import {
  blockTrainerForCard,
  clearCachedTrainer,
  getCachedTrainer,
  isBlockedForCard,
  setCachedTrainer,
} from '../lib/umaMoeTrainerStorage'

const PAGE_LIMIT = 50
const MAX_PAGES = 30

type Status = 'idle' | 'loading' | 'error' | 'empty'

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

export function UmaTrainerLookup({ supportCardId, cardName }: { supportCardId: number; cardName: string }) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorOrEmpty, setErrorOrEmpty] = useState<string | null>(null)
  const [trainerName, setTrainerName] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)

  const hydrateFromCache = useCallback(() => {
    const c = getCachedTrainer(supportCardId)
    if (c) {
      setTrainerName(c.trainerName)
      setAccountId(c.accountId)
    } else {
      setTrainerName(null)
      setAccountId(null)
    }
    setStatus('idle')
    setErrorOrEmpty(null)
  }, [supportCardId])

  useEffect(() => {
    hydrateFromCache()
  }, [hydrateFromCache])

  const searchExcludingBlocked = useCallback(
    async (excludeAccountId: string | null) => {
      setErrorOrEmpty(null)
      setStatus('loading')
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const data = await fetchUmaSupportCardSearch({
            supportCardId,
            page,
            limit: PAGE_LIMIT,
          })
          const items = data.items ?? []
          for (const it of items) {
            const id = it.account_id
            if (!id) continue
            if (excludeAccountId && id === excludeAccountId) continue
            if (isBlockedForCard(supportCardId, id)) continue
            setTrainerName(it.trainer_name)
            setAccountId(id)
            setCachedTrainer(supportCardId, { accountId: id, trainerName: it.trainer_name })
            setStatus('idle')
            return
          }
          if (items.length < PAGE_LIMIT) break
        }
        setTrainerName(null)
        setAccountId(null)
        setStatus('empty')
        setErrorOrEmpty('No trainers found.')
      } catch (e) {
        setTrainerName(null)
        setAccountId(null)
        setStatus('error')
        setErrorOrEmpty(e instanceof Error ? e.message : 'Request failed.')
      }
    },
    [supportCardId],
  )

  /** Only when there is no cached / displayed ID. */
  const onRequestFriendId = () => {
    void searchExcludingBlocked(null)
  }

  /** Block current ID, clear cache, fetch a different trainer. */
  const onReplaceBadId = () => {
    if (!accountId) return
    const prev = accountId
    blockTrainerForCard(supportCardId, prev)
    clearCachedTrainer(supportCardId)
    void searchExcludingBlocked(prev)
  }

  const copyId = async () => {
    if (!accountId) return
    try {
      await navigator.clipboard.writeText(accountId)
    } catch {
      /* ignore */
    }
  }

  const loading = status === 'loading'
  const showFriendIdButton = !accountId && !loading
  const showResult = Boolean(accountId) && !loading

  return (
    <div
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        rowGap: 4,
        fontSize: 10,
        color: '#71717a',
      }}
    >
      {showFriendIdButton && (
        <button
          type="button"
          onClick={onRequestFriendId}
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.03)',
            color: '#a1a1aa',
            fontSize: 10,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Friend ID
        </button>
      )}

      {loading && (
        <span style={{ color: '#52525b', fontSize: 10 }} aria-live="polite">
          …
        </span>
      )}

      {showResult && accountId && (
        <>
          {trainerName ? (
            <span
              style={{
                color: '#737373',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={trainerName}
            >
              {trainerName}
            </span>
          ) : null}
          <span
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 10,
              color: '#a3a3a3',
              letterSpacing: '0.02em',
            }}
          >
            {formatTrainerIdForDisplay(accountId)}
          </span>
          <button
            type="button"
            aria-label="Copy trainer ID"
            title="Copy trainer ID"
            onClick={() => void copyId()}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            onClick={onReplaceBadId}
            disabled={loading}
            style={{
              padding: 0,
              border: 'none',
              background: 'none',
              color: '#52525b',
              fontSize: 9,
              textDecoration: 'underline',
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            Bad ID?
          </button>
        </>
      )}

      {(status === 'error' || status === 'empty') && errorOrEmpty && (
        <span style={{ color: status === 'error' ? '#b91c1c' : '#737373', fontSize: 10 }}>{errorOrEmpty}</span>
      )}

      <a
        href={umaDatabaseFilteredUrl(supportCardId)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${cardName} — open database`}
        style={{ fontSize: 9, color: '#3f3f46' }}
      >
        uma.moe
      </a>
    </div>
  )
}
