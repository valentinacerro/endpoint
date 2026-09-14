import { describe, expect, it } from 'vitest'

import type { BookingCreate, PlaceCreate, Stop } from '../api/types'

import { guessBooking, guessPlace, guessStop, isWaiting, waitingAttachment } from './optimistic'

/**
 * The row drawn for a write the server has not seen.
 *
 * What is worth pinning here is not the fields the form filled in — those
 * are copied — but the ones the server would have filled in instead. Get
 * one of those wrong and the app tells you something, then tells you
 * something else when the queue drains, with nothing in between to
 * explain why.
 */

/** Everything `PlaceCreate` insists on, so a case can state only its point. */
const place = (over: Partial<PlaceCreate> = {}): PlaceCreate => ({
  name: 'Senso-ji',
  category: 'sight',
  priority: 'normal',
  visit_minutes: 60,
  ...over,
})

const booking = (over: Partial<BookingCreate> = {}): BookingCreate => ({
  kind: 'flight',
  title: 'FCO to HND',
  status: 'confirmed',
  start_precision: 'datetime',
  end_precision: 'datetime',
  ...over,
})

describe('a place added with no network', () => {
  it('reads its own exposure from its category, as the server would', () => {
    // A temple is walked around, so rain spoils it. Guessing "misto"
    // here would put it on a wet afternoon and then move it silently.
    expect(guessPlace('t', 'p', place({ category: 'temple' })).weather_exposure).toBe('outdoor')
    expect(guessPlace('t', 'p', place({ category: 'museum' })).weather_exposure).toBe('indoor')
    expect(guessPlace('t', 'p', place({ category: 'food' })).weather_exposure).toBe('mixed')
  })

  it('does not overrule anything the form actually said', () => {
    const guessed = guessPlace(
      't',
      'p',
      place({
        category: 'viewpoint',
        weather_exposure: 'indoor',
        description: null,
        image_url: null,
        visit_minutes: 45,
        priority: 'must_see',
        opening_hours: { mon: [['10:00', '22:30']] },
      }),
    )
    expect(guessed.weather_exposure).toBe('indoor')
    expect(guessed.visit_minutes).toBe(45)
    expect(guessed.priority).toBe('must_see')
    expect(guessed.opening_hours).toEqual({ mon: [['10:00', '22:30']] })
  })

  it('carries the empty opening hours the server would store', () => {
    // The one field `PlaceCreate` lets a form leave out entirely. The
    // rest the form must state, so there is nothing here to guess.
    const guessed = guessPlace('t', 'p', place())
    expect(guessed.opening_hours).toEqual({})
    expect(guessed.trip_id).toBe('t')
    expect(guessed.id).toBe('p')
  })
})

describe('a city added with no network', () => {
  const stops = [
    { id: 'a', position: 0 },
    { id: 'b', position: 1 },
  ] as Stop[]

  it('goes on the end, where the server would put it', () => {
    expect(guessStop('t', 'c', { name: 'Kyoto', tz: 'Asia/Tokyo' }, stops).position).toBe(2)
  })

  it('stays where it was when it is a rewrite rather than a new city', () => {
    // Sending the same create again after correcting a typo must not
    // reorder the itinerary while the phone is in a pocket.
    const existing = [...stops, { id: 'c', position: 1 } as Stop]
    expect(guessStop('t', 'c', { name: 'Kyoto', tz: 'Asia/Tokyo' }, existing).position).toBe(1)
  })

  it('is the first stop when the trip has none yet', () => {
    expect(guessStop('t', 'c', { name: 'Kyoto', tz: 'Asia/Tokyo' }, undefined).position).toBe(0)
  })
})

describe('a booking recorded with no network', () => {
  it('carries the empty details the server would store', () => {
    expect(guessBooking('t', 'b', booking()).details).toEqual({})
  })

  it('keeps what the form said over that default', () => {
    const guessed = guessBooking('t', 'b', booking({ details: { room: 'twin' } }))
    expect(guessed.details).toEqual({ room: 'twin' })
  })
})


describe('a document still in the queue', () => {
  const voucher = () =>
    new File([new Uint8Array([1, 2, 3])], 'voucher.pdf', { type: 'application/pdf' })

  it('is told apart from one the server has', () => {
    // Three screens ask this, and the id is the only thing that can
    // answer: the server's is a uuid, so a prefix no uuid can carry is
    // what marks a stand-in.
    expect(isWaiting(waitingAttachment('t', voucher(), {}))).toBe(true)
    expect(isWaiting({ id: '0197c2a1-8c3d-7f5e-9a21-4d6b8e0f1a2c' } as never)).toBe(false)
  })

  it('carries what a row needs to be drawn, and claims nothing else', () => {
    const waiting = waitingAttachment('t', voucher(), { booking_id: 'b1', kind: 'voucher' })
    expect(waiting.filename).toBe('voucher.pdf')
    expect(waiting.byte_size).toBe(3)
    expect(waiting.booking_id).toBe('b1')
    expect(waiting.kind).toBe('voucher')
    // Attached to the booking, so not loose on the trip.
    expect(waiting.trip_id).toBeNull()
  })

  it('belongs to the trip when it is attached to nothing else', () => {
    expect(waitingAttachment('t', voucher(), {}).trip_id).toBe('t')
  })
})
