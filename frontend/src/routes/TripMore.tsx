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

  // Grouped, because rows of equal weight are a wall you read from the
  // top every time. The headings are the question you arrived with: am I
  // getting ready, am I travelling, or am I looking back?
  //
  // Two rows left this screen and are not coming back. "Organizza il
  // viaggio" was row one and is now a button on the trip itself; "Tappe"
  // was row two and is now the line of cities at the top of it. A drawer
  // is the right home for the things you need occasionally, and the wrong
  // home for the only two things the app cannot work without.
  const groups = [
    {
      title: t('more.group.planning'),
      rows: [
        { to: `/trips/${tripId}/packing`, label: t('packing.title'), hint: t('more.packingHint') },
        { to: `/trips/${tripId}/edit`, label: t('trip.edit'), hint: t('more.editHint') },
      ],
    },
    {
      title: t('more.group.travelling'),
      rows: [
        { to: `/trips/${tripId}/map`, label: t('tabs.map'), hint: t('more.mapHint') },
        { to: `/trips/${tripId}/nearby`, label: t('nearby.title'), hint: t('more.nearbyHint') },
        { to: `/trips/${tripId}/weather`, label: t('weather.title'), hint: t('more.weatherHint') },
        { to: `/trips/${tripId}/offline`, label: t('offline.title'), hint: t('more.offlineHint') },
      ],
    },
    {
      title: t('more.group.keeping'),
      rows: [
        { to: `/trips/${tripId}/diary`, label: t('diary.title'), hint: t('more.diaryHint') },
        {
          to: `/trips/${tripId}/memories`,
          label: t('memories.title'),
          hint: t('more.memoriesHint'),
        },
        { to: `/trips/${tripId}/print`, label: t('print.title'), hint: t('more.printHint') },
        { to: '/settings', label: t('settings.title'), hint: t('more.settingsHint') },
      ],
    },
  ]

  return (
    <>
      <AppBar title={t('tabs.more')} subtitle={bundle.data?.trip.title} back={`/trips/${tripId}`} />
      <main className="page stack">
        {groups.map((group) => (
          <section key={group.title} className="stack stack--tight">
            <h2 className="section__title">{group.title}</h2>
            <ul className="rows">
              {group.rows.map((row) => (
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
          </section>
        ))}
      </main>
    </>
  )
}
