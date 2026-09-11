/**
 * The travel diary, day by day.
 *
 * The interesting part is not storing text. It is that you write better
 * when reminded what you did — so each day carries a short line of what
 * was on the itinerary, assembled from data the app already has. Nobody
 * remembers on Thursday what the Monday temple was called.
 */

import type { DiaryEntry, TripBundle } from '../api/types'

import { dayKeyInZone, type CalendarDate } from './datetime'
import { buildTimeline } from './itinerary'

/** Enough to jog a memory; more would be the itinerary over again. */
const REMINDERS = 4

export interface DiaryDay {
  key: CalendarDate
  /** 1-based, as shown: "Day 3". */
  number: number
  stopName: string | null
  entry: DiaryEntry | undefined
  /** What the itinerary says you did, as a prompt while writing. */
  happened: string[]
  /** How many more there were than the prompt shows. */
  more: number
  /**
   * Whether the day has happened yet.
   *
   * Today counts: you write in the evening, not at midnight. Future days
   * appear too — a diary that hides the rest of the trip makes it hard to
   * tell "not written" from "not yet".
   */
  isPast: boolean
}

export function diaryDays(bundle: TripBundle, now: Date = new Date()): DiaryDay[] {
  const timeline = buildTimeline(bundle)
  const byDay = new Map(bundle.diary.map((entry) => [entry.day, entry]))
  const today = dayKeyInZone(now.toISOString(), bundle.trip.primary_tz)

  return timeline.days.map((day) => {
    const names = day.entries.map(({ entry }) =>
      entry.type === 'booking' ? entry.booking.title : entry.place.name,
    )
    return {
      key: day.key,
      number: day.number,
      stopName: day.stop?.name ?? null,
      entry: byDay.get(day.key),
      happened: names.slice(0, REMINDERS),
      more: Math.max(0, names.length - REMINDERS),
      // String comparison, because both are YYYY-MM-DD in the same zone.
      isPast: day.key <= today,
    }
  })
}

export interface Written {
  written: number
  /** Only days that have happened: the rest are not owed anything yet. */
  writable: number
}

/**
 * How much of the diary is done.
 *
 * Counting the whole trip would make a progress line that starts at
 * "1 of 15" on the first evening and reads as failure for a fortnight.
 */
export function written(days: readonly DiaryDay[]): Written {
  const past = days.filter((day) => day.isPast)
  return {
    written: past.filter((day) => day.entry).length,
    writable: past.length,
  }
}

/** The first past day with nothing written: where the screen should open. */
export function firstUnwritten(days: readonly DiaryDay[]): CalendarDate | null {
  return days.find((day) => day.isPast && !day.entry)?.key ?? null
}
