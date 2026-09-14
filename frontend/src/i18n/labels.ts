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
  ChecklistCategory,
  ExpenseCategory,
  PaymentMethod,
  PlaceCategory,
  Priority,
  TripStatus,
  WeatherExposure,
} from '../api/types'
import type { IconName } from '../components/Icon'
import type { ResultKind } from '../lib/search'
import type { Sky } from '../lib/weather'
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

const EXPENSE_CATEGORY_KEYS = {
  food: 'money.category.food',
  transport: 'money.category.transport',
  lodging: 'money.category.lodging',
  tickets: 'money.category.tickets',
  shopping: 'money.category.shopping',
  gifts: 'money.category.gifts',
  fees: 'money.category.fees',
  other: 'money.category.other',
} as const satisfies Record<ExpenseCategory, TranslationKey>

const PAYMENT_KEYS = {
  cash: 'money.payment.cash',
  card: 'money.payment.card',
} as const satisfies Record<PaymentMethod, TranslationKey>

const CHECKLIST_CATEGORY_KEYS = {
  documents: 'packing.category.documents',
  clothes: 'packing.category.clothes',
  electronics: 'packing.category.electronics',
  toiletries: 'packing.category.toiletries',
  health: 'packing.category.health',
  other: 'packing.category.other',
} as const satisfies Record<ChecklistCategory, TranslationKey>

export function checklistCategoryLabel(category: ChecklistCategory): string {
  return t(CHECKLIST_CATEGORY_KEYS[category])
}

const SKY_KEYS = {
  clear: 'weather.sky.clear',
  cloudy: 'weather.sky.cloudy',
  fog: 'weather.sky.fog',
  rain: 'weather.sky.rain',
  snow: 'weather.sky.snow',
  storm: 'weather.sky.storm',
} as const satisfies Record<Sky, TranslationKey>

export function skyLabel(sky: Sky): string {
  return t(SKY_KEYS[sky])
}

const SEARCH_KIND_KEYS = {
  booking: 'search.kind.booking',
  place: 'search.kind.place',
  stop: 'search.kind.stop',
  expense: 'search.kind.expense',
  checklist: 'search.kind.checklist',
  note: 'search.kind.note',
  diary: 'search.kind.diary',
  document: 'search.kind.document',
} as const satisfies Record<ResultKind, TranslationKey>

export function searchKindLabel(kind: ResultKind): string {
  return t(SEARCH_KIND_KEYS[kind])
}

export function expenseCategoryLabel(category: ExpenseCategory): string {
  return t(EXPENSE_CATEGORY_KEYS[category])
}

export function paymentLabel(method: PaymentMethod): string {
  return t(PAYMENT_KEYS[method])
}

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

/**
 * A drawn icon per booking kind, so a timeline row is scannable.
 *
 * A name rather than a glyph: emoji are a different drawing on every
 * system, carry colours that fight the palette, cannot take the weight
 * of the text beside them, and print as boxes.
 */
export const BOOKING_KIND_ICON: Record<BookingKind, IconName> = {
  hotel: 'hotel',
  flight: 'flight',
  train: 'train',
  bus: 'bus',
  ferry: 'ferry',
  car_rental: 'car',
  activity: 'ticket',
  restaurant: 'food',
  other: 'pin',
}

/** The same, for the categories a place can have. */
export const PLACE_CATEGORY_ICON: Record<PlaceCategory, IconName> = {
  sight: 'pin',
  museum: 'museum',
  temple: 'temple',
  shrine: 'temple',
  park: 'park',
  garden: 'park',
  shopping: 'shop',
  food: 'food',
  viewpoint: 'view',
  experience: 'ticket',
  other: 'pin',
}


/**
 * What a booking's fields are called, for the kind it actually is.
 *
 * "Start" and "End" are what a database calls them. A hotel has a
 * check-in and a check-out; a flight departs and lands; a restaurant just
 * has a time. Asking every kind the same abstract question is how a form
 * with nine fields becomes unreadable — the fields were never the
 * problem, the words on them were.
 */
export interface BookingWords {
  title: TranslationKey
  start: TranslationKey
  end: TranslationKey
}

const TRAVEL_WORDS: BookingWords = {
  title: 'booking.words.travel.title',
  start: 'booking.words.travel.start',
  end: 'booking.words.travel.end',
}

const BY_KIND: Partial<Record<BookingKind, BookingWords>> = {
  flight: TRAVEL_WORDS,
  train: TRAVEL_WORDS,
  bus: TRAVEL_WORDS,
  ferry: TRAVEL_WORDS,
  hotel: {
    title: 'booking.words.hotel.title',
    start: 'booking.words.hotel.start',
    end: 'booking.words.hotel.end',
  },
  car_rental: {
    title: 'booking.words.car.title',
    start: 'booking.words.car.start',
    end: 'booking.words.car.end',
  },
  restaurant: {
    title: 'booking.words.restaurant.title',
    start: 'booking.words.restaurant.start',
    end: 'booking.words.restaurant.end',
  },
  activity: {
    title: 'booking.words.activity.title',
    start: 'booking.words.activity.start',
    end: 'booking.words.activity.end',
  },
}

const PLAIN: BookingWords = {
  title: 'booking.field.title',
  start: 'booking.field.start',
  end: 'booking.field.end',
}

export function bookingWords(kind: BookingKind): BookingWords {
  return BY_KIND[kind] ?? PLAIN
}
