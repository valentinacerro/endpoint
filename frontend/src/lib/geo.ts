/**
 * Distances, and how long they take.
 *
 * The distances are good. Measured against real routing over eight pairs
 * in central Tokyo, the straight line times a detour factor lands within
 * about a tenth of the routed walking distance, and usually within five
 * per cent.
 *
 * The TIMES are estimates, and the app says so wherever it shows one. No
 * straight line knows whether a railway joins two points, so a leg that
 * happens to sit on one line comes out long: Senso-ji to Shibuya is
 * fifty-four minutes here against a real thirty-five. Real transit times
 * for Japan need either a paid API or a routing server this app will
 * never have — the GTFS data is open, running OpenTripPlanner on it is
 * not free.
 *
 * What the estimate is good at is the thing that actually matters for an
 * order — telling "round the corner" from "across the city" — and where
 * that is not good enough, `known` carries a number you looked up
 * yourself, which beats any model.
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
 * need bridges.
 *
 * Measured rather than assumed, against OSRM's walking router, on real
 * places in three cities chosen to break it:
 *
 *   Tokyo, a dense grid       mean 1.21, worst 1.36
 *   Venice, canals            mean 1.28, worst 1.42
 *   Lisbon, hills             mean 1.31, worst 1.86 (Castelo to Graça)
 *
 * 1.3 sits inside all three. This was checked because replacing the
 * estimate with real routed walking was on the list, and the measurement
 * said not to: on legs short enough to walk, the estimate is on average
 * half a minute from the routed time and three minutes off at worst —
 * noise beside how long you spend anywhere. A network call, a cache and a
 * failure mode to buy that is a bad trade.
 *
 * What the measurement did find worth fixing is in `travelMinutes` below:
 * the TIME, not the distance.
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

/**
 * A leg whose time you checked, keyed the way the server keys it.
 *
 * Four decimals, about eleven metres: inside the disagreement between two
 * geocoders about one building, and far below the distance at which a
 * journey changes.
 */
export type Known = ReadonlyMap<string, number>

export function legKey(a: Point, b: Point): string {
  const round = (value: number) => value.toFixed(4)
  return `${round(a.lat)},${round(a.lon)}>${round(b.lat)},${round(b.lon)}`
}

/** Roughly how many minutes to get from one place to another. */
export function travelMinutes(a: Point, b: Point, known?: Known): number {
  const looked = known?.get(legKey(a, b))
  // A number you checked is not an estimate and is not adjusted.
  if (looked !== undefined) return looked

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
export function routeMinutes(points: Point[], known?: Known): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += travelMinutes(points[i - 1], points[i], known)
  }
  return total
}

/** The corrections from a trip, ready to be asked. */
export function knownLegs(
  legs: readonly { from_lat: number; from_lon: number; to_lat: number; to_lon: number; minutes: number }[],
): Known {
  return new Map(
    legs.map((leg) => [
      legKey({ lat: leg.from_lat, lon: leg.from_lon }, { lat: leg.to_lat, lon: leg.to_lon }),
      leg.minutes,
    ]),
  )
}
