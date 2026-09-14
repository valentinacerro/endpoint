import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import type { Booking } from '../api/types'
import { AppBar } from '../components/AppBar'
import { BookingForm } from '../components/BookingForm'
import { Icon } from '../components/Icon'
import { Nothing } from '../components/Nothing'
import { count, t } from '../i18n'
import { BOOKING_KIND_ICON, bookingKindLabel } from '../i18n/labels'
import { attachmentsOf } from '../lib/itinerary'
import { isWaiting } from '../lib/optimistic'
import { formatCalendarDate, dayKeyInZone, formatTimeInZone } from '../lib/datetime'

/**
 * Everything you have booked, in the order it happens.
 *
 * This screen did not exist, and its absence was the first thing anyone
 * complained about: "la gestione del volo e degli hotel non ci capisco un
 * cazzo". Bookings appeared inline on the itinerary, where a hotel you
 * are in for a week shows up once and then never again, and the only way
 * to add one was a round green button on the itinerary — which is the
 * button a person looks at when they want an itinerary made.
 *
 * What it answers, in one screen: what have I booked, when, and is the
 * confirmation on this phone for when there is no signal.
 */
export function Bookings() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const [adding, setAdding] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const data = bundle.data
  const zone = data.trip.primary_tz

  /** When it happens, for sorting. Undated ones go last, not first. */
  function when(booking: Booking): string {
    return booking.start_at ?? '9999'
  }

  const ordered = [...data.bookings].sort((a, b) => when(a).localeCompare(when(b)))

  /** How many documents it carries. One still in the write queue is not
      one you can open at a desk, so it is not counted. */
  function papers(booking: Booking): number {
    return attachmentsOf(data, booking.id).filter((item) => !isWaiting(item)).length
  }

  return (
    <>
      <AppBar title={t('bookings.title')} subtitle={data.trip.title} back={`/trips/${tripId}`} />
      <main className="page stack">
        {ordered.length === 0 && !adding && (
          <Nothing
            title={t('bookings.none')}
            hint={t('bookings.noneHint')}
            action={
              <button className="button button--small" onClick={() => setAdding(true)}>
                {t('bookings.add')}
              </button>
            }
          />
        )}

        <ul className="docs">
          {ordered.map((booking) => {
            const paper = papers(booking)
            const start = booking.start_at
              ? `${formatCalendarDate(dayKeyInZone(booking.start_at, booking.start_tz ?? zone))} · ${formatTimeInZone(booking.start_at, booking.start_tz ?? zone)}`
              : t('bookings.noDate')
            return (
              <li key={booking.id} className="doc">
                <Link className="doc__open" to={`/trips/${tripId}/bookings/${booking.id}`}>
                  <span className="doc__name">
                    <Icon name={BOOKING_KIND_ICON[booking.kind]} size={14} />
                    {' '}
                    {booking.title}
                  </span>
                  <span className="doc__meta">
                    {[bookingKindLabel(booking.kind), start].join(' · ')}
                  </span>
                  <span className="doc__meta">
                    {paper === 0 ? t('bookings.noPapers') : count('bookings.papers', paper)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>

        {adding ? (
          <BookingForm
            tripId={tripId}
            defaultZone={zone}
            stops={data.stops}
            onDone={() => setAdding(false)}
          />
        ) : (
          ordered.length > 0 && (
            <button className="button" onClick={() => setAdding(true)}>
              {t('bookings.add')}
            </button>
          )
        )}
      </main>
    </>
  )
}
