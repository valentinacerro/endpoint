/**
 * Rain, and what to do about it.
 *
 * The re-balancer answers one question: given a wet Tuesday and a dry
 * Friday, is there a museum on Friday that could trade places with the
 * garden on Tuesday? It proposes; it never rearranges anything on its
 * own. A plan you did not agree to is worse than rain.
 *
 * Pure functions over plain data, like the optimiser next door, and for
 * the same reason: the reasoning is the part worth testing, and it has to
 * keep working in a station with no signal.
 */

import type { DayWeather, Place } from '../api/types'
import type { IconName } from '../components/Icon'
import type { CalendarDate } from './datetime'
import { opennessOn, type OpeningHours } from './optimizer'

/** Enough rain to spoil an afternoon outdoors. */
const WET_MM = 3
/** Or enough chance of it. */
const WET_PROBABILITY = 60

export type Wetness = 'wet' | 'dry' | 'unknown'

/**
 * Whether a day is one to spend indoors.
 *
 * Unknown is a real answer and not a synonym for dry: no forecast reaches
 * a trip two months out, and treating that silence as sunshine would have
 * the re-balancer confidently propose nothing.
 */
export function wetness(day: DayWeather | undefined): Wetness {
  if (!day) return 'unknown'
  if (day.precipitation_mm >= WET_MM) return 'wet'
  if (day.precipitation_probability !== null && day.precipitation_probability >= WET_PROBABILITY) {
    return 'wet'
  }
  return 'dry'
}

/** Key into the forecast: the weather differs by city as well as by day. */
function slot(stopId: string, day: CalendarDate): string {
  return `${stopId}|${day}`
}

export function indexForecast(days: readonly DayWeather[]): Map<string, DayWeather> {
  return new Map(days.map((day) => [slot(day.stop_id, day.day), day]))
}

/** A place as it currently sits in the plan. */
export interface Scheduled {
  place: Place
  day: CalendarDate
  /** Which city that day is spent in; null when the dates do not say. */
  stopId: string | null
}

export interface Swap {
  /** Currently outdoors on a wet day. */
  outdoor: Scheduled
  /** Currently indoors on a drier one. */
  indoor: Scheduled
  /** Rain the outdoor visit steps out of, in mm. */
  rainAvoidedMm: number
  /** One of the two has no opening hours on record, so this is a guess. */
  hoursUnknown: boolean
}

export interface Stuck {
  day: CalendarDate
  reason: 'no_indoor_alternative' | 'unknown_city'
}

export interface Rebalance {
  swaps: Swap[]
  /** Wet days with something outdoors on them that nothing could help. */
  stuck: Stuck[]
}

/** How badly a place minds rain. `mixed` minds it, but less. */
const EXPOSURE_COST: Record<string, number> = { outdoor: 2, mixed: 1, indoor: 0 }

const PRIORITY_RANK: Record<string, number> = { must_see: 0, high: 1, normal: 2, low: 3 }

function hoursOf(place: Place): OpeningHours {
  return (place.opening_hours ?? {}) as OpeningHours
}

/**
 * Could this place be visited on that day at all?
 *
 * Three states, not two. A place with no hours on record is *not* known to
 * be shut — almost nothing imported from Maps carries hours — so it stays
 * a candidate and the uncertainty is passed up rather than resolved by
 * guessing.
 */
function canVisitOn(place: Place, day: CalendarDate): { possible: boolean; unknown: boolean } {
  const openness = opennessOn(hoursOf(place), day)
  return { possible: openness.kind !== 'closed', unknown: openness.kind === 'unknown' }
}

function rainOf(entry: DayWeather | undefined): number {
  return entry?.precipitation_mm ?? 0
}

/**
 * Propose trades between a wet day and a drier one.
 *
 * Greedy, and deliberately so: it takes the wettest outdoor visit first
 * and finds it the driest home, then moves on. An exhaustive search over
 * a fortnight would be a different program for a gain you could not
 * perceive — the input is a forecast, and next Tuesday's rainfall is not
 * known to the millimetre.
 *
 * Every proposal respects three things a naive swap would break: you
 * cannot move a visit to a day you are in another city, you cannot move
 * one to a day it is shut, and each place is proposed at most once so the
 * suggestions can all be accepted together.
 */
