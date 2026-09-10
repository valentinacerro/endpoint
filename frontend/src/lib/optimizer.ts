/**
 * Arranging one day.
 *
 * Given the things that cannot move — a flight, a booked museum slot — and
 * the things that can, this works out an order that stops the day
 * zig-zagging and assigns each visit a time that fits.
 *
 * It runs in the browser, not on the server. That is deliberate: the moment
 * you most need to replan is the moment you have missed a train and are
 * standing in a station with no signal, and a server that takes a minute to
 * wake is no use there. It also means no dependency: an exact solver would
 * be a hundred megabytes to compute an optimum over travel times that are
 * themselves estimates, which is precision spent in the wrong place.
 */

import { zonedInputToInstant, type CalendarDate } from './datetime'
import { travelMinutes, type Point } from './geo'

const MINUTE_MS = 60_000

export type Priority = 'must_see' | 'high' | 'normal' | 'low'

const PRIORITY_ORDER: Record<Priority, number> = {
  must_see: 0,
  high: 1,
  normal: 2,
  low: 3,
}

/** Opening hours as stored: weekday key to a list of [open, close] pairs. */
export type OpeningHours = Record<string, [string, string][] | undefined>

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export interface Anchor {
  id: string
  /** Cannot be moved: a flight, a timed entry, a check-in. */
  startAt: string
  endAt: string | null
  point: Point | null
  label: string
}

export interface Candidate {
  id: string
  point: Point
  visitMinutes: number
  priority: Priority
  openingHours: OpeningHours
  label: string
}

export interface PlanOptions {
  day: CalendarDate
  zone: string
  /** When you are willing to start and to stop, on the local clock. */
  dayStart?: string
  dayEnd?: string
}

export interface PlannedVisit {
  id: string
  startAt: string
  travelMinutesBefore: number
  /** True when we scheduled it without knowing whether it is open. */
  hoursUnknown: boolean
}

export interface DroppedVisit {
  id: string
  reason: 'closed' | 'no_room'
}

export interface DayPlan {
  visits: PlannedVisit[]
  dropped: DroppedVisit[]
  travelMinutes: number
}

// --- Opening hours -----------------------------------------------------

function weekdayKey(day: CalendarDate): string {
  const [year, month, date] = day.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]
}

function minutesOfDay(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

export type Openness =
  | { kind: 'unknown' }
  | { kind: 'closed' }
  | { kind: 'open'; windows: [number, number][] }

/**
 * What we know about a place being open on a given day.
 *
 * Unknown is its own answer, distinct from closed. Almost nothing imported
 * from Maps carries opening hours, and treating silence as "shut" would
 * empty the itinerary. Treating it as "open" without saying so would be
 * worse — hence the third state, which the caller surfaces.
 */
export function opennessOn(hours: OpeningHours, day: CalendarDate): Openness {
  const key = weekdayKey(day)
  if (!(key in hours)) return { kind: 'unknown' }
  const ranges = hours[key]
  if (!ranges || ranges.length === 0) return { kind: 'closed' }
  return {
    kind: 'open',
    windows: ranges.map(([from, to]) => [minutesOfDay(from), minutesOfDay(to)]),
  }
}

/** The earliest start at or after `from` that fits a whole visit. */
function earliestStart(openness: Openness, from: number, visitMinutes: number): number | null {
  if (openness.kind === 'closed') return null
  if (openness.kind === 'unknown') return from
  for (const [opens, closes] of openness.windows) {
    const start = Math.max(from, opens)
    if (start + visitMinutes <= closes) return start
  }
  return null
}

// --- Ordering ----------------------------------------------------------

/** Nearest neighbour from a starting point: a decent first guess. */
function nearestNeighbour(items: Candidate[], from: Point | null): Candidate[] {
  const remaining = [...items]
  const ordered: Candidate[] = []
  let current = from

  while (remaining.length > 0) {
    let bestIndex = 0
    if (current) {
      let bestCost = Infinity
      remaining.forEach((item, index) => {
        const cost = travelMinutes(current!, item.point)
        if (cost < bestCost) {
          bestCost = cost
          bestIndex = index
        }
      })
    }
    const [next] = remaining.splice(bestIndex, 1)
    ordered.push(next)
    current = next.point
  }
  return ordered
}

function legCost(from: Point | null, to: Point): number {
  return from ? travelMinutes(from, to) : 0
}

function tourCost(items: Candidate[], from: Point | null): number {
  let total = 0
  let previous = from
  for (const item of items) {
    total += legCost(previous, item.point)
    previous = item.point
  }
  return total
}

/**
 * 2-opt: repeatedly reverse a segment when doing so shortens the route.
 *
 * Nearest neighbour alone produces exactly the zig-zag this feature exists
 * to remove — it commits to a cheap first hop and pays for it later. 2-opt
 * untangles those crossings, and at a dozen stops it is instant.
 */
export function twoOpt(items: Candidate[], from: Point | null): Candidate[] {
  if (items.length < 3) return items
  let best = [...items]
  let bestCost = tourCost(best, from)
  let improved = true
  // Bounded so a pathological input cannot spin: it converges long before.
  let rounds = 0

  while (improved && rounds < 50) {
    improved = false
    rounds += 1
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ]
        const cost = tourCost(candidate, from)
        if (cost < bestCost - 0.0001) {
          best = candidate
          bestCost = cost
          improved = true
        }
      }
    }
  }
  return best
}

