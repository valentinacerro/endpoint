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

import {
  dayKeyInZone,
  daysBetween,
  minutesOfDayInZone,
  zonedInputToInstant,
  type CalendarDate,
} from './datetime'
import type { DayTheme, PlaceCategory } from '../api/types'
import { travelMinutes, type Known, type Point } from './geo'
import { THEME_CATEGORIES } from './themes'

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
  /**
   * Time an anchor needs around itself, beyond its own span.
   *
   * A flight is not a thing that starts when it departs: you have to be
   * at the airport. Without this nothing protects check-in, and a
   * booking with no `endAt` occupies zero minutes, so a 19:00 dinner
   * reservation gets a 19:00 temple written straight over it.
   *
   * It is also the only protection that works on transport, because a
   * flight or a train never has coordinates stored — so the exit-leg
   * check is inert on exactly the anchors that matter most.
   */
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
}

export interface Candidate {
  id: string
  point: Point
  visitMinutes: number
  priority: Priority
  openingHours: OpeningHours
  label: string
  /** What kind of place it is, so a themed day can prefer its own kind. */
  category?: PlaceCategory
}

export interface PlanOptions {
  day: CalendarDate
  zone: string
  /** When you are willing to start and to stop, on the local clock. */
  dayStart?: string
  dayEnd?: string
  /**
   * What kind of day you asked for, if you asked.
   *
   * Absent means mixed, which is the honest name for "you have not said"
   * and not a sixth theme anybody chose.
   */
  theme?: DayTheme | null
  /**
   * Where the day begins, when it is known better than by guessing.
   *
   * Defaults to the first anchor that has coordinates. A trip planner
   * passes the city centre, so a day with no booked anchor still routes
   * outwards from somewhere real rather than from its first candidate.
   */
  startPoint?: Point | null
  /**
   * Legs whose time you looked up yourself.
   *
   * Threaded all the way down rather than applied at the end: the times
   * do not merely label the plan, they decide the order and whether the
   * day fits. A correction the router never saw would show the right
   * number beside the wrong itinerary.
   */
  known?: Known
}

