import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import { BookingForm } from '../components/BookingForm'
import { OfflineReminder } from '../components/OfflineReminder'
import { SchedulePlace } from '../components/SchedulePlace'
import { TimelineEntry } from '../components/TimelineEntry'
import { t } from '../i18n'
import { BOOKING_KIND_ICON, bookingKindLabel } from '../i18n/labels'
import { formatCalendarDate, formatDayKey, formatTimeInZone, shortZoneName } from '../lib/datetime'
import { attachmentsOf, buildTimeline, nextBooking } from '../lib/itinerary'

export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const [adding, setAdding] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const data = bundle.data
  const { trip } = data
  const timeline = buildTimeline(data)
  const next = nextBooking(data)

  // Zone labels only earn their place on a trip that actually spans more
  // than one; on a single-country trip they are noise on every row.
  const zones = new Set<string>([
    trip.primary_tz,
    ...data.stops.map((stop) => stop.tz),
    ...data.bookings.flatMap((booking) => (booking.start_tz ? [booking.start_tz] : [])),
  ])
  const showZone = zones.size > 1

  const nothingAtAll =
    timeline.days.length === 0 &&
    timeline.undatedBookings.length === 0 &&
    timeline.unscheduledPlaces.length === 0

  return (
    <main className="page stack">
      <header className="stack stack--tight">
        <Link className="back" to="/">
          ← {t('common.back')}
        </Link>
        <h1 className="page__title">{trip.title}</h1>
        {trip.start_date && trip.end_date && (
          <p className="muted">
            {t('trips.dates', {
              from: formatCalendarDate(trip.start_date),
              to: formatCalendarDate(trip.end_date),
            })}
          </p>
        )}
      </header>

      <nav className="toolbar">
        <Link className="toolbar__link" to={`/trips/${tripId}/stops`}>
          {t('stops.open')}
        </Link>
        <Link className="toolbar__link" to={`/trips/${tripId}/places`}>
          {t('places.open')}
        </Link>
        <Link className="toolbar__link" to={`/trips/${tripId}/offline`}>
          {t('offline.open')}
        </Link>
        <Link className="toolbar__link" to={`/trips/${tripId}/edit`}>
          {t('common.edit')}
        </Link>
      </nav>

      <OfflineReminder bundle={data} tripId={tripId} />

      {next?.start_at && (
        <section className="card next">
          <span className="next__label">{t('timeline.next')}</span>
          <span className="next__title">
            <span aria-hidden="true">{BOOKING_KIND_ICON[next.kind]}</span> {next.title}
          </span>
          <span className="muted">
            {formatDayKey(next.start_at.slice(0, 10))} ·{' '}
            {formatTimeInZone(next.start_at, next.start_tz ?? trip.primary_tz)}{' '}
            {showZone && shortZoneName(next.start_tz ?? trip.primary_tz)}
          </span>
        </section>
      )}

      {adding ? (
        <BookingForm
          tripId={tripId}
          defaultZone={trip.primary_tz}
          stops={data.stops}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="button" onClick={() => setAdding(true)}>
          {t('timeline.addBooking')}
        </button>
      )}

      {nothingAtAll && <p className="empty">{t('timeline.empty')}</p>}

      {timeline.days.map((day) => (
        <section key={day.key} className="day">
          <h2 className="day__header">
            <span className="day__number">{t('timeline.day', { n: day.number })}</span>
            <span className="day__date">{formatDayKey(day.key)}</span>
            {day.stop && <span className="day__stop">{day.stop.name}</span>}
          </h2>
          {day.entries.length === 0 ? (
            <p className="day__empty">{t('timeline.emptyDay')}</p>
          ) : (
            <ul className="entries">
              {day.entries.map((placed) => (
                <TimelineEntry
                  key={placed.entry.id}
                  placed={placed}
                  showZone={showZone}
                  tripId={tripId}
                  documents={
                    placed.entry.type === 'booking'
                      ? attachmentsOf(data, placed.entry.booking.id).length
                      : 0
                  }
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {/* The wish list, kept at the bottom where it reads as "still to
          decide" rather than competing with the plan itself. */}
      {(timeline.unscheduledPlaces.length > 0 || timeline.undatedBookings.length > 0) && (
        <section className="day">
          <h2 className="day__header">
            <span className="day__number">{t('timeline.unscheduled')}</span>
          </h2>

          <ul className="docs">
            {timeline.unscheduledPlaces.map((item) => (
              <SchedulePlace
                key={item.id}
                tripId={tripId}
                place={item}
                defaultZone={data.stops[0]?.tz ?? trip.primary_tz}
                defaultDay={trip.start_date}
              />
            ))}
            {timeline.undatedBookings.map((item) => (
              <li key={item.id} className="doc">
                <Link className="doc__open" to={`/trips/${tripId}/bookings/${item.id}`}>
                  <span className="doc__name">
                    <span aria-hidden="true">{BOOKING_KIND_ICON[item.kind]}</span> {item.title}
                  </span>
                  <span className="doc__meta">{bookingKindLabel(item.kind)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
