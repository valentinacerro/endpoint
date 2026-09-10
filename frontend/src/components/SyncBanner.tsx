import { useSyncExternalStore } from 'react'

import { getConnection, subscribeConnection } from '../api/client'
import { t } from '../i18n'

/**
 * A thin, never-blocking status strip.
 *
 * A silent sixty-second spinner reads as a fault; a bar that names the wait
 * reads as what it is, a free server waking up.
 */
export function SyncBanner() {
  const connection = useSyncExternalStore(subscribeConnection, getConnection)

  if (connection === 'unknown' || connection === 'online') return null

  return (
    <div className={`sync-banner sync-banner--${connection}`} role="status" aria-live="polite">
      {connection === 'waking' && <span className="sync-banner__bar" aria-hidden="true" />}
      <span>{connection === 'offline' ? t('sync.offline') : t('sync.waking')}</span>
    </div>
  )
}