// --- Planning ----------------------------------------------------------

function instantAt(day: CalendarDate, minutes: number, zone: string): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return zonedInputToInstant(`${day}T${hh}:${mm}`, zone)
}

function localMinutes(instant: string, day: CalendarDate, zone: string): number {
  const base = new Date(instantAt(day, 0, zone)).getTime()
  return Math.round((new Date(instant).getTime() - base) / MINUTE_MS)
}

/**
 * Build a plan for one day.
 *
 * Anchors stay exactly where they are; candidates are ordered to minimise
 * travel and then poured into the gaps between them, highest priority
 * first. Anything that will not fit is returned with a reason rather than
 * silently discarded.
 */
export function planDay(
  anchors: Anchor[],
  candidates: Candidate[],
  options: PlanOptions,
): DayPlan {
  const { day, zone, dayStart = '09:00', dayEnd = '21:00' } = options
  const openAt = minutesOfDay(dayStart)
  const closeAt = minutesOfDay(dayEnd)

  const fixed = [...anchors]
    .filter((anchor) => anchor.startAt)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((anchor) => ({
      ...anchor,
      from: localMinutes(anchor.startAt, day, zone),
      to: anchor.endAt ? localMinutes(anchor.endAt, day, zone) : localMinutes(anchor.startAt, day, zone),
    }))

  // Highest priority first, so that when the day overflows it is the
  // optional things that fall off rather than whatever happened to be last.
  const wanted = [...candidates].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  )

  const startPoint = fixed.find((anchor) => anchor.point)?.point ?? null
  const ordered = twoOpt(nearestNeighbour(wanted, startPoint), startPoint)

  // Free windows: before the first anchor, between anchors, after the last.
  const windows: [number, number][] = []
  let cursor = openAt
  for (const anchor of fixed) {
    if (anchor.from > cursor) windows.push([cursor, anchor.from])
    cursor = Math.max(cursor, anchor.to)
  }
  if (cursor < closeAt) windows.push([cursor, closeAt])

  const visits: PlannedVisit[] = []
  const dropped: DroppedVisit[] = []
  let travel = 0

  // Where we are, and when, as the day is filled in.
  const state = windows.map(([from, to], index) => ({
    index,
    at: from,
    until: to,
    where: index === 0 ? startPoint : (fixed[index - 1]?.point ?? null),
  }))

  const byPriority = ordered
    .slice()
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

  for (const candidate of byPriority) {
    const openness = opennessOn(candidate.openingHours, day)
    if (openness.kind === 'closed') {
      dropped.push({ id: candidate.id, reason: 'closed' })
      continue
    }

    let placed = false
    for (const window of state) {
      const move = legCost(window.where, candidate.point)
      const arrival = window.at + move
      const start = earliestStart(openness, arrival, candidate.visitMinutes)
      if (start === null || start + candidate.visitMinutes > window.until) continue

      visits.push({
        id: candidate.id,
        startAt: instantAt(day, start, zone),
        travelMinutesBefore: move,
        hoursUnknown: openness.kind === 'unknown',
      })
      travel += move
      window.at = start + candidate.visitMinutes
      window.where = candidate.point
      placed = true
      break
    }

    if (!placed) dropped.push({ id: candidate.id, reason: 'no_room' })
  }

  visits.sort((a, b) => a.startAt.localeCompare(b.startAt))
  return { visits, dropped, travelMinutes: travel }
}
