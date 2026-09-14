import { describe, expect, it } from 'vitest'

import type { Place, Stop, TripBundle } from '../api/types'
import { startingOut } from './FirstSteps'

/**
 * The order these three steps are in is the answer to "what do I do
 * first", so the conditions that retire them are worth pinning down. A
 * stop without a position does not count: it is exactly the case that
 * makes the weather, the map and the suggestions all silently do nothing.
 */

const stop = (over: Partial<Stop> = {}): Stop =>
  ({ id: 's1', trip_id: 't1', name: 'Tokyo', tz: 'Asia/Tokyo', lat: 35.68, lon: 139.76, ...over }) as Stop

const place = (over: Partial<Place> = {}): Place =>
  ({
    id: 'p1',
    trip_id: 't1',
    name: 'Senso-ji',
    category: 'temple',
    lat: 35.71,
    lon: 139.79,
    planned_start_at: null,
    ...over,
  }) as Place

const bundle = (over: Partial<TripBundle> = {}): TripBundle =>
  ({ stops: [], places: [], bookings: [], ...over }) as TripBundle

describe('whether the trip is still being set up', () => {
  it('is, when it is empty', () => {
    expect(startingOut(bundle())).toBe(true)
  })

  it('still is when the only stop has no position', () => {
    // The case worth naming: a stop typed by hand and never located looks
    // done and makes every other feature quietly return nothing.
    //
    // The other two steps are finished here on purpose, so the position
    // is the only thing this can be failing on. Without that, the answer
    // would be "still starting out" whatever the stop said, and the test
    // would pass while proving nothing — which is how it was first
    // written, and how sabotage found it.
    const planned = place({ planned_start_at: '2026-04-12T01:00:00Z' })
    const unlocated = bundle({ stops: [stop({ lat: null, lon: null })], places: [planned] })
    expect(startingOut(unlocated)).toBe(true)
    expect(startingOut(bundle({ stops: [stop()], places: [planned] }))).toBe(false)
  })

  it('still is with places collected but none given a day', () => {
    expect(startingOut(bundle({ stops: [stop()], places: [place()] }))).toBe(true)
  })

  it('is finished once a place has a day', () => {
    const planned = place({ planned_start_at: '2026-04-12T01:00:00Z' })
    expect(startingOut(bundle({ stops: [stop()], places: [planned] }))).toBe(false)
  })

  it('is not finished by bookings, however many there are', () => {
    // You can add a flight and a hotel and still have collected nowhere to
    // go, so a trip with bookings and nothing else is still starting out.
    const withBookings = bundle({
      stops: [stop()],
      bookings: [{ id: 'b1' }, { id: 'b2' }] as never,
    })
    expect(startingOut(withBookings)).toBe(true)
  })
})
