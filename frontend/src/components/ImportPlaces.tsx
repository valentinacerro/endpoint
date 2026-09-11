import { useRef, useState, type ChangeEvent } from 'react'

import { useImportPlaces, useResolveMapsLink, useUpdatePlace, type ImportSummary } from '../api/trips'
import type { Place } from '../api/types'
import { count, t } from '../i18n'

/** Gentle spacing between resolutions, so a long list does not hammer Google. */
const PAUSE_MS = 250

interface Props {
  tripId: string
  places: Place[]
  onDone: () => void
}

/**
 * Import a saved list exported from Google Takeout.
 *
 * The import itself is offline and instant: positions are read out of each
 * row's link where the link happens to carry them. Many Takeout URLs hold
 * only a place id, so filling those in means one redirect each — offered
 * afterwards as a separate, interruptible step rather than making the
 * upload take minutes.
 */
export function ImportPlaces({ tripId, places, onDone }: Props) {
  const upload = useImportPlaces(tripId)
  const resolve = useResolveMapsLink()
  const update = useUpdatePlace(tripId)
  const inputRef = useRef<HTMLInputElement>(null)

  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [found, setFound] = useState<number | null>(null)

  const missing = places.filter((place) => place.lat === null && place.url)

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFound(null)
    upload.mutate(file, { onSuccess: setSummary })
  }

  async function fillPositions() {
    setProgress({ done: 0, total: missing.length })
    let hits = 0

    for (const [index, place] of missing.entries()) {
      try {
        const resolved = await resolve.mutateAsync(place.url!)
        if (resolved.lat !== null) {
          await update.mutateAsync({ id: place.id, lat: resolved.lat, lon: resolved.lon })
          hits += 1
        }
      } catch {
        // One unreadable link should not abandon the other ninety-nine.
      }
      setProgress({ done: index + 1, total: missing.length })
      await new Promise((done) => setTimeout(done, PAUSE_MS))
    }

    setProgress(null)
    setFound(hits)
  }

  return (
    <div className="card stack">
      <p className="hint">{t('maps.importHelp')}</p>

      <input ref={inputRef} type="file" accept=".zip,.csv,application/zip,text/csv" hidden onChange={onPick} />

      <button
        className="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending || progress !== null}
      >
        {upload.isPending ? t('maps.importing') : t('maps.import')}
      </button>

      {upload.error && (
        <p className="field__error" role="alert">
          {upload.error.message || t('common.error')}
        </p>
      )}

      {summary && (
        <p className="detail__value">
          {summary.lists > 1 && `${count('maps.fromLists', summary.lists)} · `}
          {t('maps.imported', {
            created: summary.created,
            withPos: summary.with_position,
            skipped: summary.skipped,
          })}
        </p>
      )}

      {progress && (
        <p className="muted small">
          {t('maps.resolving', { done: progress.done, total: progress.total })}
        </p>
      )}

      {found !== null && (
        <p className="detail__value">
          {count('maps.resolved', found, { found, total: missing.length + found })}
        </p>
      )}

      {missing.length > 0 && progress === null && (
        <button className="button button--quiet" onClick={() => void fillPositions()}>
          {count('maps.resolveMissing', missing.length)}
        </button>
      )}

      <div className="row row--end">
        <button className="button button--quiet" onClick={onDone}>
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
