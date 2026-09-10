import { useSyncExternalStore } from 'react'

import { getConnection, subscribeConnection } from '../api/client'
import { t } from '../i18n'
import { useOutbox } from '../offline/useOutbox'

/**
 * Status strip: thin, and never blocking.
 *
 * A silent sixty-second spinner reads as a fault; a bar that names the wait
 * reads as what it is, a free server waking up. It also owns the count of
 * writes still to go out, because "did my expense save?" is a question that
 * deserves an answer in view rather than on a settings screen.
 */
export function SyncBanner() {
  const connection = useSyncExternalStore(subscribeConnection, getConnection)
  const { pending, flushing, drain } = useOutbox()

  const quiet = connection === 'unknown' || connection === 'online'
  if (quiet && pending === 0) return null

  const state = pending > 0 && quiet ? 'pending' : connection

  return (
    <div className={`sync-banner sync-banner--${state}`} role="status" aria-live="polite">
      {(connection === 'waking' || flushing) && (
        <span className="sync-banner__bar" aria-hidden="true" />
      )}
      <span className="sync-banner__text">
        {connection === 'offline' && t('sync.offline')}
        {connection === 'waking' && t('sync.waking')}
        {pending > 0 && (
          <>
            {connection !== 'online' && connection !== 'unknown' && ' · '}
            {t('sync.pending', { count: pending })}
          </>
        )}
        {pending > 0 && connection !== 'offline' && !flushing && (
          <button className="sync-banner__action" onClick={() => void drain()}>
            {t('sync.now')}
          </button>
        )}
      </span>
    </div>
  )
}
