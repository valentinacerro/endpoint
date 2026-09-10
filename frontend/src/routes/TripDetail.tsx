import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import type { Booking } from '../api/types'
import { BookingForm } from '../components/BookingForm'
import { OfflineReminder } from '../components/OfflineReminder'
import { t } from '../i18n'
import { BOOKING_KIND_ICON, bookingKindLabel } from '../i18n/labels'
import {
  formatCalendarDate,
  formatDayKey,
  formatTimeInZone,
  homeTimeHint,
  shortZoneName,
} from '../lib/datetime'
import { attachmentsOf, buildTimeline, nextBooking } from '../lib/itinerary'

function StatusPill({ status }: { status: Booking['status'] }) {
  if (status === 'confirmed') return null
  return (
    <span className={`pill pill--${status}`}>
      {status === 'pending' ? t('booking.status.pending') : t('booking.status.cancelled')}
    </span>
  )
}

function BookingRow({
  booking,
  zone,
  showZone,
  tripId,
  documents,
}: {
  booking: Booking
  zone: string
  showZone: boolean
  tripId: string
  documents: number
}) {
  const hint = booking.start_at ? homeTimeHint(booking.start_at, zone) : null
  const meta = [
    bookingKindLabel(booking.kind),
    booking.provider,
    booking.confirmation_code,
  ].filter(Boolean)

  return (
    <li className="entry" data-kind={booking.kind}>
      <div className="entry__time">
        {booking.start_at ? (
          <>
            <span>{formatTimeInZone(booking.start_at, zone)}</span>
            {/* The zone label only when the trip spans more than one, so a
                single-country trip is not shouted at on every row. */}
            {showZone && <span className="entry__zone">{shortZoneName(zone)}</span>}
            {/* And the home clock only when it differs *and* the event is
                imminent — otherwise it would be on every row too. */}
            {hint && <span className="entry__hint">{t('timeline.inYourZone', hint)}</span>}
          </>
        ) : (
          <span className="entry__zone" aria-hidden="true">
            —
          </span>
        )}
      </div>

      <div className="entry__marker">
        <span className="entry__dot" aria-hidden="true">
          {BOOKING_KIND_ICON[booking.kind]}
        </span>
      </div>

      <Link className="entry__content" to={`/trips/${tripId}/bookings/${booking.id}`}>
        <span className="entry__title">
          {booking.title}
          <StatusPill status={booking.status} />
          {documents > 0 && (
            <span className="entry__docs" title={`${documents}`} aria-hidden="true">
              📎
            </span>
          )}
        </span>
        {(booking.origin_label || booking.destination_label) && (
          <span className="entry__route">
            {booking.origin_label} → {booking.destination_label}
          </span>
        )}
        <span className="entry__meta">{meta.join(' · ')}</span>
      </Link>
    </li>
  )
}

export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const [adding, setAdding] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data) return <main className="page">{t('common.error')}</main>

  const { trip } = bundle.data
  const timeline = buildTimeline(bundle.data)
  const next = nextBooking(bundle.data)

  // Zone labels only earn their place on a trip that actually spans more
  // than one; on a single-country trip they are noise on every row.
  const zones = new Set<string>([
    trip.primary_tz,
    ...bundle.data.stops.map((stop) => stop.tz),
    ...bundle.data.bookings.flatMap((booking) => (booking.start_tz ? [booking.start_tz] : [])),
  ])
  const showZone = zones.size > 1

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

      {tripId && <OfflineReminder bundle={bundle.data} tripId={tripId} />}

      {next?.start_at && (
        <section className="card next">
          <span className="next__label">{t('timeline.next')}</span>
          <span className="next__title">
            <span aria-hidden="true">{BOOKING_KIND_ICON[next.kind]}</span> {next.title}
          </span>
          <span className="muted">
            {formatDayKey(next.start_at.slice(0, 10))} ·{' '}
            {formatTimeInZone(next.start_at, next.start_tz ?? trip.primary_tz)}{' '}
            {shortZoneName(next.start_tz ?? trip.primary_tz)}
          </span>
        </section>
      )}

      {adding && tripId ? (
        <BookingForm
          tripId={tripId}
          defaultZone={trip.primary_tz}
          stops={bundle.data.stops}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="button" onClick={() => setAdding(true)}>
          {t('timeline.addBooking')}
        </button>
      )}

      {timeline.days.length === 0 && timeline.undated.length === 0 && (
        <p className="empty">{t('timeline.empty')}</p>
      )}

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
              {day.entries.map((entry) => (
                <BookingRow
                  key={entry.booking.id}
                  booking={entry.booking}
                  zone={entry.zone}
                  showZone={showZone}
                  tripId={tripId!}
                  documents={attachmentsOf(bundle.data!, entry.booking.id).length}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {timeline.undated.length > 0 && (
        <section className="day">
          <h2 className="day__header">
            <span className="day__number">{t('timeline.undated')}</span>
          </h2>
          <ul className="entries">
            {timeline.undated.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking}
                zone={trip.primary_tz}
                showZone={false}
                tripId={tripId!}
                documents={attachmentsOf(bundle.data!, booking.id).length}
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
