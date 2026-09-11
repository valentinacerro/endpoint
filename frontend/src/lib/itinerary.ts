/**
 * Turning a trip bundle into the day-by-day plan.
 *
 * Pure functions over plain data: no fetching, no React. That is what makes
 * the awkward parts — which day a red-eye flight belongs to, whether an
 * afternoon actually has room for one more temple — testable rather than
 * something you discover on the road.
 */

import type { Booking, BookingKind, Place, Stop, TripBundle } from '../api/types'
import { dayKeyInZone, eachDay, type CalendarDate } from './datetime'

/**
 * Bookings that span days rather than occupying an afternoon.
 *
 * A hotel runs from check-in to check-out, so counting it as busy time would
 * mark every single activity of the next three days as overlapping it. These
 * appear on the timeline as markers and take up no room in the day.
 */
const SPANS_DAYS: ReadonlySet<BookingKind> = new Set(['hotel', 'car_rental'])

/** Ignore slivers: a nine-minute gap is not an opportunity. */
const MEANINGFUL_GAP_MINUTES = 30

const MINUTE_MS = 60_000

export type DayEntry =
  | {
      type: 'booking'
      id: string
      startAt: string
      /** When it stops occupying the day; null for things that just span it. */
      busyUntil: string | null
      zone: string
      booking: Booking
    }
  | {
      type: 'place'
      id: string
      startAt: string
      busyUntil: string
      zone: string
      place: Place
    }

export interface PlacedEntry {
  entry: DayEntry
  /** Free minutes before this starts, when there are enough to matter. */
  gapMinutes: number | null
  /** This begins before the previous one has finished. */
  overlaps: boolean
}

export interface Day {
  key: CalendarDate
  /** 1-based, as shown to the user: "Day 3". */
  number: number
  entries: PlacedEntry[]
  /** The stop you are based at that day, when it can be worked out. */
  stop: Stop | null
}

export interface Timeline {
  days: Day[]
  /** Real, but not yet placeable on the calendar. */
  undatedBookings: Booking[]
  unscheduledPlaces: Place[]
}

function addMinutes(instant: string, minutes: number): string {
  return new Date(new Date(instant).getTime() + minutes * MINUTE_MS).toISOString()
}

function toEntry(booking: Booking, fallbackZone: string): DayEntry | null {
  if (!booking.start_at) return null
  return {
    type: 'booking',
    id: booking.id,
    startAt: booking.start_at,
    busyUntil: SPANS_DAYS.has(booking.kind) ? null : booking.end_at,
    // A booking cannot store a time without its zone — the database refuses
    // it — so the fallback only applies to one with no time at all.
    zone: booking.start_tz ?? fallbackZone,
    booking,
  }
}

function placeEntry(place: Place, fallbackZone: string): DayEntry | null {
  if (!place.planned_start_at) return null
  return {
    type: 'place',
    id: place.id,
    startAt: place.planned_start_at,
    busyUntil: addMinutes(place.planned_start_at, place.visit_minutes),
    zone: place.planned_tz ?? fallbackZone,
    place,
  }
}

/** Every stop whose dates cover a day. Usually one; on a move, two. */
export function stopsOn(stops: readonly Stop[], day: CalendarDate): Stop[] {
  return stops.filter((stop) => {
    const from = stop.arrive_date
    const to = stop.depart_date ?? stop.arrive_date
    return Boolean(from && to && from <= day && day <= to)
  })
}

export type DayOwnership =
  | { stop: Stop; why: 'only_stop' | 'day_trip' | 'arriving' }
  | { stop: null; why: 'no_stop' | 'overlapping_stops' }

