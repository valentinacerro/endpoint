/**
 * Working out which city a place belongs to.
 *
 * Nothing has ever set `place.stop_id` automatically — not the Takeout
 * import, not a pasted Maps link, not the type-ahead. So the ordinary way
 * of collecting places produces a pile with coordinates and no city, and
 * a planner that needs to know which city a day is spent in cannot see
 * any of them.
 *
 * This works it out from the coordinates, and **never writes it down**.
 * That is the important half. There is no column recording whether a
 * `stop_id` was chosen or guessed, so saving a guess would make it
 * indistinguishable from your own choice for ever after — and it would
 * leak into the rain rebalancer's cross-city guard and the day planner's
 * candidate rule, where a wrong guess is invisible and permanent.
 * `place.stop_id` therefore keeps meaning exactly one thing: you said so.
 */

import type { Booking, Place, Stop, TripBundle } from '../api/types'

import { dayKeyInZone } from './datetime'
import { haversineKm, type Point } from './geo'

/**
 * How far a place can be from a city and still belong to it.
 *
 * Measured, not rounded to something comfortable. From Shinjuku:
 * Shinjuku Gyoen 1 km, Tsukiji 7, Sensō-ji 9, Odaiba 10, Yokohama 28 —
 * everything you cross town for on a free afternoon. Then the gap:
 * Kamakura 43, Hakone 74, Nikkō 115, all of which are a whole day out
 * and none of which can be slotted into one. Kyoto is 366 and belongs to
 * nothing of Tokyo's.
 */
const CITY_KM = 30
const REACH_KM = 150

export type Band = 'city' | 'day_trip' | 'far'

export interface Centre {
  lat: number
  lon: number
  /**
   * Where the position came from.
   *
   * Worth carrying: a centre derived from your hotels moves when you add
   * a hotel, so a borderline place can change city without you touching
   * it. The screen says which it was.
   */
  from: 'stop' | 'places' | 'hotels'
}

export interface StopMatch {
  stopId: string
  km: number
  band: Band
}

function pointOf(thing: { lat: number | null; lon: number | null }): Point | null {
  return thing.lat !== null && thing.lon !== null ? { lat: thing.lat, lon: thing.lon } : null
}

/**
 * The member of a group that is least far from all the others.
 *
 * A medoid, not an average. One booking out at Narita would drag the
 * mean of Tokyo sixty kilometres east, to a spot where nothing is — and
 * a real point that is merely off-centre is a far better answer than a
 * computed point in the sea.
 */
function medoid(points: readonly Point[]): Point | null {
  if (points.length === 0) return null
  if (points.length <= 2) return points[0]

  let best = points[0]
  let bestTotal = Infinity
  for (const candidate of points) {
    const total = points.reduce((sum, other) => sum + haversineKm(candidate, other), 0)
    if (total < bestTotal) {
      bestTotal = total
      best = candidate
    }
  }
  return best
}

/** Days a booking spans, as calendar keys in its own zones. */
function coversDay(booking: Booking, day: string, fallbackZone: string): boolean {
  if (!booking.start_at) return false
  const from = dayKeyInZone(booking.start_at, booking.start_tz ?? fallbackZone)
  const to = booking.end_at
    ? dayKeyInZone(booking.end_at, booking.end_tz ?? booking.start_tz ?? fallbackZone)
    : from
  return from <= day && day <= to
}

function overlapsStop(booking: Booking, stop: Stop, fallbackZone: string): boolean {
  const from = stop.arrive_date
  const to = stop.depart_date ?? stop.arrive_date
  if (!from || !to) return false
  // Cheap and sufficient: a hotel that covers either end of the stay is
  // a hotel for that stay.
  return coversDay(booking, from, fallbackZone) || coversDay(booking, to, fallbackZone)
}

/**
 * A position for each stop that has one, however indirectly.
 *
 * In order of how much it can be trusted: what the stop itself says;
 * then the places you assigned to it by hand, which is the bootstrap —
 * assign one place in Kyoto and the other thirty follow; then the hotels
 * you are staying in on those dates, attributed by date because a
 * booking has no stop of its own.
 */
/**
 * One point that stands for the whole trip, for biasing a lookup.
 *
 * The medoid of the stop centres — an actual stop, never a point in the
 * sea between two of them — or the first located place or hotel when no
 * stop can be placed. Null when nothing in the trip has a position yet,
 * in which case a lookup is simply unbiased.
 */
export function tripCentre(bundle: TripBundle): { lat: number; lon: number } | null {
  const centres = [...stopCentres(bundle).values()]
  const middle = medoid(centres)
  if (middle) return { lat: middle.lat, lon: middle.lon }
  const anything = [...bundle.places, ...bundle.bookings].find(
    (item) => item.lat !== null && item.lon !== null,
  )
  return anything ? { lat: anything.lat as number, lon: anything.lon as number } : null
}

export function stopCentres(bundle: TripBundle): Map<string, Centre> {
  const centres = new Map<string, Centre>()
  const fallbackZone = bundle.trip.primary_tz

  for (const stop of bundle.stops) {
    const own = pointOf(stop)
    if (own) {
      centres.set(stop.id, { ...own, from: 'stop' })
      continue
    }

    const assigned = bundle.places
      .filter((place) => place.stop_id === stop.id)
      .map(pointOf)
      .filter((point): point is Point => point !== null)
    const fromPlaces = medoid(assigned)
    if (fromPlaces) {
      centres.set(stop.id, { ...fromPlaces, from: 'places' })
      continue
    }

    const hotels = bundle.bookings
      .filter((booking) => booking.kind === 'hotel' && overlapsStop(booking, stop, fallbackZone))
      .map(pointOf)
      .filter((point): point is Point => point !== null)
    const fromHotels = medoid(hotels)
    if (fromHotels) centres.set(stop.id, { ...fromHotels, from: 'hotels' })
  }

  return centres
}

export function bandFor(km: number): Band {
  if (km <= CITY_KM) return 'city'
  if (km <= REACH_KM) return 'day_trip'
  return 'far'
}

/**
 * The nearest city to each place that has coordinates.
 *
 * By straight-line distance, deliberately, and never by `travelMinutes`:
 * that model is city-scale and rates Tokyo to Kyoto at a plausible-
 * looking 1610 minutes, a number nothing downstream would think to
 * reject.
 *
 * Places you assigned by hand are not in the result — there is nothing
 * to infer about them. Callers read `place.stop_id ?? inferred`.
 */
export function inferStops(bundle: TripBundle): Map<string, StopMatch> {
  const centres = stopCentres(bundle)
  const matches = new Map<string, StopMatch>()
  if (centres.size === 0) return matches

  for (const place of bundle.places) {
    if (place.stop_id) continue
    const point = pointOf(place)
    if (!point) continue

    let best: StopMatch | null = null
    for (const [stopId, centre] of centres) {
      const km = haversineKm(point, centre)
      if (best === null || km < best.km) best = { stopId, km, band: bandFor(km) }
    }
    if (best) matches.set(place.id, best)
  }

  return matches
}

/**
 * Which city a place belongs to: yours if you said, ours if you did not.
 *
 * Only the city band counts as belonging. A day trip is matched — so it
 * can be named, and its distance shown — but it is not somewhere you
 * slot into an afternoon, and treating it as one is how an itinerary
 * ends up with Nikkō between lunch and a museum.
 */
export function cityOf(place: Place, inferred: Map<string, StopMatch>): string | null {
  if (place.stop_id) return place.stop_id
  const match = inferred.get(place.id)
  return match && match.band === 'city' ? match.stopId : null
}
