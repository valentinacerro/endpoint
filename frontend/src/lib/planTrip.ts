/**
 * Organising a whole trip, not one day of it.
 *
 * You collect a pile of places over weeks — pasted links, a Takeout
 * export, things typed at midnight — and what you want is for them to be
 * spread across the days, in the right cities, without you deciding
 * thirty times which afternoon each one belongs to.
 *
 * It proposes; it never rewrites anything on its own. The word used to
 * the reader is "organise", not "optimise": this is a heuristic over
 * travel times that are themselves estimates, and it says so.
 *
 * `planDay` stays exactly as it is and does the work inside each day.
 * The job here is deciding which day each place is offered to, and —
 * just as much — saying precisely what it could not place and why.
 */

import type { Booking, DayTheme, Place, Stop, TripBundle } from '../api/types'

import {
  dayKeyInZone,
  eachDay,
  minutesOfDayInZone,
  type CalendarDate,
} from './datetime'
import { knownLegs, routeMinutes, type Known, type Point } from './geo'
import { baseStopOn } from './itinerary'
import {
  localMinutes,
  nearestNeighbour,
  opennessOn,
  planDay,
  twoOpt,
  type Anchor,
  type Candidate,
  type DayPlan,
  type OpeningHours,
} from './optimizer'
import { cityOf, inferStops, stopCentres, type StopMatch } from './stops'

/** The clock you are willing to keep, when nothing says otherwise. */
const DEFAULT_START = '09:00'
const DEFAULT_END = '21:00'

/**
 * When you land with no transport booked, and when you leave.
 *
 * Guesses, and reported as such rather than applied quietly. A day that
 * begins with an arrival is not a day that begins at nine.
 */
const ASSUMED_ARRIVAL = '14:00'
const ASSUMED_DEPARTURE = '11:00'

/** Below this, a day has nothing worth offering. */
const USABLE_MINUTES = 45

/**
 * What a booking costs beyond its own span.
 *
 * A flight is not a thing that begins when it departs: you have to be at
 * the airport. This is the only protection that works on transport,
 * because a flight or a train never has coordinates stored, so the
 * travel check inside `planDay` is inert on exactly these.
 */
const BUFFER_BEFORE: Record<string, number> = {
  flight: 120,
  train: 30,
  bus: 30,
  ferry: 45,
}

/** Bookings that mark a day rather than occupying an afternoon of it. */
const SPANS_DAYS = new Set(['hotel', 'car_rental'])
/** Bookings that move you, and so bound the start or the end of a day. */
const TRANSPORT = new Set(['flight', 'train', 'bus', 'ferry'])

export type DayRefusal =
  | 'no_stop'
  | 'overlapping_stops'
  | 'stop_not_located'
  | 'in_the_past'
  | 'no_usable_hours'

export type PlaceRefusal =
  | 'no_position'
  | 'no_located_stop'
  | 'far_from_every_stop'
  | 'day_trip'
  | 'stop_has_no_days'
  | 'closed_on_every_day'
  | 'no_room'

export interface SlotAssumption {
  day: CalendarDate
  what: 'arrival_assumed' | 'departure_assumed'
}

export interface PlannedDay {
  key: CalendarDate
  stop: Stop | null
  zone: string
  /** Absent when the day was refused. */
  plan: DayPlan | null
  refused: DayRefusal | null
}

export interface Unplaced {
  placeId: string
  reason: PlaceRefusal
  /** The days it was actually offered to, so "no room" is checkable. */
  daysTried: CalendarDate[]
  /** How far it is from the city it was matched to, for the distance ones. */
  km?: number
  stopId?: string
}

export interface ScheduleWrite {
  placeId: string
  startAt: string
  zone: string
}

export interface TripPlan {
  days: PlannedDay[]
  writes: ScheduleWrite[]
  /** Already scheduled, and left exactly where they were. */
  kept: string[]
  unplaced: Unplaced[]
  assumptions: SlotAssumption[]
  /** Scheduled without knowing whether the place is open. */
  hoursUnknown: number
  travelMinutes: number
}

export interface PlanTripOptions {
  now?: Date
  /** Only these days; everything else is left alone. */
  onlyDays?: CalendarDate[]
  /**
   * `keep` treats what you already scheduled as immovable.
   * `day` returns the requested days' visits to the pool, which is what
   * the per-day button has always done.
   */
  replan?: 'keep' | 'day'
  dayStart?: string
  dayEnd?: string
}

// --- Days ---------------------------------------------------------------

