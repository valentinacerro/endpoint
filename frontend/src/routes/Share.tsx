import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { useCreatePlace, useResolveMapsLink, useTripBundle, useTrips } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { count, t } from '../i18n'
import { linksIn, looksLikeAList, shortenLink } from '../lib/share'
import { tripCentre } from '../lib/stops'

type Outcome = {
  link: string
  label: string
  state: 'saved' | 'estimated' | 'noPosition' | 'failed'
}

/**
 * Where a link shared from another app lands.
 *
 * The whole point of registering as a share target: in Google Maps you
 * tap Share and pick endpoint, and the place is here. No copying, no
 * pasting, and nothing resembling a Takeout export.
 *
 * The route is an ordinary navigation, which is what makes it survive
 * not being signed in: the login screen appears in front of it, the link
 * stays in the address bar, and this picks it up again afterwards.
 */
export function Share() {
  const [params] = useSearchParams()
  const trips = useTrips()
  const navigate = useNavigate()

  // Android puts the link wherever it likes, and Maps puts it inside the
  // text next to the place name rather than in the url field.
  const links = linksIn([params.get('url'), params.get('text'), params.get('title')].join('\n'))

  const [tripId, setTripId] = useState<string | null>(null)
  const chosen = tripId ?? trips.data?.[0]?.id ?? null

  if (trips.isPending) return <main className="page">{t('common.loading')}</main>

  if (links.length === 0) {
    return (
      <>
        <AppBar title={t('share.title')} back="/" />
        <main className="page stack">
          <p className="empty">{t('share.nothing')}</p>
        </main>
      </>
    )
  }

  const lists = links.filter(looksLikeAList)

  return (
    <>
      <AppBar title={t('share.title')} back="/" />
      <main className="page stack">
        {lists.length > 0 && <p className="hint">{t('share.isAList')}</p>}

        {(trips.data?.length ?? 0) > 1 && (
          <label className="field">
            <span className="field__label">{t('share.whichTrip')}</span>
            <select
              className="field__input"
              value={chosen ?? ''}
              onChange={(event) => setTripId(event.target.value)}
            >
              {trips.data?.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {chosen === null ? (
          <p className="empty">{t('share.noTrip')}</p>
        ) : (
          <Importer key={chosen} tripId={chosen} links={links} onDone={() => navigate(`/trips/${chosen}/places`)} />
        )}
      </main>
    </>
  )
}

/**
 * Resolves the shared links, one after another.
 *
 * In sequence rather than at once: each one is a redirect the server has
 * to follow, and a dozen at a time against a free instance that may
 * still be waking up is how you get a dozen timeouts.
 */
function Importer({
  tripId,
  links,
  onDone,
}: {
  tripId: string
  links: string[]
  onDone: () => void
}) {
  const resolve = useResolveMapsLink()
  const create = useCreatePlace(tripId)
  const bundle = useTripBundle(tripId)

  const [done, setDone] = useState<Outcome[]>([])
  const [running, setRunning] = useState(true)
  // A share arrives once; re-running the import on a re-render would add
  // the place again.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    void (async () => {
      for (const link of links) {
        const label = shortenLink(link)
        try {
          const found = await resolve.mutateAsync({
            url: link,
            near: bundle.data ? tripCentre(bundle.data) : null,
          })
          await create.mutateAsync({
            id: crypto.randomUUID(),
            name: found.name ?? label,
            category: 'sight',
            priority: 'normal',
            visit_minutes: 60,
            lat: found.lat,
            lon: found.lon,
            url: found.url,
          })
          setDone((sofar) => [
            ...sofar,
            {
              link,
              label: found.name ?? label,
              state:
                found.position === 'geocoded'
                  ? 'estimated'
                  : found.lat === null
                    ? 'noPosition'
                    : 'saved',
            },
          ])
        } catch {
          // One bad link should not abandon the other eleven.
          setDone((sofar) => [...sofar, { link, label, state: 'failed' }])
        }
      }
      setRunning(false)
    })()
    // Deliberately once, on mount: the links come from the URL and do
    // not change while this is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saved = done.filter((entry) => entry.state !== 'failed').length

  return (
    <>
      {running ? (
        <p className="hint">{t('share.adding', { done: done.length, total: links.length })}</p>
      ) : (
        <p className="muted small">{count('share.added', saved)}</p>
      )}

      <ul className="docs">
        {done.map((entry) => (
          <li key={entry.link} className="doc">
            <span className="doc__open" style={{ cursor: 'default' }}>
              <span className="doc__name">{entry.label}</span>
              <span className="doc__meta">
                {entry.state === 'saved' && t('share.ok')}
                {entry.state === 'estimated' && t('maps.estimated')}
                {entry.state === 'noPosition' && t('maps.noCoords')}
                {entry.state === 'failed' && t('maps.error.generic')}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {!running && (
        <button className="button" onClick={onDone}>
          {t('share.seePlaces')}
        </button>
      )}
    </>
  )
}
