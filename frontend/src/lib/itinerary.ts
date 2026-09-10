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

/** The stop covering a given day, if its dates say so. */
function stopForDay(stops: Stop[], day: CalendarDate): Stop | null {
  for (const stop of stops) {
    const from = stop.arrive_date
    const to = stop.depart_date ?? stop.arrive_date
    if (from && to && from <= day && day <= to) return stop
  }
  return null
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
    stop: stopForDay(bundle.stops, key),
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
