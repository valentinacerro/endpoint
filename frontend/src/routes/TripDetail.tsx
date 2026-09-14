import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'

import { useTripBundle, useUpdatePlace } from '../api/trips'
import type { Place } from '../api/types'
import { BookingForm } from '../components/BookingForm'
import { DayNoteEditor } from '../components/DayNoteEditor'
import { DayThemePicker } from '../components/DayTheme'
import { EmptyDay } from '../components/EmptyDay'
import { OfflineReminder } from '../components/OfflineReminder'
import { OptimizeDay } from '../components/OptimizeDay'
import { FirstSteps, startingOut } from '../components/FirstSteps'
import { TourOffer } from '../components/TourOffer'
import { SchedulePlace } from '../components/SchedulePlace'
import { TimelineEntry } from '../components/TimelineEntry'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { count, t } from '../i18n'
import { BOOKING_KIND_ICON, bookingKindLabel } from '../i18n/labels'
import {
  formatCalendarDate,
  formatDayKey,
  formatTimeInZone,
  shiftZonedDays,
  shortZoneName,
} from '../lib/datetime'
import { attachmentsOf, buildTimeline, nextBooking } from '../lib/itinerary'

export function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const applied = (useLocation().state as { applied?: number } | null)?.applied ?? null
  const [adding, setAdding] = useState(false)
  const updatePlace = useUpdatePlace(tripId ?? '')

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

  const notesByDay = new Map(data.day_notes.map((note) => [note.day, note]))

  /** Nudge a planned visit onto the previous or next day. */
  function movePlace(item: Place, days: number) {
    if (!item.planned_start_at || !item.planned_tz) return
    updatePlace.mutate({
      id: item.id,
      // Whole days on the local clock, not a flat 24 hours: on the night
      // the clocks change that would move the visit by an hour.
      planned_start_at: shiftZonedDays(item.planned_start_at, item.planned_tz, days),
    })
  }

  const nothingAtAll =
    timeline.days.length === 0 &&
    timeline.undatedBookings.length === 0 &&
    timeline.unscheduledPlaces.length === 0

  const dates =
    trip.start_date && trip.end_date
      ? t('trips.dates', {
          from: formatCalendarDate(trip.start_date),
          to: formatCalendarDate(trip.end_date),
        })
      : undefined

  return (
    <>
      <AppBar
        title={trip.title}
        subtitle={dates}
        back="/trips"
        action={
          <Link className="appbar__button" to={`/trips/${tripId}/search`} aria-label={t('search.title')}>
            <Icon name="search" size={20} />
          </Link>
        }
      />
      <main className="page stack">
      {/* Said here, where the result is, rather than on the screen you
          pressed the button on. The planner used to report back to
          itself: the preview vanished and a line appeared under the
          button saying how many visits it had applied — which is a
          receipt handed over on the way out of a room you are leaving. */}
      {applied !== null && (
        <p className="hint" role="status">{count('trip_plan.applied', applied)}</p>
      )}

      <OfflineReminder bundle={data} tripId={tripId} />

      {next?.start_at && (
        <section className="card next">
          <span className="next__label">{t('timeline.next')}</span>
          <span className="next__title">
            <Icon name={BOOKING_KIND_ICON[next.kind]} size={17} /> {next.title}
          </span>
          <span className="muted">
            {formatDayKey(next.start_at.slice(0, 10))} ·{' '}
            {formatTimeInZone(next.start_at, next.start_tz ?? trip.primary_tz)}{' '}
            {showZone && shortZoneName(next.start_tz ?? trip.primary_tz)}
          </span>
        </section>
      )}

      {adding && (
        <BookingForm
          tripId={tripId}
          defaultZone={trip.primary_tz}
          stops={data.stops}
          onDone={() => setAdding(false)}
        />
      )}

      <TourOffer />

      <FirstSteps bundle={data} tripId={tripId} />

      {/* The spine of the trip: the cities and when you are in them.
          Everything else hangs off these — which day belongs to which
          city, which time zone a booking lands in, where to look for
          places. It was a screen called "Tappe", row two of twelve behind
          a tab called "Altro". */}
      <Link className="spine" to={`/trips/${tripId}/stops`}>
        {data.stops.length === 0 ? (
          <span className="spine__empty">{t('spine.none')}</span>
        ) : (
          data.stops.map((stop) => (
            <span key={stop.id} className="spine__stop">
              <b>{stop.name}</b>
              {stop.arrive_date && (
                <span className="muted">
                  {' '}
                  {formatCalendarDate(stop.arrive_date)}
                  {stop.depart_date && ` → ${formatCalendarDate(stop.depart_date)}`}
                </span>
              )}
            </span>
          ))
        )}
        <Icon name="forward" size={15} />
      </Link>

      {/* The one thing the whole planner exists for, and it is a button
          rather than a hint that appears when the conditions are right.
          It used to be row one of twelve behind a tab called "Altro",
          and on this screen it showed up only once you already had
          places waiting — so the person with nothing, who needs it most,
          was the one person never offered it. */}
      <Link className="button button--wide" to={`/trips/${tripId}/plan`}>
        <span>{t('trip_plan.title')}</span>
        <small>
          {timeline.unscheduledPlaces.length > 0
            ? count('trip_plan.waiting', timeline.unscheduledPlaces.length)
            : t('trip_plan.willLook')}
        </small>
      </Link>

      {/* Not while the first steps are up: "add a booking" is not the next
          thing to do, and saying so directly under a numbered list that
          says otherwise is how a screen stops being trusted. */}
      {nothingAtAll && !startingOut(data) && <p className="empty">{t('timeline.empty')}</p>}

      {timeline.days.map((day) => (
        <section key={day.key} className="day">
          <h2 className="day__header">
            <span className="day__number">{t('timeline.day', { n: day.number })}</span>
            <span className="day__date">{formatDayKey(day.key)}</span>
            {day.stop && <span className="day__stop">{day.stop.name}</span>}
            {/* Only where there is something to reorder. On a fortnight
                mostly still to plan this was a chip on every day, wrapping
                onto a line of its own on a narrow phone — and doing
                nothing, because filling an empty day is the whole-trip
                planner's job and it is offered at the top. */}
            {day.entries.length > 0 && (
              <OptimizeDay bundle={data} day={day} tripId={tripId} />
            )}
          </h2>

          {/* An empty day is one quiet line. It used to be three controls
              and a sentence — about two hundred pixels — repeated down
              every unplanned day of the trip, which on fifteen days is
              three thousand pixels of nothing. The note editor is still
              there, one tap away, and appears at once if a note exists. */}
          {(day.entries.length > 0 || notesByDay.get(day.key)) && (
            <DayNoteEditor tripId={tripId} day={day.key} note={notesByDay.get(day.key)} />
          )}
          {/* Said before the day is planned, because it decides what goes
              in it. Under the heading and above the entries: it is a
              property of the day, like its city. */}
          <DayThemePicker tripId={tripId} day={day.key} note={notesByDay.get(day.key)} />

          {day.entries.length === 0 ? (
            notesByDay.get(day.key) ? (
              <p className="day__empty">{t('timeline.emptyDay')}</p>
            ) : (
              <EmptyDay tripId={tripId} day={day.key} />
            )
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
                  onMoveDays={movePlace}
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
                    <Icon name={BOOKING_KIND_ICON[item.kind]} size={16} /> {item.title}
                  </span>
                  <span className="doc__meta">{bookingKindLabel(item.kind)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      </main>
      {/* No floating button. The round green circle on this screen added
          a *booking*, which is the control a person reaches for when they
          want an itinerary made — and got a form asking for a flight
          number. Bookings have a tab of their own now. */}
    </>
  )
}
