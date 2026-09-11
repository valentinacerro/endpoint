import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'

import { attachmentUrl, useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { count, t } from '../i18n'
import { formatSyncTime } from '../lib/datetime'
import { formatBytes } from '../lib/images'
import {
  pinAll,
  pinnedUrls,
  storageUsage,
  type PinProgress,
} from '../offline/attachmentCache'

/**
 * The screen you check before boarding.
 *
 * Its whole job is to answer one question honestly: is what I need actually
 * on this phone? A vague reassurance would be worse than nothing, so it
 * counts real cached entries rather than trusting that a download happened.
 */
export function OfflineStatus() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)

  const [pinned, setPinned] = useState<Set<string> | null>(null)
  const [progress, setProgress] = useState<PinProgress | null>(null)
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    setPinned(await pinnedUrls())
    setSpace(await storageUsage())
    setPersisted(navigator.storage?.persisted ? await navigator.storage.persisted() : null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const attachments = bundle.data.attachments
  const urls = attachments.map((item) => attachmentUrl(tripId, item.id))
  const missing = pinned ? urls.filter((url) => !pinned.has(url)) : []
  const ready = urls.length - missing.length
  // `caches` is absent over plain http, which is what a LAN address gives.
  const supported = typeof caches !== 'undefined'

  async function downloadAll() {
    setProgress({ done: 0, total: missing.length, failed: 0 })
    const result = await pinAll(missing, setProgress)
    await refresh()
    setProgress(result.failed > 0 ? result : null)
  }

  return (
    <>
      <AppBar
        title={t('offline.title')}
        subtitle={bundle.data.trip.title}
        back={`/trips/${tripId}/more`}
      />
      <main className="page stack">
      <p className="muted">{t('offline.intro')}</p>

      {!supported && <p className="hint">{t('offline.unavailable')}</p>}

      <section className="card stack stack--tight">
        <h2 className="section__title">{t('offline.data')}</h2>
        <p className="detail__value">{t('offline.dataReady')}</p>
        <p className="muted small">
          {bundle.dataUpdatedAt
            ? t('offline.lastSync', { when: formatSyncTime(bundle.dataUpdatedAt) })
            : t('offline.neverSynced')}
        </p>
      </section>

      <section className="card stack stack--tight">
        <h2 className="section__title">{t('offline.documents')}</h2>

        {attachments.length === 0 ? (
          <p className="muted">{t('offline.documentsNone')}</p>
        ) : (
          <>
            <p className="detail__value">
              {missing.length === 0
                ? t('offline.allReady')
                : t('offline.ready', { done: ready, total: urls.length })}
            </p>

            <ul className="docs">
              {attachments.map((attachment, index) => {
                const isReady = pinned?.has(urls[index]) ?? false
                return (
                  <li key={attachment.id} className="doc">
                    <span className="doc__open" style={{ cursor: 'default' }}>
                      <span className="doc__name">{attachment.filename}</span>
                      <span className="doc__meta">{formatBytes(attachment.byte_size)}</span>
                    </span>
                    <span className={`chip ${isReady ? 'chip--on' : ''}`}>
                      {isReady ? '✓' : '—'}
                    </span>
                  </li>
                )
              })}
            </ul>

            {progress && progress.done < progress.total && (
              <p className="muted small">
                {t('offline.downloading', { done: progress.done, total: progress.total })}
              </p>
            )}
            {progress && progress.failed > 0 && progress.done === progress.total && (
              <p className="field__error">
                {count('offline.someFailed', progress.failed)}
              </p>
            )}

            {missing.length > 0 && supported && (
              <button
                className="button"
                onClick={() => void downloadAll()}
                disabled={progress !== null && progress.done < progress.total}
              >
                {t('offline.downloadAll', { count: missing.length })}
              </button>
            )}
          </>
        )}
      </section>

      {space && (
        <p className="muted small">{t('offline.space', { used: formatBytes(space.usage) })}</p>
      )}
      {persisted === false && <p className="hint">{t('offline.notPersisted')}</p>}
      </main>
    </>
  )
}
