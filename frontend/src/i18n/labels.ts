/**
 * Enum keys turned into readable labels.
 *
 * The maps are declared with `satisfies Record<Kind, TranslationKey>`, so
 * adding a value to an enum in the backend and regenerating the types makes
 * TypeScript demand the translation here. Without that, a new booking kind
 * would silently render as a raw key like "car_rental".
 */

import type {
  BookingKind,
  PlaceCategory,
  Priority,
  TripStatus,
  WeatherExposure,
} from '../api/types'
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

const PLACE_CATEGORY_KEYS = {
  sight: 'places.category.sight',
  museum: 'places.category.museum',
  temple: 'places.category.temple',
  shrine: 'places.category.shrine',
  park: 'places.category.park',
  garden: 'places.category.garden',
  shopping: 'places.category.shopping',
  food: 'places.category.food',
  viewpoint: 'places.category.viewpoint',
  experience: 'places.category.experience',
  other: 'places.category.other',
} as const satisfies Record<PlaceCategory, TranslationKey>

const PRIORITY_KEYS = {
  must_see: 'places.priority.must_see',
  high: 'places.priority.high',
  normal: 'places.priority.normal',
  low: 'places.priority.low',
} as const satisfies Record<Priority, TranslationKey>

const EXPOSURE_KEYS = {
  indoor: 'places.exposure.indoor',
  outdoor: 'places.exposure.outdoor',
  mixed: 'places.exposure.mixed',
} as const satisfies Record<WeatherExposure, TranslationKey>

export function bookingKindLabel(kind: BookingKind): string {
  return t(BOOKING_KIND_KEYS[kind])
}

export function placeCategoryLabel(category: PlaceCategory): string {
  return t(PLACE_CATEGORY_KEYS[category])
}

export function priorityLabel(priority: Priority): string {
  return t(PRIORITY_KEYS[priority])
}

export function exposureLabel(exposure: WeatherExposure): string {
  return t(EXPOSURE_KEYS[exposure])
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
