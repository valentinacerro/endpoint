/**
 * What of yours is near you right now.
 *
 * Deliberately not a guide: it searches the places *you* saved, not a
 * third-party database of points of interest. Three reasons, in order of
 * weight. It works with no signal, because your places are already in the
 * cached bundle and the phone's GPS needs no network. It sends your
 * position to nobody — the coordinates never leave the device, which is
 * the whole point given that the reason this app exists is not wanting
 * travel data scattered around. And a list of things you already chose is
 * more useful on a street corner than a thousand you did not.
 */

import type { Booking, Place } from '../api/types'

import { dayKeyInZone, minutesOfDayInZone, type CalendarDate } from './datetime'
import { haversineKm, travelMinutes, travelMode, type Point } from './geo'
import { opennessOn, type OpeningHours } from './optimizer'

export type OpenState =
  | { kind: 'unknown' }
  | { kind: 'closed' }
  | { kind: 'open'; closesInMinutes: number }

export interface NearbyItem {
  kind: 'place' | 'booking'
  id: string
  name: string
  km: number
  minutes: number
  mode: 'walk' | 'transit'
  open: OpenState
  /** The day it is already planned for, if it is. */
  plannedDay: CalendarDate | null
  point: Point
  /** Where tapping it goes. */
  to: string
}

/**
 * Is it open at this moment, and for how much longer?
 *
 * The remaining time is not decoration: walking twenty-five minutes to
 * something that shuts in twenty is the mistake this is here to prevent.
 * Unknown stays its own answer, as everywhere else that reads opening
 * hours — almost nothing imported from Maps carries them.
 */
export function openState(hours: OpeningHours, zone: string, now: Date): OpenState {
  const instant = now.toISOString()
  const openness = opennessOn(hours, dayKeyInZone(instant, zone))
  if (openness.kind !== 'open') return openness

  const minutes = minutesOfDayInZone(instant, zone)
  for (const [opens, closes] of openness.windows) {
    if (minutes >= opens && minutes < closes) {
      return { kind: 'open', closesInMinutes: closes - minutes }
    }
  }
  return { kind: 'closed' }
}

interface Options {
  places: readonly Place[]
  /** Hotels and the like: knowing the way back matters most of all. */
  bookings: readonly Booking[]
  from: Point
  /** The zone whose clock decides whether something is open. */
  zone: string
  tripId: string
  now?: Date
  /** Anything further than this is not "nearby" in any useful sense. */
  withinKm?: number
}

/**
 * What counts as "around here": one city, not one neighbourhood.
 *
 * Measured against the real thing rather than picked round. From
 * Shinjuku, Shinjuku Gyoen is 1 km, Tsukiji 6.9, Ueno 7.3 and Senso-ji
 * 9.1 — all plainly the same city and all places you would cross town
 * for on a free afternoon. Kyoto is 365, and has no business in the
 * list. Five kilometres, the tempting round number, would have cut off
 * Asakusa.
 */
const DEFAULT_RADIUS_KM = 10

/**
 * Your saved places and bookings, nearest first.
 *
 * Anything without coordinates is absent — not because it does not
 * matter, but because there is nothing truthful to say about how far away
 * it is. The screen counts those separately so their absence is visible
 * rather than silent.
 */
export function nearby({
  places,
  bookings,
  from,
  zone,
  tripId,
  now = new Date(),
  withinKm = DEFAULT_RADIUS_KM,
}: Options): NearbyItem[] {
  const items: NearbyItem[] = []

  for (const place of places) {
    if (place.lat === null || place.lon === null) continue
    const point = { lat: place.lat, lon: place.lon }
    items.push({
      kind: 'place',
      id: place.id,
      name: place.name,
      km: haversineKm(from, point),
      minutes: travelMinutes(from, point),
      mode: travelMode(from, point),
      open: openState((place.opening_hours ?? {}) as OpeningHours, place.planned_tz ?? zone, now),
      plannedDay: place.planned_start_at
        ? dayKeyInZone(place.planned_start_at, place.planned_tz ?? zone)
        : null,
      point,
      to: `/trips/${tripId}/places`,
    })
  }

  for (const booking of bookings) {
    if (booking.lat === null || booking.lon === null) continue
    const point = { lat: booking.lat, lon: booking.lon }
    items.push({
      kind: 'booking',
      id: booking.id,
      name: booking.title,
      km: haversineKm(from, point),
      minutes: travelMinutes(from, point),
      mode: travelMode(from, point),
      // A booking has an appointed hour rather than opening hours; saying
      // "unknown" is honest, and inventing a window would not be.
      open: { kind: 'unknown' },
      plannedDay: booking.start_at
        ? dayKeyInZone(booking.start_at, booking.start_tz ?? zone)
        : null,
      point,
      to: `/trips/${tripId}/bookings/${booking.id}`,
    })
  }

  return items
    .filter((item) => item.km <= withinKm)
    .sort((a, b) => a.km - b.km || a.name.localeCompare(b.name))
}

/** How many of your places could not be placed on the map at all. */
export function withoutCoordinates(places: readonly Place[], bookings: readonly Booking[]): number {
  const blindPlaces = places.filter((place) => place.lat === null || place.lon === null).length
  const blindBookings = bookings.filter(
    (booking) => booking.lat === null || booking.lon === null,
  ).length
  return blindPlaces + blindBookings
}

/** Metres below a kilometre, one decimal above: what a person would say. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}
