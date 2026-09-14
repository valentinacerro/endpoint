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

import type {
  Attachment,
  Booking,
  BookingCreate,
  Place,
  PlaceCreate,
  Stop,
  StopCreate,
} from '../api/types'

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

/**
 * A document that is on the phone but not yet on the server.
 *
 * Its id is deliberately not a uuid: the id is the server's to give, and
 * `pending:` is what tells the list to show the file without a link to
 * bytes nobody can fetch yet. The same trick the diary already uses.
 */
export function waitingAttachment(
  tripId: string,
  file: File,
  fields: Record<string, string>,
): Attachment {
  const now = new Date().toISOString()
  return {
    id: `pending:${now}:${file.name}`,
    trip_id: fields.booking_id || fields.stop_id ? null : tripId,
    stop_id: fields.stop_id ?? null,
    booking_id: fields.booking_id ?? null,
    kind: fields.kind ?? 'other',
    filename: file.name,
    // The server decides this from the bytes, never from the browser's
    // claim, so this is only what the list needs to draw a row.
    content_type: file.type,
    byte_size: file.size,
    // Neither is known here, and nothing on the phone reads either: the
    // digest is computed by the server from the bytes it receives, and
    // where the file lives is its decision too. They are here because the
    // row has to have the shape of a row.
    sha256: '',
    storage: 'db',
    created_at: now,
    updated_at: now,
  } as Attachment
}

/**
 * Is this a document the server has never seen?
 *
 * Asked in three places, and for three different reasons: the list draws
 * it without controls that need bytes, the offline screen does not offer
 * to download what cannot be downloaded, and the reminder does not count
 * it among the documents still to be saved — it is on the phone already,
 * which is the only reason it exists.
 */
export function isWaiting(attachment: Attachment): boolean {
  return attachment.id.startsWith('pending:')
}