export interface PlannedVisit {
  id: string
  startAt: string
  travelMinutesBefore: number
  /**
   * The two ends of the leg that `travelMinutesBefore` measures.
   *
   * Carried so a reader can correct it. The estimate is honest about
   * distance and long about time — it cannot know whether a railway
   * joins two points — and the only free fix is a number you looked up,
   * which needs somewhere to be typed and something to be typed against.
   * Null at the start of a day, where there is no previous point.
   */
  legFrom: Point | null
  legTo: Point | null
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
export function nearestNeighbour(
  items: Candidate[],
  from: Point | null,
  known?: Known,
): Candidate[] {
  const remaining = [...items]
  const ordered: Candidate[] = []
  let current = from

  while (remaining.length > 0) {
    let bestIndex = 0
    if (current) {
      let bestCost = Infinity
      remaining.forEach((item, index) => {
        const cost = travelMinutes(current!, item.point, known)
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

/**
 * Minutes between two points, when both are known.
 *
 * An unknown point on either side costs nothing, which is the honest
 * answer: we have no idea, and inventing a number would be worse than
 * admitting the leg is unmeasured.
 */
function legCost(from: Point | null, to: Point | null, known?: Known): number {
  return from && to ? travelMinutes(from, to, known) : 0
}

function tourCost(items: Candidate[], from: Point | null, known?: Known): number {
  let total = 0
  let previous = from
  for (const item of items) {
    total += legCost(previous, item.point, known)
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
export function twoOpt(items: Candidate[], from: Point | null, known?: Known): Candidate[] {
  if (items.length < 3) return items
  let best = [...items]
  let bestCost = tourCost(best, from, known)
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
        const cost = tourCost(candidate, from, known)
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

/**
 * An instant as minutes on the day's local clock, the exact inverse of
 * `instantAt`.
 *
 * Elapsed minutes since local midnight are NOT the same thing, and the
 * difference is a whole hour twice a year. In Rome on 25 October 2026
 * the clocks go back, so 14:30 local is 930 minutes after local midnight
 * but only 870 minutes on the clock — and `dayStart`, `dayEnd` and every
 * opening hour speak the clock. The old arithmetic therefore handed
 * `planDay` a free hour that does not exist, and it scheduled a visit
 * starting the same minute a booked tour did.
 *
 * Values outside 0..1439 are meaningful and kept: an anchor belonging to
 * the day before reads negative, one belonging to the next reads past
 * midnight, and both are correct relative to this day.
 */
export function localMinutes(instant: string, day: CalendarDate, zone: string): number {
  return (
    minutesOfDayInZone(instant, zone) + 1440 * daysBetween(day, dayKeyInZone(instant, zone))
  )
}

/**
 * Build a plan for one day.
 *
 * Anchors stay exactly where they are; candidates are ordered to minimise
 * travel and then poured into the gaps between them, highest priority
 * first. Anything that will not fit is returned with a reason rather than
 * silently discarded.
 */
/** Where a candidate sits in the queue, once the day's theme is known. */
function rankFor(candidate: Candidate, theme?: DayTheme | null): number {
  const base = PRIORITY_ORDER[candidate.priority]
  if (!theme || !candidate.category) return base
  return THEME_CATEGORIES[theme].includes(candidate.category) ? base - 1 : base
}

export function planDay(
  anchors: Anchor[],
  candidates: Candidate[],
  options: PlanOptions,
): DayPlan {
  const { day, zone, dayStart = '09:00', dayEnd = '21:00', known, theme } = options
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

  /**
   * Highest priority first, so that when the day overflows it is the
   * optional things that fall off rather than whatever happened to be
   * last — and, on a themed day, the ones that are not what the day is
   * for before the ones that are.
   *
   * A theme sorts, it does not filter. A shopping day in a city with
   * four shops should still be a day rather than four shops and seven
   * empty hours, and a shrine passed between two of them costs nothing.
   * It is worth exactly one step of priority: enough that a normal shop
   * beats a normal temple, not enough that it beats somewhere you marked
   * as unmissable.
   */
  const wanted = [...candidates].sort(
    (a, b) => rankFor(a, theme) - rankFor(b, theme),
  )

  const startPoint = options.startPoint ?? fixed.find((anchor) => anchor.point)?.point ?? null
  const ordered = twoOpt(nearestNeighbour(wanted, startPoint, known), startPoint, known)

  /**
   * The gaps between the things that cannot move.
   *
   * Built in one pass, because the origins and the windows have to agree
   * and they did not: a window was only pushed when an anchor started
   * after the cursor, but its origin was read as `fixed[index - 1].point`
   * — so one anchor beginning at or before `dayStart` desynchronised the
   * origin of every window after it, and an anchor with no coordinates
   * reset the origin to null and made the next leg look free.
   *
   * Each window also knows where you must be when it closes, so a visit
   * cannot be squeezed in right up to the minute a booked tour starts on
   * the other side of the city.
   */
  const state: {
    at: number
    until: number
    where: Point | null
    /** Where the anchor that closes this window is; null for the last. */
    exitTo: Point | null
    used: boolean
  }[] = []

  let cursor = openAt
  let where = startPoint

  for (const anchor of fixed) {
    // An anchor occupies more than its own span: a flight needs the
    // airport reached beforehand, a dinner needs you at the table.
    const busyFrom = anchor.from - (anchor.bufferBeforeMinutes ?? 0)
    const busyTo = anchor.to + (anchor.bufferAfterMinutes ?? 0)

    // Clamped: a 23:00 flight used to produce the window [09:00, 23:00]
    // and a visit got scheduled at 21:30 on a day declared to end at 21:00.
    const until = Math.min(busyFrom, closeAt)
    if (until > cursor) {
      state.push({ at: cursor, until, where, exitTo: anchor.point, used: false })
    }

    // The last *located* point, carried forward past anchors that have none.
    if (anchor.point) where = anchor.point
    cursor = Math.max(cursor, busyTo)
  }

  if (cursor < closeAt) {
    state.push({ at: cursor, until: closeAt, where, exitTo: null, used: false })
  }

  const visits: PlannedVisit[] = []
  const dropped: DroppedVisit[] = []
  let travel = 0

  // This is the sort that decides who survives when the day overflows —
  // the one above only decides the route. The theme has to be in both, or
  // it works by the stability of this one, which is luck rather than
  // design: sabotaging the weight above changed nothing here.
  const byPriority = ordered.slice().sort((a, b) => rankFor(a, theme) - rankFor(b, theme))

  for (const candidate of byPriority) {
    const openness = opennessOn(candidate.openingHours, day)
    if (openness.kind === 'closed') {
      dropped.push({ id: candidate.id, reason: 'closed' })
      continue
    }

    let placed = false
    for (const window of state) {
      const move = legCost(window.where, candidate.point, known)
      const arrival = window.at + move
      const start = earliestStart(openness, arrival, candidate.visitMinutes)
      if (start === null) continue
      // Room to get to whatever closes the window, not merely room to
      // finish the visit.
      const exit = legCost(candidate.point, window.exitTo, known)
      if (start + candidate.visitMinutes + exit > window.until) continue

      visits.push({
        id: candidate.id,
        startAt: instantAt(day, start, zone),
        travelMinutesBefore: move,
        legFrom: window.where,
        legTo: candidate.point,
        hoursUnknown: openness.kind === 'unknown',
      })
      travel += move
      window.at = start + candidate.visitMinutes
      window.where = candidate.point
      window.used = true
      placed = true
      break
    }

    if (!placed) dropped.push({ id: candidate.id, reason: 'no_room' })
  }

  // The leg out of each window, counted once at the end rather than per
  // candidate: it is the journey from whatever ended up last, and adding
  // it as each visit lands would count every abandoned intermediate.
  for (const window of state) {
    if (window.used) travel += legCost(window.where, window.exitTo, known)
  }

  visits.sort((a, b) => a.startAt.localeCompare(b.startAt))
  return { visits, dropped, travelMinutes: travel }
}
