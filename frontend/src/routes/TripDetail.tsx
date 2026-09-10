import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import type { Booking } from '../api/types'
import { BookingForm } from '../components/BookingForm'
import { t } from '../i18n'
import { BOOKING_KIND_ICON, bookingKindLabel } from '../i18n/labels'
import {
  formatCalendarDate,
  formatDayKey,
  formatTimeInZone,
  homeTimeHint,
  shortZoneName,
} from '../lib/datetime'
import { buildTimeline, nextBooking } from '../lib/itinerary'

function BookingRow({ booking, zone }: { booking: Booking; zone: string }) {
  const hint = booking.start_at ? homeTimeHint(booking.start_at, zone) : null

  return (
    <li className="entry">
      <div className="entry__time">
        {booking.start_at ? (
          <>
            <strong>{formatTimeInZone(booking.start_at, zone)}</strong>
            {/* Only shown when the two clocks actually differ and the event
                is imminent — otherwise it would be on every single row. */}
            {hint && <span className="entry__hint">{t('timeline.inYourZone', hint)}</span>}
          </>
        ) : (
          <span aria-hidden="true">·</span>
        )}
      </div>

      <div className="entry__body">
        <span className="entry__title">
          <span aria-hidden="true">{BOOKING_KIND_ICON[booking.kind]}</span> {booking.title}
        </span>
        <span className="entry__meta">
          {bookingKindLabel(booking.kind)}
          {booking.provider && ` · ${booking.provider}`}
          {booking.confirmation_code && ` · ${booking.confirmation_code}`}
        </span>
        {(booking.origin_label || booking.destination_label) && (
          <span className="entry__meta">
            {booking.origin_label} → {booking.destination_label}
          </span>
        )}
      </div>
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
        <p className="muted">{t('timeline.empty')}</p>
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
                <BookingRow key={entry.booking.id} booking={entry.booking} zone={entry.zone} />
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
              <BookingRow key={booking.id} booking={booking} zone={trip.primary_tz} />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
