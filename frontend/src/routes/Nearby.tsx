import { Link, useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { MapsLink } from '../components/MapsLink'
import { useGeolocation } from '../hooks/useGeolocation'
import { t } from '../i18n'
import { formatDayKey, formatDuration, formatSyncTime } from '../lib/datetime'
import { formatDistance, nearby, withoutCoordinates, type NearbyItem } from '../lib/nearby'

/**
 * What of yours is around you.
 *
 * Needs the GPS and nothing else: your places are already in the cached
 * bundle, so this is one of the few screens that is fully useful with the
 * phone in airplane mode — which is roughly its purpose.
 */
export function Nearby() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const { located, locate } = useGeolocation()

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const { trip, places, bookings } = bundle.data
  const blind = withoutCoordinates(places, bookings)

  const items =
    located.state === 'ready'
      ? nearby({
          places,
          bookings,
          from: located.point,
          zone: trip.primary_tz,
          tripId,
        })
      : []

  return (
    <>
      <AppBar title={t('nearby.title')} subtitle={trip.title} back={`/trips/${tripId}`} />
      <main className="page stack">
        {located.state === 'idle' && (
          <div className="stack stack--tight">
            <p className="muted small">{t('nearby.intro')}</p>
            <button className="button" onClick={locate}>
              {t('nearby.locate')}
            </button>
          </div>
        )}

        {located.state === 'locating' && <p className="muted small">{t('nearby.locating')}</p>}

        {located.state === 'denied' && <p className="hint">{t('nearby.denied')}</p>}
        {located.state === 'unavailable' && <p className="hint">{t('nearby.unavailable')}</p>}
        {located.state === 'failed' && (
          <div className="stack stack--tight">
            <p className="hint">{t('nearby.failed')}</p>
            <button className="button button--quiet" onClick={locate}>
              {t('nearby.again')}
            </button>
          </div>
        )}

        {located.state === 'ready' && (
          <>
            <div className="row">
              <p className="muted small">
                {t('nearby.fix', {
                  accuracy: Math.round(located.accuracyM),
                  when: formatSyncTime(located.at),
                })}
              </p>
              <button className="chip" onClick={locate}>
                {t('nearby.again')}
              </button>
            </div>

            {items.length === 0 && <p className="empty">{t('nearby.none')}</p>}

            {items.map((item) => (
              <NearbyCard key={`${item.kind}:${item.id}`} item={item} />
            ))}

            {blind > 0 && <p className="muted small">{t('nearby.noCoordinates', { count: blind })}</p>}
          </>
        )}
      </main>
    </>
  )
}

function NearbyCard({ item }: { item: NearbyItem }) {
  return (
    <article className="card stack stack--tight">
      <Link className="nearby__name" to={item.to}>
        {item.name}
      </Link>

      <p className="nearby__meta">
        <span className="nearby__distance">{formatDistance(item.km)}</span>
        {' · '}
        {t(item.mode === 'walk' ? 'nearby.onFoot' : 'nearby.byTransit', {
          minutes: formatDuration(item.minutes),
        })}
      </p>

      <p className="nearby__meta">
        {item.open.kind === 'open' && (
          <span className="nearby__open">
            {t('nearby.openUntil', { minutes: formatDuration(item.open.closesInMinutes) })}
          </span>
        )}
        {item.open.kind === 'closed' && <span className="nearby__shut">{t('nearby.closed')}</span>}
        {item.open.kind === 'unknown' && item.kind === 'place' && (
          <span className="muted">{t('nearby.hoursUnknown')}</span>
        )}
        {item.plannedDay && (
          <span className="muted">
            {item.open.kind === 'unknown' && item.kind === 'booking' ? '' : ' · '}
            {t('nearby.planned', { day: formatDayKey(item.plannedDay) })}
          </span>
        )}
      </p>

      <MapsLink place={{ name: item.name, lat: item.point.lat, lon: item.point.lon }} />
    </article>
  )
}
