/**
 * Domain types, taken from the backend's own OpenAPI schema.
 *
 * `schema.d.ts` is generated — never edit it by hand. Run `make types` after
 * changing anything in the backend's schemas, and TypeScript will point at
 * every place that needs updating. Hand-written duplicates of these types
 * would drift, and the drift would only show up at runtime.
 */

import type { components } from './schema'

type S = components['schemas']

export type Trip = S['TripRead']
export type TripCreate = S['TripCreate']
export type TripUpdate = S['TripUpdate']

export type Stop = S['StopRead']
export type StopCreate = S['StopCreate']
export type StopUpdate = S['StopUpdate']

export type Booking = S['BookingRead']
export type BookingCreate = S['BookingCreate']
export type BookingUpdate = S['BookingUpdate']

export type Place = S['PlaceRead']
export type PlaceCreate = S['PlaceCreate']
export type PlaceUpdate = S['PlaceUpdate']

export type DayNote = S['DayNoteRead']

export type DiaryEntry = S['DiaryEntryRead']

export type Memory = S['MemoryRead']
export type MemoryWrite = S['MemoryWrite']

export type Expense = S['ExpenseRead']
export type ExpenseWrite = S['ExpenseWrite']
export type ExpenseCategory = Expense['category']
export type PaymentMethod = Expense['payment_method']

export const EXPENSE_CATEGORIES = [
  'food',
  'transport',
  'lodging',
  'tickets',
  'shopping',
  'gifts',
  'fees',
  'other',
] as const satisfies readonly ExpenseCategory[]

export type PlaceHit = S['HitOut']

export type Weather = S['WeatherOut']
export type ResolvedPlace = S['ResolveOut']
export type DayWeather = S['DayWeatherOut']

export type ChecklistItem = S['ChecklistItemRead']
export type ChecklistItemWrite = S['ChecklistItemWrite']
export type ChecklistCategory = ChecklistItem['category']

/** Roughly the order you actually pack in: papers first, then the bag. */
export const CHECKLIST_CATEGORIES = [
  'documents',
  'clothes',
  'electronics',
  'toiletries',
  'health',
  'other',
] as const satisfies readonly ChecklistCategory[]

export type Attachment = S['AttachmentRead']
export type TripBundle = S['TripBundle']

export type BookingKind = Booking['kind']
export type BookingStatus = Booking['status']
export type TripStatus = Trip['status']
export type PlaceCategory = Place['category']
export type Priority = Place['priority']
export type WeatherExposure = Place['weather_exposure']
export type AttachmentKind = Attachment['kind']

/** Every booking kind, in the order the picker should offer them. */
export const BOOKING_KINDS = [
  'hotel',
  'flight',
  'train',
  'bus',
  'ferry',
  'car_rental',
  'activity',
  'restaurant',
  'other',
] as const satisfies readonly BookingKind[]

export const PLACE_CATEGORIES = [
  'sight',
  'museum',
  'temple',
  'shrine',
  'park',
  'garden',
  'viewpoint',
  'food',
  'shopping',
  'experience',
  'other',
] as const satisfies readonly PlaceCategory[]
