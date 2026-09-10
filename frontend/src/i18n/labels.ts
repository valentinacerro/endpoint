/**
 * Enum keys turned into readable labels.
 *
 * The maps are declared with `satisfies Record<Kind, TranslationKey>`, so
 * adding a value to an enum in the backend and regenerating the types makes
 * TypeScript demand the translation here. Without that, a new booking kind
 * would silently render as a raw key like "car_rental".
 */

import type { BookingKind, TripStatus } from '../api/types'
import { t, type TranslationKey } from './index'

const BOOKING_KIND_KEYS = {
  hotel: 'booking.kind.hotel',
  flight: 'booking.kind.flight',
  train: 'booking.kind.train',
  bus: 'booking.kind.bus',
  ferry: 'booking.kind.ferry',
  car_rental: 'booking.kind.car_rental',
  activity: 'booking.kind.activity',
  restaurant: 'booking.kind.restaurant',
  other: 'booking.kind.other',
} as const satisfies Record<BookingKind, TranslationKey>

const TRIP_STATUS_KEYS = {
  planned: 'trip.status.planned',
  active: 'trip.status.active',
  done: 'trip.status.done',
  archived: 'trip.status.archived',
} as const satisfies Record<TripStatus, TranslationKey>

export function bookingKindLabel(kind: BookingKind): string {
  return t(BOOKING_KIND_KEYS[kind])
}

export function tripStatusLabel(status: TripStatus): string {
  return t(TRIP_STATUS_KEYS[status])
}

/** A glyph per booking kind, so a timeline row is scannable at a glance. */
export const BOOKING_KIND_ICON: Record<BookingKind, string> = {
  hotel: '🛏',
  flight: '✈',
  train: '🚄',
  bus: '🚌',
  ferry: '⛴',
  car_rental: '🚗',
  activity: '🎫',
  restaurant: '🍜',
  other: '📌',
}