export function rebalance(
  scheduled: readonly Scheduled[],
  forecast: readonly DayWeather[],
): Rebalance {
  const byslot = indexForecast(forecast)
  const weatherOn = (entry: Scheduled): DayWeather | undefined =>
    entry.stopId ? byslot.get(slot(entry.stopId, entry.day)) : undefined

  const wetOutdoor: Scheduled[] = []
  const dryIndoor: Scheduled[] = []
  const stuck = new Map<CalendarDate, Stuck>()

  for (const entry of scheduled) {
    const exposure = entry.place.weather_exposure
    const state = wetness(weatherOn(entry))

    if (state === 'wet' && EXPOSURE_COST[exposure] > 0) {
      if (!entry.stopId) stuck.set(entry.day, { day: entry.day, reason: 'unknown_city' })
      else wetOutdoor.push(entry)
    }
    if (state === 'dry' && exposure === 'indoor') dryIndoor.push(entry)
  }

  // Worst first: the wettest day, and within it the visit that minds most,
  // then the one you would be sorriest to spend under an umbrella.
  const queue = [...wetOutdoor].sort((a, b) => {
    const rain = rainOf(weatherOn(b)) - rainOf(weatherOn(a))
    if (rain !== 0) return rain
    const exposure =
      EXPOSURE_COST[b.place.weather_exposure] - EXPOSURE_COST[a.place.weather_exposure]
    if (exposure !== 0) return exposure
    return PRIORITY_RANK[a.place.priority] - PRIORITY_RANK[b.place.priority]
  })

  // Only targets need guarding: a place is scheduled once, and the two
  // lists are disjoint — nothing counts as both exposed and indoors.
  const used = new Set<string>()
  const swaps: Swap[] = []

  for (const wet of queue) {
    let best: { target: Scheduled; unknown: boolean; rain: number } | null = null

    for (const dry of dryIndoor) {
      if (used.has(dry.place.id)) continue
      // Same city, different day: a swap across cities would have you in
      // Kyoto on a day you are in Tokyo.
      if (dry.stopId !== wet.stopId || dry.day === wet.day) continue

      const outdoorThere = canVisitOn(wet.place, dry.day)
      const indoorHere = canVisitOn(dry.place, wet.day)
      if (!outdoorThere.possible || !indoorHere.possible) continue

      const rain = rainOf(weatherOn(dry))
      if (best === null || rain < best.rain) {
        best = { target: dry, unknown: outdoorThere.unknown || indoorHere.unknown, rain }
      }
    }

    if (best === null) {
      stuck.set(wet.day, { day: wet.day, reason: 'no_indoor_alternative' })
      continue
    }

    used.add(wet.place.id)
    used.add(best.target.place.id)
    swaps.push({
      outdoor: wet,
      indoor: best.target,
      rainAvoidedMm: Math.round((rainOf(weatherOn(wet)) - best.rain) * 10) / 10,
      hoursUnknown: best.unknown,
    })
  }

  return { swaps, stuck: [...stuck.values()].sort((a, b) => a.day.localeCompare(b.day)) }
}

/**
 * WMO weather codes, grouped.
 *
 * The full table has 28 entries that differ in ways a traveller does not
 * act on — "light drizzle" and "moderate drizzle" lead to the same
 * umbrella. Grouped into what changes a decision.
 */
export type Sky = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm'

export function skyOf(code: number): Sky {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2 || code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  return 'rain'
}

/** Drawn, not emoji: one per row of the forecast, in the app's own ink. */
export const SKY_ICON: Record<Sky, IconName> = {
  clear: 'clear',
  cloudy: 'cloud',
  fog: 'fog',
  rain: 'rain',
  snow: 'snow',
  storm: 'storm',
}