/**
 * Which city a day belongs to, and on what grounds.
 *
 * This used to return whichever covering stop came first in the list,
 * which is wrong in the two cases where more than one covers a day, and
 * both of them are ordinary.
 *
 * On a handover — Tokyo departs on the 16th, Kyoto arrives on the 16th —
 * first-match handed the day to Tokyo, the city you are leaving. You
 * sleep in Kyoto, so Kyoto owns it. That mistake reached further than
 * the day header: `Weather.tsx` labels a visit with `day.stop.id`, so a
 * Kyoto temple on the 16th was tagged as Tokyo, and the rain rebalancer
 * was then free to swap it with a Tokyo place on another day — the exact
 * cross-city move its own comment forbids.
 *
 * On a day trip — Hakone, the 14th to the 15th, inside a Tokyo leg that
 * runs the 12th to the 18th — the shorter span is the more specific
 * statement about where you are, so it wins.
 *
 * Anything else is a data problem and is named rather than guessed at.
 */
export function baseStopOn(stops: readonly Stop[], day: CalendarDate): DayOwnership {
  const covering = stopsOn(stops, day)

  if (covering.length === 0) return { stop: null, why: 'no_stop' }
  if (covering.length === 1) return { stop: covering[0], why: 'only_stop' }

  if (covering.length === 2) {
    const [first, second] = covering
    const inner = strictlyInside(first, second) ?? strictlyInside(second, first)
    if (inner) return { stop: inner, why: 'day_trip' }

    // A handover: one leaves today, the other arrives today.
    const leaving = covering.filter((stop) => (stop.depart_date ?? stop.arrive_date) === day)
    const arriving = covering.filter((stop) => stop.arrive_date === day)
    if (leaving.length === 1 && arriving.length === 1 && leaving[0] !== arriving[0]) {
      return { stop: arriving[0], why: 'arriving' }
    }
  }

  return { stop: null, why: 'overlapping_stops' }
}

/** True when `inner`'s span sits entirely within `outer`'s, and is shorter. */
function strictlyInside(inner: Stop, outer: Stop): Stop | null {
  const innerFrom = inner.arrive_date
  const innerTo = inner.depart_date ?? inner.arrive_date
  const outerFrom = outer.arrive_date
  const outerTo = outer.depart_date ?? outer.arrive_date
  if (!innerFrom || !innerTo || !outerFrom || !outerTo) return null

  const contained = outerFrom <= innerFrom && innerTo <= outerTo
  const shorter = innerFrom > outerFrom || innerTo < outerTo
  return contained && shorter ? inner : null
}

/** Work out the free time and clashes running down a single day. */
function place(entries: DayEntry[]): PlacedEntry[] {
  let busyUntil: string | null = null

  return entries.map((entry) => {
    let gapMinutes: number | null = null
    let overlaps = false

    if (busyUntil) {
      const minutes = (new Date(entry.startAt).getTime() - new Date(busyUntil).getTime()) / MINUTE_MS
      if (minutes < 0) overlaps = true
      else if (minutes >= MEANINGFUL_GAP_MINUTES) gapMinutes = Math.round(minutes)
    }

    // Carry the later end forward, so a long visit still shields the ones
    // that follow instead of being forgotten by the next comparison.
    if (entry.busyUntil && (!busyUntil || entry.busyUntil > busyUntil)) {
      busyUntil = entry.busyUntil
    }

    return { entry, gapMinutes, overlaps }
  })
}

export function buildTimeline(bundle: TripBundle): Timeline {
  const fallbackZone = bundle.trip.primary_tz
  const undatedBookings: Booking[] = []
  const unscheduledPlaces: Place[] = []
  const byDay = new Map<CalendarDate, DayEntry[]>()

  const add = (entry: DayEntry) => {
    const key = dayKeyInZone(entry.startAt, entry.zone)
    byDay.set(key, [...(byDay.get(key) ?? []), entry])
  }

  for (const booking of bundle.bookings) {
    const entry = toEntry(booking, fallbackZone)
    if (entry) add(entry)
    else undatedBookings.push(booking)
  }

  for (const item of bundle.places) {
    const entry = placeEntry(item, fallbackZone)
    if (entry) add(entry)
    else unscheduledPlaces.push(item)
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
    stop: baseStopOn(bundle.stops, key).stop,
    entries: place(
      // Both are instants in UTC, so a plain string comparison sorts them
      // chronologically regardless of the zones they display in.
      (byDay.get(key) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    ),
  }))

  return { days, undatedBookings, unscheduledPlaces }
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
