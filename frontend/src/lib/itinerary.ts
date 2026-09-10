/**
 * Turning a trip bundle into the day-by-day timeline.
 *
 * Pure functions over plain data: no fetching, no React. That is what makes
 * the awkward parts — which day does a red-eye flight belong to, what about
 * a hotel with no dates yet — testable rather than something you discover on
 * the road.
 */

import type { Booking, Stop, TripBundle } from '../api/types'
import { dayKeyInZone, eachDay, type CalendarDate } from './datetime'

export interface DayEntry {
  booking: Booking
  /** The zone this row should be read in — the event's own, never the device's. */
  zone: string
}

export interface Day {
  key: CalendarDate
  /** 1-based, as shown to the user: "Day 3". */
  number: number
  entries: DayEntry[]
  /** The stop you are based at that day, when it can be worked out. */
  stop: Stop | null
}

export interface Timeline {
  days: Day[]
  /** Bookings with no date yet: real, but not placeable on the calendar. */
  undated: Booking[]
}

/**
 * The zone a booking's start should be read in.
 *
 * Falls back to the trip's own zone. A booking cannot store `start_at`
 * without `start_tz` — the database refuses it — so the fallback only ever
 * applies to a booking with no time at all.
 */
function zoneFor(booking: Booking, fallback: string): string {
  return booking.start_tz ?? fallback
}

/** The stop covering a given day, if its dates say so. */
function stopForDay(stops: Stop[], day: CalendarDate): Stop | null {
  for (const stop of stops) {
    const from = stop.arrive_date
    const to = stop.depart_date ?? stop.arrive_date
    if (from && to && from <= day && day <= to) return stop
  }
  return null
}

export function buildTimeline(bundle: TripBundle): Timeline {
  const fallbackZone = bundle.trip.primary_tz
  const undated: Booking[] = []
  const byDay = new Map<CalendarDate, DayEntry[]>()

  for (const booking of bundle.bookings) {
    if (!booking.start_at) {
      undated.push(booking)
      continue
    }
    const zone = zoneFor(booking, fallbackZone)
    const key = dayKeyInZone(booking.start_at, zone)
    const entries = byDay.get(key) ?? []
    entries.push({ booking, zone })
    byDay.set(key, entries)
  }

  // The days of the trip itself, so a day with nothing planned still appears
  // instead of silently collapsing — an empty Thursday is information.
  const spanned =
    bundle.trip.start_date && bundle.trip.end_date
      ? eachDay(bundle.trip.start_date, bundle.trip.end_date)
      : []

  // Anything booked outside the declared dates still deserves a row: the
  // outbound flight often leaves the evening before the trip "starts".
  const keys = [...new Set([...spanned, ...byDay.keys()])].sort()

  const days = keys.map((key, index) => ({
    key,
    number: index + 1,
    stop: stopForDay(bundle.stops, key),
    entries: (byDay.get(key) ?? []).sort((a, b) =>
      // Both are instants in UTC, so a plain string comparison is a correct
      // chronological sort regardless of the zones they display in.
      (a.booking.start_at ?? '').localeCompare(b.booking.start_at ?? ''),
    ),
  }))

  return { days, undated }
}

/** Attachments belonging to one booking. */
export function attachmentsOf(bundle: TripBundle, bookingId: string) {
  return bundle.attachments.filter((item) => item.booking_id === bookingId)
}

/** The next thing happening, for the "what now" line at the top. */
export function nextBooking(bundle: TripBundle, now: Date = new Date()): Booking | null {
  const iso = now.toISOString()
  const upcoming = bundle.bookings
    .filter((booking) => booking.start_at && booking.start_at >= iso)
    .sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''))
  return upcoming[0] ?? null
}
