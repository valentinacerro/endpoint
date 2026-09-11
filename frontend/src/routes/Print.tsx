import { useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { t } from '../i18n'
import { bookingKindLabel, BOOKING_KIND_ICON } from '../i18n/labels'
import {
  formatCalendarDate,
  formatDayKey,
  formatTimeInZone,
  shortZoneName,
} from '../lib/datetime'
import { buildTimeline } from '../lib/itinerary'
import { printableDetails, stopsSummary } from '../lib/printable'

/**
 * The trip on one sheet of paper.
 *
 * Everything else in this app defends against a dead network. Nothing
 * defends against a dead phone, and nothing in software can — so this
 * prints. Chrome on Android and every desktop browser will "print" to a
 * PDF, which is why there is no PDF library here: the browser already
 * has a better typesetter than anything worth adding to the bundle, and
 * it costs zero bytes to the people who never use this screen.
 *
 * Paper cannot be tapped, so what is normally one tap away is printed
 * outright — confirmation codes, addresses, telephone numbers.
 */
export function Print() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const { trip, stops } = bundle.data
  const timeline = buildTimeline(bundle.data)
  const zones = new Set(
    bundle.data.bookings.map((booking) => booking.start_tz).filter(Boolean),
  )
  // Only worth the ink when the trip actually crosses zones.
  const showZones = zones.size > 1 || (zones.size === 1 && !zones.has(trip.primary_tz))

  return (
    <>
      <AppBar title={t('print.title')} subtitle={trip.title} back={`/trips/${tripId}`} />
      <main className="page stack sheet">
        <p className="muted small no-print">{t('print.intro')}</p>
        <div className="row no-print">
          <button className="button" onClick={() => window.print()}>
            {t('print.action')}
          </button>
        </div>

        <header className="sheet__head">
          <h1 className="sheet__title">{trip.title}</h1>
          {trip.start_date && trip.end_date && (
            <p className="sheet__dates">
              {formatCalendarDate(trip.start_date)} – {formatCalendarDate(trip.end_date)}
            </p>
          )}
          {stops.length > 0 && <p className="sheet__stops">{stopsSummary(stops)}</p>}
        </header>

        {timeline.days.map((day) => (
          <section key={day.key} className="sheet__day">
            <h2 className="sheet__dayhead">
              <span>
                {t('print.day', { number: day.number })} · {formatDayKey(day.key)}
              </span>
              {day.stop && <span className="sheet__stop">{day.stop.name}</span>}
            </h2>

            {day.entries.length === 0 ? (
              <p className="sheet__empty">{t('print.nothing')}</p>
            ) : (
              day.entries.map(({ entry }) => (
                <article key={entry.id} className="sheet__entry">
                  <div className="sheet__when">
                    {formatTimeInZone(entry.startAt, entry.zone)}
                    {showZones && (
                      <span className="sheet__zone"> {shortZoneName(entry.zone)}</span>
                    )}
                  </div>
                  <div className="sheet__what">
                    <p className="sheet__name">
                      {entry.type === 'booking' ? (
                        <>
                          <span aria-hidden="true">{BOOKING_KIND_ICON[entry.booking.kind]}</span>{' '}
                          {entry.booking.title}
                          <span className="sheet__kind"> {bookingKindLabel(entry.booking.kind)}</span>
                        </>
                      ) : (
                        entry.place.name
                      )}
                    </p>

                    {entry.type === 'booking' &&
                      printableDetails(entry.booking).map((detail) => (
                        <p key={detail.label} className="sheet__detail">
                          <span className="sheet__label">{t(detail.label)}</span>{' '}
                          {detail.value}
                        </p>
                      ))}

                    {entry.type === 'place' && entry.place.address && (
                      <p className="sheet__detail">
                        <span className="sheet__label">{t('print.address')}</span>{' '}
                        {entry.place.address}
                      </p>
                    )}
                  </div>
                </article>
              ))
            )}

            {noteFor(bundle.data.day_notes, day.key) && (
              <p className="sheet__note">{noteFor(bundle.data.day_notes, day.key)}</p>
            )}
          </section>
        ))}

        {timeline.undatedBookings.length > 0 && (
          <section className="sheet__day">
            <h2 className="sheet__dayhead">{t('print.undated')}</h2>
            {timeline.undatedBookings.map((booking) => (
              <article key={booking.id} className="sheet__entry">
                <div className="sheet__when">—</div>
                <div className="sheet__what">
                  <p className="sheet__name">{booking.title}</p>
                  {printableDetails(booking).map((detail) => (
                    <p key={detail.label} className="sheet__detail">
                      <span className="sheet__label">{t(detail.label)}</span>{' '}
                      {detail.value}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </section>
        )}

        <footer className="sheet__foot">
          {t('print.generated', { when: formatCalendarDate(today()) })}
        </footer>
      </main>
    </>
  )
}

function noteFor(notes: { day: string; note: string }[], day: string): string | null {
  return notes.find((note) => note.day === day)?.note ?? null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
