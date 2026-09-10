import { describe, expect, it } from 'vitest'

import type { Booking, Place } from '../api/types'
import type { Day, PlacedEntry } from '../lib/itinerary'
import { pinsFor } from './MapView'

function bookingEntry(over: Partial<Booking>): PlacedEntry {
  const booking = {
    id: over.id ?? crypto.randomUUID(),
    kind: 'hotel',
    title: 'Gracery',
    lat: null,
    lon: null,
    ...over,
  } as Booking
  return {
    entry: { type: 'booking', id: booking.id, startAt: '', busyUntil: null, zone: 'Asia/Tokyo', booking },
    gapMinutes: null,
    overlaps: false,
  }
}

function placeEntry(over: Partial<Place>): PlacedEntry {
  const place = {
    id: over.id ?? crypto.randomUUID(),
    name: 'Senso-ji',
    category: 'temple',
    lat: null,
    lon: null,
    ...over,
  } as Place
  return {
    entry: { type: 'place', id: place.id, startAt: '', busyUntil: '', zone: 'Asia/Tokyo', place },
    gapMinutes: null,
    overlaps: false,
  }
}

const day = (entries: PlacedEntry[]): Day => ({ key: '2026-04-13', number: 3, entries, stop: null })

describe('turning a day into map pins', () => {
  it('numbers the pins in the order of the day', () => {
    const result = pinsFor([
      day([
        placeEntry({ name: 'primo', lat: 35.7, lon: 139.8 }),
        bookingEntry({ title: 'secondo', lat: 35.6, lon: 139.7 }),
      ]),
    ])
    expect(result.pins.map((pin) => [pin.order, pin.label])).toEqual([
      [1, 'primo'],
      [2, 'secondo'],
    ])
  })

  it('keeps numbering across days when the whole trip is shown', () => {
    const result = pinsFor([
      day([placeEntry({ name: 'a', lat: 1, lon: 1 })]),
      day([placeEntry({ name: 'b', lat: 2, lon: 2 })]),
    ])
    expect(result.pins.map((pin) => pin.order)).toEqual([1, 2])
  })

  it('counts what it had to leave off instead of hiding it', () => {
    // A place with no coordinates is not on the map, and pretending the
    // day is fully mapped would be worse than saying so.
    const result = pinsFor([
      day([
        placeEntry({ name: 'con posizione', lat: 35.7, lon: 139.8 }),
        placeEntry({ name: 'senza posizione' }),
        bookingEntry({ title: 'nemmeno questo' }),
      ]),
    ])
    expect(result.pins).toHaveLength(1)
    expect(result.missing).toBe(2)
  })

  it('does not treat a coordinate of zero as missing', () => {
    const result = pinsFor([day([placeEntry({ name: 'golfo di Guinea', lat: 0, lon: 0 })])])
    expect(result.pins).toHaveLength(1)
    expect(result.missing).toBe(0)
  })

  it('colours a pin by what it is', () => {
    const result = pinsFor([
      day([
        bookingEntry({ title: 'volo', kind: 'flight', lat: 1, lon: 1 }),
        bookingEntry({ title: 'hotel', kind: 'hotel', lat: 1, lon: 1 }),
        placeEntry({ name: 'pranzo', category: 'food', lat: 1, lon: 1 }),
        placeEntry({ name: 'tempio', category: 'temple', lat: 1, lon: 1 }),
      ]),
    ])
    expect(result.pins.map((pin) => pin.kind)).toEqual(['travel', 'stay', 'food', 'see'])
  })
})