interface Slot {
  key: CalendarDate
  stop: Stop | null
  zone: string
  anchors: Anchor[]
  openAt: number
  closeAt: number
  freeMinutes: number
  refused: DayRefusal | null
  assumption: SlotAssumption | null
  centre: Point | null
  /** What kind of day you asked for. Null means you have not said. */
  theme: DayTheme | null
}

function pointOf(thing: { lat: number | null; lon: number | null }): Point | null {
  return thing.lat !== null && thing.lon !== null ? { lat: thing.lat, lon: thing.lon } : null
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Every day the trip could possibly cover.
 *
 * From the stops as well as the trip, because both of the trip's dates
 * are nullable and nothing requires them — a trip sketched as a list of
 * cities has perfectly good dates on its stops and none on itself, and
 * `buildTimeline` would hand back no days at all.
 */
function tripDays(bundle: TripBundle): CalendarDate[] {
  const dates: CalendarDate[] = []
  if (bundle.trip.start_date) dates.push(bundle.trip.start_date)
  if (bundle.trip.end_date) dates.push(bundle.trip.end_date)
  for (const stop of bundle.stops) {
    if (stop.arrive_date) dates.push(stop.arrive_date)
    if (stop.depart_date) dates.push(stop.depart_date)
  }
  if (dates.length === 0) return []
  const sorted = [...dates].sort()
  return eachDay(sorted[0], sorted[sorted.length - 1])
}

/**
 * The bookings that occupy part of a day, including the one that brought
 * you there.
 *
 * `buildTimeline` keys a booking by when it *starts*, so an overnight
 * Rome→Tokyo appears only on the day it departs and the arrival day has
 * nothing on it at all. Without picking those up here, day one of every
 * long-haul trip gets planned from nine in the morning while the plane
 * is still on approach.
 */
function anchorsOn(bundle: TripBundle, day: CalendarDate): Anchor[] {
  const fallback = bundle.trip.primary_tz
  const anchors: Anchor[] = []

  for (const booking of bundle.bookings) {
    if (!booking.start_at || SPANS_DAYS.has(booking.kind)) continue

    const startsHere = dayKeyInZone(booking.start_at, booking.start_tz ?? fallback) === day
    const endsHere =
      booking.end_at !== null &&
      dayKeyInZone(booking.end_at, booking.end_tz ?? booking.start_tz ?? fallback) === day
    if (!startsHere && !endsHere) continue

    anchors.push({
      id: booking.id,
      startAt: booking.start_at,
      endAt: booking.end_at,
      point: pointOf(booking),
      label: booking.title,
      bufferBeforeMinutes: BUFFER_BEFORE[booking.kind] ?? 0,
    })
  }

  return anchors
}

function transportEndingOn(bundle: TripBundle, day: CalendarDate): Booking | null {
  const fallback = bundle.trip.primary_tz
  return (
    bundle.bookings.find(
      (booking) =>
        TRANSPORT.has(booking.kind) &&
        booking.end_at !== null &&
        dayKeyInZone(booking.end_at, booking.end_tz ?? booking.start_tz ?? fallback) === day,
    ) ?? null
  )
}

function transportStartingOn(bundle: TripBundle, day: CalendarDate): Booking | null {
  const fallback = bundle.trip.primary_tz
  return (
    bundle.bookings.find(
      (booking) =>
        TRANSPORT.has(booking.kind) &&
        booking.start_at !== null &&
        dayKeyInZone(booking.start_at, booking.start_tz ?? fallback) === day,
    ) ?? null
  )
}

function buildSlot(
  bundle: TripBundle,
  day: CalendarDate,
  centres: Map<string, Point>,
  options: PlanTripOptions,
): Slot {
  const ownership = baseStopOn(bundle.stops, day)
  const stop = ownership.stop
  const zone = stop?.tz ?? bundle.trip.primary_tz
  const anchors = anchorsOn(bundle, day)

  const base: Omit<Slot, 'refused' | 'openAt' | 'closeAt' | 'freeMinutes' | 'assumption'> = {
    key: day,
    stop,
    zone,
    anchors,
    centre: stop ? (centres.get(stop.id) ?? null) : null,
    theme: bundle.day_notes.find((note) => note.day === day)?.theme ?? null,
  }
  const refuse = (refused: DayRefusal): Slot => ({
    ...base,
    openAt: 0,
    closeAt: 0,
    freeMinutes: 0,
    assumption: null,
    refused,
  })

  if (!stop) {
    return refuse(ownership.why === 'overlapping_stops' ? 'overlapping_stops' : 'no_stop')
  }
  if (!base.centre) return refuse('stop_not_located')

  const now = options.now ?? new Date()
  const today = dayKeyInZone(now.toISOString(), zone)
  if (day < today) return refuse('in_the_past')

  let openAt = minutesOfDay(options.dayStart ?? DEFAULT_START)
  let closeAt = minutesOfDay(options.dayEnd ?? DEFAULT_END)
  let assumption: SlotAssumption | null = null

  // Today has already partly gone.
  if (day === today) openAt = Math.max(openAt, minutesOfDayInZone(now.toISOString(), zone))

  // When the journey here is booked, it is already an anchor and planDay
  // keeps the morning for it — including the case where it took off
  // yesterday, which reads as a negative minute and eats the morning
  // correctly. Only the unbooked case needs a bound of its own, and that
  // is a guess, so it is said out loud rather than applied quietly.
  if (stop.arrive_date === day && !transportEndingOn(bundle, day)) {
    openAt = Math.max(openAt, minutesOfDay(ASSUMED_ARRIVAL))
    assumption = { day, what: 'arrival_assumed' }
  }

  if ((stop.depart_date ?? stop.arrive_date) === day) {
    const departure = transportStartingOn(bundle, day)
    if (departure?.start_at) {
      const buffer = BUFFER_BEFORE[departure.kind] ?? 0
      closeAt = Math.min(closeAt, minutesOfDayInZone(departure.start_at, zone) - buffer)
    } else {
      closeAt = Math.min(closeAt, minutesOfDay(ASSUMED_DEPARTURE))
      assumption = { day, what: 'departure_assumed' }
    }
  }

  const free = freeMinutesIn(anchors, openAt, closeAt, zone, day)
  if (free < USABLE_MINUTES) {
    return { ...base, openAt, closeAt, freeMinutes: free, assumption, refused: 'no_usable_hours' }
  }

  return { ...base, openAt, closeAt, freeMinutes: free, assumption, refused: null }
}

/** Minutes left between the bookings, which is all a day really offers. */
function freeMinutesIn(
  anchors: Anchor[],
  openAt: number,
  closeAt: number,
  zone: string,
  day: CalendarDate,
): number {
  const spans = anchors
    .filter((anchor) => anchor.startAt)
    .map((anchor) => {
      const from = localMinutes(anchor.startAt, day, zone) - (anchor.bufferBeforeMinutes ?? 0)
      const to =
        (anchor.endAt ? localMinutes(anchor.endAt, day, zone) : from) +
        (anchor.bufferAfterMinutes ?? 0)
      return [from, Math.max(from, to)] as const
    })
    .sort((a, b) => a[0] - b[0])

  let free = 0
  let cursor = openAt
  for (const [from, to] of spans) {
    if (from > cursor) free += Math.min(from, closeAt) - cursor
    cursor = Math.max(cursor, to)
    if (cursor >= closeAt) return Math.max(0, free)
  }
  if (cursor < closeAt) free += closeAt - cursor
  return Math.max(0, free)
}

// --- The plan -----------------------------------------------------------

function candidateOf(place: Place): Candidate {
  return {
    id: place.id,
    point: pointOf(place) as Point,
    visitMinutes: place.visit_minutes,
    priority: place.priority,
    openingHours: (place.opening_hours ?? {}) as OpeningHours,
    label: place.name,
    // Carried so a themed day can prefer its own kind of place.
    category: place.category,
  }
}

export function planTrip(bundle: TripBundle, options: PlanTripOptions = {}): TripPlan {
  // The legs whose time you looked up yourself. Built once and handed to
  // everything below: these decide the order and whether a day fits, not
  // just what is printed next to it.
  const known = knownLegs(bundle.travel_times)
  const inferred = inferStops(bundle)
  const centres = new Map(
    [...stopCentres(bundle)].map(([id, centre]) => [id, { lat: centre.lat, lon: centre.lon }]),
  )

  const days = tripDays(bundle)
  const wanted = options.onlyDays ? new Set(options.onlyDays) : null
  const slots = days
    .filter((day) => wanted === null || wanted.has(day))
    .map((day) => buildSlot(bundle, day, centres, options))

  const replan = options.replan ?? 'keep'
  const unplaced: Unplaced[] = []
  const kept: string[] = []

  // --- who is even a candidate ---
  const pool = new Map<string, Place[]>()

  for (const place of bundle.places) {
    if (place.planned_start_at) {
      const onRequestedDay =
        replan === 'day' &&
        wanted !== null &&
        wanted.has(dayKeyInZone(place.planned_start_at, place.planned_tz ?? bundle.trip.primary_tz))
      if (!onRequestedDay) {
        kept.push(place.id)
        continue
      }
    }

    if (!pointOf(place)) {
      unplaced.push({ placeId: place.id, reason: 'no_position', daysTried: [] })
      continue
    }

    const city = cityOf(place, inferred)
    if (!city) {
      unplaced.push({ placeId: place.id, ...whyNoCity(place, inferred, centres) })
      continue
    }

    pool.set(city, [...(pool.get(city) ?? []), place])
  }

  // --- one route per city, chopped into day-sized pieces ---
  const writes: ScheduleWrite[] = []
  const plans = new Map<CalendarDate, DayPlan>()
  let travelMinutes = 0
  let hoursUnknown = 0

  for (const [stopId, places] of pool) {
    const usable = slots.filter((slot) => slot.refused === null && slot.stop?.id === stopId)
    if (usable.length === 0) {
      for (const place of places) {
        unplaced.push({ placeId: place.id, reason: 'stop_has_no_days', daysTried: [], stopId })
      }
      continue
    }

    // Refuse before chunking, so a place that can never happen does not
    // eat a day's capacity and then get blamed for not fitting.
    const allDays = usable.map((slot) => slot.key)
    const open: Place[] = []
    for (const place of places) {
      const somewhere = usable.some(
        (slot) => opennessOn((place.opening_hours ?? {}) as OpeningHours, slot.key).kind !== 'closed',
      )
      if (somewhere) open.push(place)
      else
        unplaced.push({
          placeId: place.id,
          reason: 'closed_on_every_day',
          daysTried: allDays,
          stopId,
        })
    }
    if (open.length === 0) continue

    const centre = centres.get(stopId) ?? null
    const route = orderRoute(open.map(candidateOf), centre, known)
    const buckets = chop(route, usable, centre, known)

    // --- forward pass, carrying what did not fit ---
    let carry: Candidate[] = []
    const offered = new Map<string, CalendarDate[]>()

    for (const [index, slot] of usable.entries()) {
      const forToday = [...carry, ...(buckets[index] ?? [])]
      carry = []
      for (const candidate of forToday) {
        offered.set(candidate.id, [...(offered.get(candidate.id) ?? []), slot.key])
      }

      const plan = planDay(slot.anchors, forToday, {
        day: slot.key,
        zone: slot.zone,
        dayStart: fromMinutes(slot.openAt),
        dayEnd: fromMinutes(slot.closeAt),
        startPoint: slot.centre,
        known,
        theme: slot.theme,
      })
      plans.set(slot.key, plan)

      const byId = new Map(forToday.map((candidate) => [candidate.id, candidate]))
      for (const visit of plan.visits) {
        writes.push({ placeId: visit.id, startAt: visit.startAt, zone: slot.zone })
        if (visit.hoursUnknown) hoursUnknown += 1
      }
      travelMinutes += plan.travelMinutes

      for (const drop of plan.dropped) {
        const candidate = byId.get(drop.id)
        if (!candidate) continue
        if (drop.reason === 'no_room') carry.push(candidate)
        // `closed` was already ruled out above for every day of this
        // city, so a closed drop here means it is shut only today and
        // it simply moves on with the carry.
        else carry.push(candidate)
      }
    }

    // --- one sweep back, so "no room" is a true statement ---
    for (const candidate of carry) {
      const tried = offered.get(candidate.id) ?? []
      const untried = usable.filter((slot) => !tried.includes(slot.key))
      let landed = false

      for (const slot of untried) {
        const existing = plans.get(slot.key)
        const already = (existing?.visits ?? []).map((visit) => visit.id)
        const retry = planDay(
          slot.anchors,
          [...rebuild(already, open), candidate],
          {
            day: slot.key,
            zone: slot.zone,
            dayStart: fromMinutes(slot.openAt),
            dayEnd: fromMinutes(slot.closeAt),
            startPoint: slot.centre,
            known,
            theme: slot.theme,
          },
        )
        offered.set(candidate.id, [...(offered.get(candidate.id) ?? []), slot.key])

        const placedNow = retry.visits.some((visit) => visit.id === candidate.id)
        const keptAll = already.every((id) => retry.visits.some((visit) => visit.id === id))
        if (!placedNow || !keptAll) continue

        // Replace that day's plan wholesale.
        for (const id of already) {
          const at = writes.findIndex((write) => write.placeId === id)
          if (at >= 0) writes.splice(at, 1)
        }
        travelMinutes -= existing?.travelMinutes ?? 0
        hoursUnknown -= (existing?.visits ?? []).filter((visit) => visit.hoursUnknown).length

        plans.set(slot.key, retry)
        for (const visit of retry.visits) {
          writes.push({ placeId: visit.id, startAt: visit.startAt, zone: slot.zone })
          if (visit.hoursUnknown) hoursUnknown += 1
        }
        travelMinutes += retry.travelMinutes
        landed = true
        break
      }

      if (!landed) {
        unplaced.push({
          placeId: candidate.id,
          reason: 'no_room',
          daysTried: offered.get(candidate.id) ?? [],
          stopId,
        })
      }
    }
  }

  const plan: TripPlan = {
    days: slots.map((slot) => ({
      key: slot.key,
      stop: slot.stop,
      zone: slot.zone,
      plan: plans.get(slot.key) ?? null,
      refused: slot.refused,
    })),
    writes,
    kept,
    unplaced,
    assumptions: slots
      .map((slot) => slot.assumption)
      .filter((assumption): assumption is SlotAssumption => assumption !== null),
    hoursUnknown,
    travelMinutes,
  }

  // Every place is accounted for exactly once. A planner that silently
  // loses one is worse than one that refuses it out loud, and this is
  // the only way to know it never does.
  const seen = writes.length + kept.length + unplaced.length
  if (seen !== bundle.places.length) {
    throw new Error(
      `planTrip lost track: ${seen} accounted for out of ${bundle.places.length} places`,
    )
  }

  return plan
}

/** Which of the distance reasons applies, so the refusal is specific. */
function whyNoCity(
  place: Place,
  inferred: Map<string, StopMatch>,
  centres: Map<string, Point>,
): Omit<Unplaced, 'placeId'> {
  if (centres.size === 0) return { reason: 'no_located_stop', daysTried: [] }
  const match = inferred.get(place.id)
  if (!match) return { reason: 'no_located_stop', daysTried: [] }
  return {
    reason: match.band === 'day_trip' ? 'day_trip' : 'far_from_every_stop',
    daysTried: [],
    km: Math.round(match.km),
    stopId: match.stopId,
  }
}

function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/**
 * One route through a city's places.
 *
 * `twoOpt` is cubic per round and runs up to fifty rounds, which is fine
 * for a day and not fine for a city's entire wish list on a phone — so
 * above thirty places the nearest-neighbour order stands on its own.
 */
function orderRoute(candidates: Candidate[], from: Point | null, known?: Known): Candidate[] {
  const near = nearestNeighbour(candidates, from, known)
  return candidates.length <= 30 ? twoOpt(near, from, known) : near
}

function rebuild(ids: string[], places: Place[]): Candidate[] {
  const byId = new Map(places.map((place) => [place.id, place]))
  return ids
    .map((id) => byId.get(id))
    .filter((place): place is Place => place !== undefined)
    .map(candidateOf)
}

/**
 * Cut a city's route into day-sized pieces.
 *
 * The one line that turns "fills Monday and gives up" into "organises
 * all the days". Each day takes the share of the route its free time
 * deserves, so six places over three days land two, two and two rather
 * than six, nothing and nothing — and thirty places over four days
 * overflow every day a little instead of one neighbourhood falling off
 * the end.
 */
function chop(
  route: Candidate[],
  slots: Slot[],
  centre: Point | null,
  known?: Known,
): Candidate[][] {
  const buckets: Candidate[][] = slots.map(() => [])
  if (route.length === 0 || slots.length === 0) return buckets

  const demand =
    route.reduce((sum, candidate) => sum + candidate.visitMinutes, 0) +
    routeMinutes(
      [...(centre ? [centre] : []), ...route.map((candidate) => candidate.point)],
      known,
    )
  const capacity = slots.reduce((sum, slot) => sum + slot.freeMinutes, 0)
  // A little slack, so something just over a boundary still lands rather
  // than being pushed a whole day later.
  const factor = (demand / Math.max(capacity, 1)) * 1.15

  let index = 0
  let running = 0

  for (const candidate of route) {
    const budget = slots[index].freeMinutes * factor
    if (running > 0 && running + candidate.visitMinutes > budget && index < slots.length - 1) {
      index += 1
      running = 0
    }
    buckets[index].push(candidate)
    running += candidate.visitMinutes
  }

  return buckets
}
