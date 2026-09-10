/**
 * Every date and time in the app is formatted here, and nowhere else.
 *
 * The rule this file exists to enforce: a travel event is *a wall-clock time
 * at a place*, not merely an instant. Check-in at 15:00 in Tokyo must read
 * 15:00 whether you are in Rome in February or in Shinjuku in April. Render
 * an instant in the device's zone instead and, while planning from Italy,
 * that check-in shows as 08:00 — correct, and useless.
 *
 * So the backend stores the instant plus the IANA zone it belongs to, and
 * everything here takes that zone explicitly. There is deliberately no
 * function that formats an instant without being told which zone to use.
 */

import { TZDate } from '@date-fns/tz'

/** Values the backend sends as `DATE`: a calendar day, with no time and no zone. */
export type CalendarDate = string // "2026-04-11"
/** Values the backend sends as `TIMESTAMPTZ`: an instant, always UTC. */
export type Instant = string // "2026-04-12T06:00:00Z"

const DEFAULT_LOCALE = 'it'

// Constructing an Intl.DateTimeFormat is expensive and a timeline builds
// hundreds, so they are reused.
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let found = formatters.get(key)
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options)
    formatters.set(key, found)
  }
  return found
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * The calendar day an instant falls on, *in a given zone*.
 *
 * This is what the itinerary groups by. Using the device's zone instead
 * would make "Day 3" slide onto "Day 2" the moment you cross the date line —
 * which is exactly when you are least able to cope with a confusing screen.
 */
export function dayKeyInZone(instant: Instant, timeZone: string): CalendarDate {
  // en-CA renders as YYYY-MM-DD, which sorts correctly as a plain string.
  return formatter('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant))
}

export function formatTimeInZone(
  instant: Instant,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return formatter(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(instant),
  )
}

export function formatDayInZone(
  instant: Instant,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return formatter(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(instant))
}

/**
 * Format a calendar day that has no time and no zone.
 *
 * `new Date("2026-04-11")` is parsed as midnight **UTC**, so west of
 * Greenwich it renders as the 10th. Every date-only field in this app —
 * trip dates, stop arrival, expense dates — would be off by one. Parsing the
 * parts by hand and formatting in UTC avoids the whole class of bug.
 */
export function formatCalendarDate(
  date: CalendarDate,
  locale: string = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string {
  const [year, month, day] = date.split('-').map(Number)
  const asUtc = new Date(Date.UTC(year, month - 1, day))
  return formatter(locale, { ...options, timeZone: 'UTC' }).format(asUtc)
}

export function formatCalendarDateLong(
  date: CalendarDate,
  locale: string = DEFAULT_LOCALE,
): string {
  return formatCalendarDate(date, locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** The day, formatted from a `dayKeyInZone` result. */
export function formatDayKey(key: CalendarDate, locale: string = DEFAULT_LOCALE): string {
  return formatCalendarDate(key, locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Every calendar day from `from` to `to`, inclusive. */
export function eachDay(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const parse = (value: CalendarDate) => {
    const [year, month, day] = value.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  const days: CalendarDate[] = []
  for (let time = parse(from); time <= parse(to); time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10))
  }
  return days
}

// A type alias rather than an interface: only aliases get an implicit index
// signature, which is what lets this be passed straight to `t()` as
// interpolation parameters.
export type HomeTimeHint = {
  time: string
  zone: string
}

/**
 * The same moment on the clock you are actually carrying, when that differs.
 *
 * Shown only for events within the next couple of days: on a trip to Japan
 * *every* time differs from the Italian clock while you are still at home,
 * so showing it always would be noise on every single row. It earns its
 * place on the flight you are about to catch, not on a museum in twelve
 * days' time.
 *
 * Returns null when there is nothing worth saying — same zone, or too far
 * off, or the same wall-clock reading anyway.
 */
export function homeTimeHint(
  instant: Instant,
  eventZone: string,
  options: { now?: Date; deviceZone?: string; withinHours?: number; locale?: string } = {},
): HomeTimeHint | null {
  const {
    now = new Date(),
    deviceZone = deviceTimeZone(),
    withinHours = 48,
    locale = DEFAULT_LOCALE,
  } = options

  if (deviceZone === eventZone) return null

  const when = new Date(instant)
  const hoursAway = (when.getTime() - now.getTime()) / (60 * 60 * 1000)
  if (hoursAway < 0 || hoursAway > withinHours) return null

  const local = formatTimeInZone(instant, deviceZone, locale)
  if (local === formatTimeInZone(instant, eventZone, locale)) return null

  return { time: local, zone: deviceZone }
}

/**
 * When something last happened, on the reader's own clock.
 *
 * The one place in this file that deliberately uses the device zone: "last
 * updated" is about you, not about a place. Everywhere else doing that would
 * be the bug.
 */
export function formatSyncTime(
  timestamp: number,
  locale: string = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  const when = new Date(timestamp)
  const sameDay = when.toDateString() === now.toDateString()
  return formatter(locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
  }).format(when)
}

/** Whole days from today to a calendar date; negative once it has passed. */
export function daysUntil(date: CalendarDate, now: Date = new Date()): number {
  const [year, month, day] = date.split('-').map(Number)
  const target = Date.UTC(year, month - 1, day)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / DAY_MS)
}

/** "2h 30min", "45min" — a span of time, not a moment. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}min`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}min`
}

/** "Tokyo" out of "Asia/Tokyo", for a compact label. */
export function shortZoneName(timeZone: string): string {
  return timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone
}

// --- Forms ---
//
// `<input type="datetime-local">` deals in bare wall-clock strings with no
// zone at all. Reading one as the device's local time is the single easiest
// way to ruin this app: typing "15:00" for a Tokyo check-in while sitting in
// Rome would store 13:00 UTC, and the hotel would show 22:00.

/** A `datetime-local` value, read as wall-clock time in a specific zone. */
export function zonedInputToInstant(local: string, timeZone: string): string {
  const [datePart, timePart] = local.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return new TZDate(year, month - 1, day, hour, minute, 0, 0, timeZone).toISOString()
}

/** The inverse: an instant, as the `datetime-local` value for that zone. */
export function instantToZonedInput(instant: Instant, timeZone: string): string {
  const parts = formatter('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // h23 rather than hour12:false: some ICU versions render midnight as
    // "24:00" under the latter, which no date input will accept.
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '00'

  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
