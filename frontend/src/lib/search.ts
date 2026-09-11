/**
 * Finding one thing in a whole trip.
 *
 * Everything searched here is already in the cached bundle, so this works
 * in a basement with no signal — which is where you actually stand when
 * you need the confirmation code, not at a desk with wifi.
 *
 * No index is built. A fortnight in Japan is perhaps three hundred
 * records; scanning them takes under a millisecond, and an index would be
 * a second copy of the data to keep in step for no gain a person could
 * perceive.
 */

import type { TripBundle } from '../api/types'

import { alnum, fold, words } from './text'

export type ResultKind =
  | 'booking'
  | 'diary'
  | 'place'
  | 'stop'
  | 'expense'
  | 'checklist'
  | 'note'
  | 'document'

export interface Result {
  kind: ResultKind
  id: string
  title: string
  /** The second line: where it is, or what else matched. */
  detail: string | null
  /** Where tapping it goes. */
  to: string
  score: number
}

/**
 * How much a field is worth being found in.
 *
 * A hit in a name is what you meant; a hit in the notes is usually a
 * coincidence, and should not outrank it.
 */
const WEIGHT = {
  name: 4,
  /** Confirmation codes: rarely typed by accident, so a hit is decisive. */
  code: 4,
  secondary: 2,
  body: 1,
} as const

type Weight = (typeof WEIGHT)[keyof typeof WEIGHT]

interface Field {
  text: string
  weight: Weight
  /** Compare with punctuation stripped, for things people transcribe. */
  code?: boolean
}

function field(text: string | null | undefined, weight: Weight, code = false): Field[] {
  return text ? [{ text, weight, code }] : []
}

/**
 * How well one word matches one field, from 0 to 3.
 *
 * Three tiers rather than a similarity score: matching the whole field
 * beats starting a word in it, which beats appearing somewhere inside it.
 * Anything finer would be arithmetic nobody could predict from the
 * results they see.
 */
function quality(word: string, value: string): number {
  if (!value.includes(word)) return 0
  if (value === word) return 3
  // A word boundary: "gra" finds "Hotel Gracery", "cery" does not rank as
  // highly even though it is in there.
  if (value.startsWith(`${word} `) || value.includes(` ${word}`)) return 2
  return 1
}

function scoreField(word: string, entry: Field): number {
  const direct = quality(word, fold(entry.text))
  if (direct > 0) return direct * entry.weight
  if (!entry.code) return 0
  // "abc123" against "ABC-123": only worth trying on fields that are codes,
  // or every space-free query would start matching across word boundaries.
  const stripped = alnum(entry.text)
  const asked = alnum(word)
  if (!asked || !stripped.includes(asked)) return 0
  return (stripped === asked ? 3 : 1) * entry.weight
}

/**
 * Score one record against the whole query.
 *
 * Every word has to match something, or the result is dropped: typing two
 * words means you are narrowing down, and a list that widens as you type
 * is worse than no list.
 */
function score(fields: Field[], query: string[]): number {
  let total = 0
  for (const word of query) {
    const best = Math.max(0, ...fields.map((entry) => scoreField(word, entry)))
    if (best === 0) return 0
    total += best
  }
  return total
}

/** Trim a long note down to the part worth showing under a result. */
function excerpt(text: string, query: string[]): string {
  const folded = fold(text)
  const at = query.map((word) => folded.indexOf(word)).find((index) => index >= 0) ?? 0
  const from = Math.max(0, at - 24)
  const slice = text.slice(from, from + 90).trim()
  return `${from > 0 ? '…' : ''}${slice}${from + 90 < text.length ? '…' : ''}`
}

export function search(bundle: TripBundle, query: string): Result[] {
  const asked = words(query)
  if (asked.length === 0) return []

  const tripId = bundle.trip.id
  const stopName = new Map(bundle.stops.map((stop) => [stop.id, stop.name]))
  const results: Result[] = []

  const add = (result: Omit<Result, 'score'>, fields: Field[]) => {
    const points = score(fields, asked)
    if (points > 0) results.push({ ...result, score: points })
  }

  for (const booking of bundle.bookings) {
    add(
      {
        kind: 'booking',
        id: booking.id,
        title: booking.title,
        detail:
          booking.confirmation_code ??
          booking.provider ??
          (booking.stop_id ? (stopName.get(booking.stop_id) ?? null) : null),
        to: `/trips/${tripId}/bookings/${booking.id}`,
      },
      [
        ...field(booking.title, WEIGHT.name),
        ...field(booking.confirmation_code, WEIGHT.code, true),
        ...field(booking.provider, WEIGHT.secondary),
        ...field(booking.origin_label, WEIGHT.secondary),
        ...field(booking.destination_label, WEIGHT.secondary),
        ...field(booking.address, WEIGHT.secondary),
        ...field(booking.phone, WEIGHT.body, true),
        ...field(booking.notes, WEIGHT.body),
      ],
    )
  }

  for (const place of bundle.places) {
    add(
      {
        kind: 'place',
        id: place.id,
        title: place.name,
        detail: place.address ?? (place.stop_id ? (stopName.get(place.stop_id) ?? null) : null),
        to: `/trips/${tripId}/places`,
      },
      [
        ...field(place.name, WEIGHT.name),
        ...field(place.address, WEIGHT.secondary),
        ...field(place.notes, WEIGHT.body),
      ],
    )
  }

  for (const stop of bundle.stops) {
    add(
      {
        kind: 'stop',
        id: stop.id,
        title: stop.name,
        detail: stop.arrive_date,
        to: `/trips/${tripId}/stops`,
      },
      [...field(stop.name, WEIGHT.name), ...field(stop.notes, WEIGHT.body)],
    )
  }

  for (const expense of bundle.expenses) {
    add(
      {
        kind: 'expense',
        id: expense.id,
        title: expense.description,
        detail: `${expense.amount} ${expense.currency} · ${expense.spent_at}`,
        to: `/trips/${tripId}/expenses`,
      },
      [...field(expense.description, WEIGHT.name), ...field(expense.notes, WEIGHT.body)],
    )
  }

  for (const item of bundle.checklist) {
    add(
      {
        kind: 'checklist',
        id: item.id,
        title: item.text,
        detail: null,
        to: `/trips/${tripId}/packing`,
      },
      field(item.text, WEIGHT.name),
    )
  }

  for (const note of bundle.day_notes) {
    add(
      {
        kind: 'note',
        id: note.day,
        title: note.day,
        detail: excerpt(note.note, asked),
        to: `/trips/${tripId}`,
      },
      field(note.note, WEIGHT.body),
    )
  }

  for (const entry of bundle.diary) {
    add(
      {
        kind: 'diary',
        id: entry.day,
        title: entry.day,
        detail: excerpt(entry.text, asked),
        to: `/trips/${tripId}/diary`,
      },
      // Weighted as body text: it is prose, and a word appearing in a
      // paragraph you wrote is weaker evidence than one in a name.
      field(entry.text, WEIGHT.body),
    )
  }

  for (const document of bundle.attachments) {
    add(
      {
        kind: 'document',
        id: document.id,
        title: document.filename,
        detail: null,
        to: document.booking_id
          ? `/trips/${tripId}/bookings/${document.booking_id}`
          : `/trips/${tripId}`,
      },
      field(document.filename, WEIGHT.name),
    )
  }

  // Ties broken by title so the order does not shuffle between renders —
  // a list that reorders under your thumb is how you tap the wrong thing.
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}
