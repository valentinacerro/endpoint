import { useState } from 'react'

import { useLookupPlace, useUpdateStop } from '../api/trips'
import type { Stop } from '../api/types'
import { count, t } from '../i18n'

interface Found {
  stop: Stop
  name: string
  where: string | null
  lat: number
  lon: number
}

/**
 * Give the stops that have none a position.
 *
 * A stop has had lat/lon since the first migration and nothing has ever
 * written them, so every city on this trip is a name with no place on
 * the earth. That is invisible until something tries to measure from it:
 * the forecast already complains about it, the map cannot draw it, and
 * a planner cannot tell whether a temple belongs to Tokyo or to Kyoto.
 *
 * Proposals first, never a silent write. "Tokyo" matches a suburb of
 * Tokyo more often than you would like, and a wrong city is worse than
 * no city — it would quietly claim places that belong elsewhere.
 */
export function LocateStops({ tripId, stops }: { tripId: string; stops: Stop[] }) {
  const lookup = useLookupPlace()
  const update = useUpdateStop(tripId)

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [found, setFound] = useState<Found[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const missing = stops.filter((stop) => stop.lat === null || stop.lon === null)
  if (missing.length === 0) return null

  async function search() {
    setFailed(false)
    setProgress({ done: 0, total: missing.length })
    const hits: Found[] = []

    for (const [index, stop] of missing.entries()) {
      try {
        // The country narrows "Kyoto" away from the one in the United
        // States without needing a second round trip.
        const query = [stop.name, stop.country_code].filter(Boolean).join(' ')
        const results = await lookup.mutateAsync({ query })
        const best = results[0]
        if (best) {
          hits.push({ stop, name: best.name, where: best.where, lat: best.lat, lon: best.lon })
        }
      } catch {
        // One city that cannot be found should not abandon the others.
      }
      setProgress({ done: index + 1, total: missing.length })
    }

    setProgress(null)
    setFound(hits)
  }

  async function accept() {
    if (!found) return
    setSaving(true)
    setFailed(false)
    try {
      for (const hit of found) {
        await update.mutateAsync({ id: hit.stop.id, lat: hit.lat, lon: hit.lon })
      }
      setFound(null)
    } catch {
      // Stop writes are not queueable, so this is a real failure.
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card stack stack--tight">
      <p className="muted small">{count('stops.missingPositions', missing.length)}</p>

      {progress ? (
        <p className="hint">
          {t('stops.locating', { done: progress.done, total: progress.total })}
        </p>
      ) : found === null ? (
        <button className="button button--quiet" onClick={() => void search()}>
          {t('stops.findPositions')}
        </button>
      ) : null}

      {found !== null && found.length === 0 && (
        <p className="hint">{t('stops.noneFound')}</p>
      )}

      {found !== null && found.length > 0 && (
        <>
          <ul className="docs">
            {found.map((hit) => (
              <li key={hit.stop.id} className="doc">
                <span className="doc__open" style={{ cursor: 'default' }}>
                  <span className="doc__name">
                    {hit.stop.name} → {hit.name}
                  </span>
                  <span className="doc__meta">{hit.where ?? t('stops.noContext')}</span>
                </span>
                <button
                  className="chip chip--danger"
                  aria-label={t('common.delete')}
                  onClick={() => setFound(found.filter((other) => other !== hit))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          {failed && (
            <p className="field__error" role="alert">
              {t('stops.saveFailed')}
            </p>
          )}

          <div className="row row--end">
            <button className="button button--quiet" onClick={() => setFound(null)}>
              {t('common.cancel')}
            </button>
            <button className="button" disabled={saving} onClick={() => void accept()}>
              {saving ? t('common.saving') : count('stops.acceptPositions', found.length)}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
