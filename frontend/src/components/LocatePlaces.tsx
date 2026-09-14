import { useState } from 'react'

import { useLocatePlace, useResolveMapsLink, useUpdatePlace } from '../api/trips'
import type { Place } from '../api/types'
import { count, t } from '../i18n'
import { Icon } from './Icon'

/** Between calls, so a list of ninety is polite to two free services. */
const PAUSE_MS = 350

/**
 * Give a position to places that were saved without one.
 *
 * This existed, buried inside the panel for importing a Takeout archive,
 * and it only worked on places that had a Maps link. Both were wrong. The
 * repair belongs where the damage is visible — a list of rows all reading
 * "no coordinates" — and most of those rows got that way because the
 * geocoder was refusing anonymous clients, which has nothing to do with
 * Takeout and leaves no link behind on a place typed by hand.
 *
 * A link first when there is one: it may carry real coordinates, which
 * beats any lookup. Otherwise the name.
 */
export function LocatePlaces({
  tripId,
  places,
  near,
}: {
  tripId: string
  places: readonly Place[]
  near: { lat: number; lon: number } | null
}) {
  const resolve = useResolveMapsLink()
  const locate = useLocatePlace()
  const update = useUpdatePlace(tripId)

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [found, setFound] = useState<number | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const missing = places.filter((place) => place.lat === null)
  if (missing.length === 0) return null

  async function run() {
    setFound(null)
    setUnavailable(false)
    setProgress({ done: 0, total: missing.length })
    let hits = 0

    for (const [index, place] of missing.entries()) {
      try {
        const position = place.url
          ? await resolve.mutateAsync({ url: place.url, near })
          : await locate.mutateAsync({ name: place.name, near })
        if (position && position.lat !== null && position.lon !== null) {
          await update.mutateAsync({ id: place.id, lat: position.lat, lon: position.lon })
          hits += 1
        }
      } catch (error) {
        // One unreadable name must not abandon the other ninety-nine —
        // but the lookup being down is worth stopping for, because
        // every remaining call will fail the same way.
        if ((error as { code?: string }).code === 'lookup_unavailable') {
          setUnavailable(true)
          break
        }
      }
      setProgress({ done: index + 1, total: missing.length })
      await new Promise((done) => setTimeout(done, PAUSE_MS))
    }

    setProgress(null)
    setFound(hits)
  }

  if (progress) {
    return (
      <p className="hint">{t('locate.working', { done: progress.done, total: progress.total })}</p>
    )
  }

  return (
    <>
      <button className="card prompt" onClick={() => void run()}>
        <span className="prompt__body">
          <span className="prompt__title">{count('locate.missing', missing.length)}</span>
          <span className="prompt__hint">{t('locate.hint')}</span>
        </span>
        <Icon name="search" size={18} />
      </button>
      {unavailable && <p className="field__error">{t('lookup.unavailable')}</p>}
      {found !== null && !unavailable && (
        <p className="hint">
          {found > 0 ? count('locate.found', found) : t('locate.foundNone')}
        </p>
      )}
    </>
  )
}
