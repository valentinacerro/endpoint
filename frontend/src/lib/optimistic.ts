/**
 * What the server would have stored, drawn before it has been asked.
 *
 * A write made with no network is queued and the screen carries on as
 * though it had landed. These build the row that stands in for it until
 * the queue drains — which means they have to agree with the server about
 * every field the server fills in on its own. Where they do not, a place
 * added underground shows one thing and then quietly changes its mind
 * hours later, which is worse than showing nothing.
 */

import type { Booking, BookingCreate, Place, PlaceCreate, Stop, StopCreate } from '../api/types'

import { defaultExposure } from './exposure'

export function guessPlace(tripId: string, id: string, body: PlaceCreate): Place {
  const now = new Date().toISOString()
  return {
    opening_hours: {},
    ...body,
    // Derived server-side from the category when the form leaves it out.
    // Guessed here so a temple added with no network says "all'aperto" on
    // its own row straight away, instead of saying the wrong thing and
    // quietly changing its mind when the queue drains.
    weather_exposure: body.weather_exposure ?? defaultExposure(body.category),
    id,
    trip_id: tripId,
    created_at: now,
    updated_at: now,
  } as Place
}

export function guessStop(
  tripId: string,
  id: string,
  body: StopCreate,
  existing: readonly Stop[] | undefined,
): Stop {
  const now = new Date().toISOString()
  return {
    ...body,
    id,
    trip_id: tripId,
    position: existing?.find((stop) => stop.id === id)?.position ?? existing?.length ?? 0,
    created_at: now,
    updated_at: now,
  } as Stop
}

export function guessBooking(tripId: string, id: string, body: BookingCreate): Booking {
  const now = new Date().toISOString()
  // `details` is the only thing the server fills in that the body may
  // leave out. Everything else is either required by `BookingCreate` or
  // absent, which a screen reads the same as null.
  return {
    details: {},
    ...body,
    id,
    trip_id: tripId,
    created_at: now,
    updated_at: now,
  } as Booking
}
