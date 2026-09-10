import { Link, useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { t } from '../i18n'

/**
 * The things you touch while planning, not while travelling.
 *
 * Kept off the bottom bar on purpose: five destinations is the most a thumb
 * can aim at, and stops, settings and the offline check are not what you
 * reach for standing on a platform.
 */
export function TripMore() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)

  const rows = [
    { to: `/trips/${tripId}/weather`, label: t('weather.title'), hint: t('more.weatherHint') },
    { to: `/trips/${tripId}/packing`, label: t('packing.title'), hint: t('more.packingHint') },
    { to: `/trips/${tripId}/stops`, label: t('stops.title'), hint: t('more.stopsHint') },
    { to: `/trips/${tripId}/offline`, label: t('offline.title'), hint: t('more.offlineHint') },
    { to: `/trips/${tripId}/edit`, label: t('trip.edit'), hint: t('more.editHint') },
  ]

  return (
    <>
      <AppBar title={t('tabs.more')} subtitle={bundle.data?.trip.title} back={`/trips/${tripId}`} />
      <main className="page">
        <ul className="rows">
          {rows.map((row) => (
            <li key={row.to}>
              <Link className="rows__item" to={row.to}>
                <span className="rows__body">
                  <span className="rows__title">{row.label}</span>
                  <span className="rows__hint">{row.hint}</span>
                </span>
                <span className="rows__chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
