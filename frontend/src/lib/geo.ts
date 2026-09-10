/**
 * Distances, and how long they take.
 *
 * The travel times here are estimates and the app says so wherever it shows
 * one. Real transit times for Japan are not available without a paid API,
 * and a confident wrong number is worse than an admitted approximate one:
 * you would plan around it.
 *
 * What the estimate is good at is the thing that actually matters — telling
 * "these two are round the corner from each other" from "these two are
 * across the city". That is enough to stop an itinerary zig-zagging, which
 * is the whole point.
 */

export interface Point {
  lat: number
  lon: number
}

const EARTH_RADIUS_KM = 6371

/** Straight-line distance in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Straight-line distance underestimates a real route: streets bend, rivers
 * need bridges. A factor of about 1.3 is the usual correction for a dense
 * city grid.
 */
const DETOUR_FACTOR = 1.3

/** Below this you walk; above it you take a train. */
const WALKING_LIMIT_KM = 1.2
const WALKING_KMH = 4.5

/**
 * An effective transit speed, door to door. Deliberately well under a
 * train's actual speed: it has to absorb walking to the station, waiting,
 * and walking out the other end.
 */
const TRANSIT_KMH = 18
/** Fixed overhead per transit leg: stairs, ticket gates, a platform wait. */
const TRANSIT_OVERHEAD_MINUTES = 8

/** Roughly how many minutes to get from one place to another. */
export function travelMinutes(a: Point, b: Point): number {
  const km = haversineKm(a, b) * DETOUR_FACTOR
  if (km === 0) return 0
  if (km <= WALKING_LIMIT_KM) {
    return Math.round((km / WALKING_KMH) * 60)
  }
  return Math.round((km / TRANSIT_KMH) * 60 + TRANSIT_OVERHEAD_MINUTES)
}

/** How the trip between two stops would be made, for labelling. */
export function travelMode(a: Point, b: Point): 'walk' | 'transit' {
  return haversineKm(a, b) * DETOUR_FACTOR <= WALKING_LIMIT_KM ? 'walk' : 'transit'
}

/** Total minutes spent moving along a route, visits excluded. */
export function routeMinutes(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += travelMinutes(points[i - 1], points[i])
  }
  return total
}
