/**
 * Where you are in the trip, right now.
 *
 * The home screen is the only screen that has to work out for itself what
 * it should be showing — every other one is told by the URL. This module
 * makes that decision, and nothing else: which trip matters today, how
 * far away it is, and what is still unfinished before you leave.
 *
 * Pure, because it is the part worth testing. The screen that uses it is
 * just markup.
 *
 * "Today" is read in each trip's OWN zone, not the device's. On the
 * morning of the third day in Tokyo the app should say "Day 3" whether
 * or not Rome has got there yet — the trip's calendar is the one you are
 * living in.
 */

import type { Attachment, Booking, Expense, Trip, TripBundle } from '../api/types'
import { summarise } from './budget'
import { dayKeyInZone, daysBetween, type CalendarDate } from './datetime'
import { progress, type Progress } from './packing'

export type Moment =
  /** No trip has a date, or there are no trips at all. */
  | { phase: 'none' }
  /** Trips exist but none of them says when. */
  | { phase: 'undated'; trip: Trip }
  | { phase: 'before'; trip: Trip; today: CalendarDate; daysAway: number }
  | {
      phase: 'during'
      trip: Trip
      today: CalendarDate
      /** 1-based, as it is spoken: "day 3 of 14". */
      day: number
      total: number
    }
  | { phase: 'after'; trip: Trip; today: CalendarDate; daysSince: number }

/** The last day a trip occupies: its end, or its start when it has none. */
function lastDay(trip: Trip): CalendarDate | null {
  return (trip.end_date ?? trip.start_date) as CalendarDate | null
}

/**
 * Which trip the app should open on.
 *
 * A trip happening now always wins. Otherwise the soonest one still to
 * come, because that is the one being packed for. Only when nothing is
 * ahead does the most recently finished one appear — and it appears to
 * be looked back at, not worked on.
 */
export function chooseMoment(trips: readonly Trip[], now: Date = new Date()): Moment {
  const instant = now.toISOString()
  const dated = trips.filter((trip) => trip.start_date)

  if (dated.length === 0) {
    return trips.length > 0 ? { phase: 'undated', trip: trips[0] } : { phase: 'none' }
  }

  let running: { trip: Trip; today: CalendarDate; day: number; total: number } | null = null
  let next: { trip: Trip; today: CalendarDate; daysAway: number } | null = null
  let previous: { trip: Trip; today: CalendarDate; daysSince: number } | null = null

  for (const trip of dated) {
    const today = dayKeyInZone(instant, trip.primary_tz)
    const start = trip.start_date as CalendarDate
    const end = lastDay(trip) as CalendarDate

    if (start <= today && today <= end) {
      const candidate = {
        trip,
        today,
        day: daysBetween(start, today) + 1,
        total: daysBetween(start, end) + 1,
      }
      // Two trips overlapping today is a mistake in the data rather than
      // a case to design for; the one that started first is the one you
      // are on.
      if (!running || start < (running.trip.start_date as CalendarDate)) running = candidate
    } else if (start > today) {
      const candidate = { trip, today, daysAway: daysBetween(today, start) }
      if (!next || candidate.daysAway < next.daysAway) next = candidate
    } else {
      const candidate = { trip, today, daysSince: daysBetween(end, today) }
      if (!previous || candidate.daysSince < previous.daysSince) previous = candidate
    }
  }

  if (running) return { phase: 'during', ...running }
  if (next) return { phase: 'before', ...next }
  if (previous) return { phase: 'after', ...previous }
  return { phase: 'none' }
}

export interface Readiness {
  /** Booked but not confirmed. */
  pending: Booking[]
  packing: Progress
  /** Attachments, and how many of them are on the phone rather than the server. */
  documents: { saved: number; total: number }
  /** True when there is genuinely nothing left to do. */
  ready: boolean
}

/**
 * What is still unfinished before leaving.
 *
 * `isSaved` is asked rather than a set of URLs handed in, so the shape of
 * an attachment's URL stays in the one place that already owns it and
 * this module stays clear of the API layer.
 */
export function readiness(
  bundle: TripBundle,
  isSaved: (attachment: Attachment) => boolean,
): Readiness {
  const pending = bundle.bookings.filter((booking) => booking.status === 'pending')
  const packed = progress(bundle.checklist)
  const saved = bundle.attachments.filter(isSaved).length

  return {
    pending,
    packing: packed,
    documents: { saved, total: bundle.attachments.length },
    ready:
      pending.length === 0 &&
      (packed.total === 0 || packed.done === packed.total) &&
      saved === bundle.attachments.length,
  }
}

/** What today has cost so far, in the trip's own currency. */
export function spentOn(bundle: TripBundle, day: CalendarDate): number {
  const todays = bundle.expenses.filter((expense: Expense) => expense.spent_at === day)
  return summarise(todays, bundle.trip).converted
}

/**
 * The stop you are in today, if the trip says.
 *
 * Deliberately not `baseStopOn`: this is for a label, and on a day you
 * travel between two cities naming either one is fine, whereas the
 * planner has to commit. Returning the first match keeps this side of
 * the app out of that argument.
 */
export function stopToday(bundle: TripBundle, day: CalendarDate) {
  return (
    bundle.stops.find(
      (stop) =>
        stop.arrive_date &&
        stop.arrive_date <= day &&
        (stop.depart_date === null || day <= stop.depart_date),
    ) ?? null
  )
}
