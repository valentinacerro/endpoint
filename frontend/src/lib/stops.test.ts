import { describe, expect, it } from 'vitest'

import type { Booking, Place, Stop, TripBundle } from '../api/types'

import { bandFor, cityOf, inferStops, stopCentres } from './stops'

const SHINJUKU = { lat: 35.6896, lon: 139.7006 }
const SENSOJI = { lat: 35.7148, lon: 139.7967 }
const NARITA = { lat: 35.772, lon: 140.3929 }
const KYOTO = { lat: 34.9858, lon: 135.7588 }
const FUSHIMI = { lat: 34.9671, lon: 135.7727 }
const NIKKO = { lat: 36.7199, lon: 139.6982 }

function stop(partial: Partial<Stop> & { id: string; name: string }): Stop {
  return {
    trip_id: 'trip',
    country_code: 'JP',
    tz: 'Asia/Tokyo',
    arrive_date: null,
    depart_date: null,
    position: 0,
    lat: null,
    lon: null,
    notes: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

function place(partial: Partial<Place> & { id: string }): Place {
  return {
    trip_id: 'trip',
    stop_id: null,
    name: partial.id,
    category: 'sight',
    priority: 'normal',
    weather_exposure: 'mixed',
    lat: null,
    lon: null,
    address: null,
    url: null,
    notes: null,
    visit_minutes: 60,
    planned_start_at: null,
    planned_tz: null,
    opening_hours: {},
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

function hotel(partial: Partial<Booking> & { id: string }): Booking {
  return {
    trip_id: 'trip',
    stop_id: null,
    kind: 'hotel',
    status: 'confirmed',
    title: partial.id,
    provider: null,
    confirmation_code: null,
    start_at: null,
    start_tz: null,
    start_precision: 'datetime',
    end_at: null,
    end_tz: null,
    end_precision: 'datetime',
    origin_label: null,
    destination_label: null,
    address: null,
    phone: null,
    url: null,
    lat: null,
    lon: null,
    price_amount: null,
    price_currency: null,
    details: {},
    notes: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

function bundle(partial: Partial<TripBundle> = {}): TripBundle {
  return {
    trip: {
      id: 'trip',
      title: 'Japan',
      destination_label: null,
      start_date: '2026-04-12',
      end_date: '2026-04-20',
      primary_tz: 'Asia/Tokyo',
      primary_currency: 'JPY',
      budget_amount: null,
      status: 'planned',
      notes: null,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    },
    stops: [],
    bookings: [],
    places: [],
    checklist: [],
    expenses: [],
    day_notes: [],
    diary: [],
    memories: [],
    travel_times: [],
    attachments: [],
    generated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

describe('bandFor', () => {
  it('calls crossing the city crossing the city', () => {
    // Yokohama is 28 km from Shinjuku and is an afternoon.
    expect(bandFor(1)).toBe('city')
    expect(bandFor(28)).toBe('city')
  })

  it('calls a day out a day out', () => {
    // Nara 34, Hakone 74, Nikkō 115 — none of which fits in an afternoon.
    expect(bandFor(34)).toBe('day_trip')
    expect(bandFor(115)).toBe('day_trip')
  })

  it('calls another city another city', () => {
    expect(bandFor(366)).toBe('far')
  })
})

describe('stopCentres', () => {
  it('believes the stop when it has a position of its own', () => {
    const tokyo = stop({ id: 's1', name: 'Tokyo', ...SHINJUKU })
    const centres = stopCentres(bundle({ stops: [tokyo] }))
    expect(centres.get('s1')).toEqual({ ...SHINJUKU, from: 'stop' })
  })

  it('falls back to the places you assigned by hand', () => {
    // The bootstrap: assign one place in Kyoto and the rest follow.
    const kyoto = stop({ id: 's2', name: 'Kyoto' })
    const centres = stopCentres(
      bundle({
        stops: [kyoto],
        places: [place({ id: 'p1', stop_id: 's2', ...FUSHIMI })],
      }),
    )
    expect(centres.get('s2')?.from).toBe('places')
    expect(centres.get('s2')?.lat).toBeCloseTo(FUSHIMI.lat, 3)
  })

  it('falls back to the hotels you are staying in on those dates', () => {
    const tokyo = stop({
      id: 's1',
      name: 'Tokyo',
      arrive_date: '2026-04-12',
      depart_date: '2026-04-16',
    })
    const centres = stopCentres(
      bundle({
        stops: [tokyo],
        bookings: [
          hotel({
            id: 'b1',
            ...SHINJUKU,
            start_at: '2026-04-12T06:00:00Z',
            start_tz: 'Asia/Tokyo',
            end_at: '2026-04-16T02:00:00Z',
            end_tz: 'Asia/Tokyo',
          }),
        ],
      }),
    )
    expect(centres.get('s1')?.from).toBe('hotels')
  })

  it('does not take a hotel from a different leg of the trip', () => {
    const tokyo = stop({
      id: 's1',
      name: 'Tokyo',
      arrive_date: '2026-04-12',
      depart_date: '2026-04-16',
    })
    const kyotoHotel = hotel({
      id: 'b2',
      ...KYOTO,
      start_at: '2026-04-17T06:00:00Z',
      start_tz: 'Asia/Tokyo',
      end_at: '2026-04-20T02:00:00Z',
      end_tz: 'Asia/Tokyo',
    })
    const centres = stopCentres(bundle({ stops: [tokyo], bookings: [kyotoHotel] }))
    expect(centres.has('s1')).toBe(false)
  })

  it('takes a real point off centre over a computed point in the sea', () => {
    // The average of Shinjuku, Sensō-ji and Narita sits well east of
    // anything; the medoid is Sensō-ji, which is a place.
    const tokyo = stop({ id: 's1', name: 'Tokyo' })
    const centres = stopCentres(
      bundle({
        stops: [tokyo],
        places: [
          place({ id: 'a', stop_id: 's1', ...SHINJUKU }),
          place({ id: 'b', stop_id: 's1', ...SENSOJI }),
          place({ id: 'c', stop_id: 's1', ...NARITA }),
        ],
      }),
    )
    const centre = centres.get('s1')
    expect(centre?.lat).toBeCloseTo(SENSOJI.lat, 3)
    expect(centre?.lon).toBeCloseTo(SENSOJI.lon, 3)
  })

  it('leaves a stop out when nothing can locate it', () => {
    expect(stopCentres(bundle({ stops: [stop({ id: 's1', name: 'Nowhere' })] })).size).toBe(0)
  })
})

describe('inferStops', () => {
  const tokyo = stop({ id: 'tokyo', name: 'Tokyo', ...SHINJUKU })
  const kyoto = stop({ id: 'kyoto', name: 'Kyoto', ...KYOTO })

  it('gives a place to the nearer of two cities', () => {
    const inferred = inferStops(
      bundle({ stops: [tokyo, kyoto], places: [place({ id: 'p', ...SENSOJI })] }),
    )
    expect(inferred.get('p')?.stopId).toBe('tokyo')
    expect(inferred.get('p')?.band).toBe('city')
  })

  it('does not put a Kyoto temple in Tokyo', () => {
    const inferred = inferStops(
      bundle({ stops: [tokyo, kyoto], places: [place({ id: 'p', ...FUSHIMI })] }),
    )
    expect(inferred.get('p')?.stopId).toBe('kyoto')
  })

  it('marks a day out as a day out rather than an afternoon', () => {
    const inferred = inferStops(
      bundle({ stops: [tokyo], places: [place({ id: 'nikko', ...NIKKO })] }),
    )
    expect(inferred.get('nikko')?.band).toBe('day_trip')
    expect(inferred.get('nikko')?.km).toBeGreaterThan(100)
  })

  it('leaves alone a place you assigned yourself', () => {
    // Nothing to infer, and the manual choice is never second-guessed.
    const inferred = inferStops(
      bundle({
        stops: [tokyo, kyoto],
        places: [place({ id: 'p', stop_id: 'kyoto', ...SENSOJI })],
      }),
    )
    expect(inferred.has('p')).toBe(false)
  })

  it('says nothing about a place with no coordinates', () => {
    const inferred = inferStops(bundle({ stops: [tokyo], places: [place({ id: 'p' })] }))
    expect(inferred.has('p')).toBe(false)
  })

  it('says nothing at all when no stop can be located', () => {
    const blind = stop({ id: 's', name: 'Tokyo' })
    const inferred = inferStops(
      bundle({ stops: [blind], places: [place({ id: 'p', ...SENSOJI })] }),
    )
    expect(inferred.size).toBe(0)
  })
})

describe('cityOf', () => {
  const tokyo = stop({ id: 'tokyo', name: 'Tokyo', ...SHINJUKU })

  it('lets your own choice win outright', () => {
    const trip = bundle({
      stops: [tokyo],
      places: [place({ id: 'p', stop_id: 'elsewhere', ...SENSOJI })],
    })
    expect(cityOf(trip.places[0], inferStops(trip))).toBe('elsewhere')
  })

  it('uses the inference when you have not said', () => {
    const trip = bundle({ stops: [tokyo], places: [place({ id: 'p', ...SENSOJI })] })
    expect(cityOf(trip.places[0], inferStops(trip))).toBe('tokyo')
  })

  it('refuses to claim a day trip belongs to an afternoon in the city', () => {
    // Nikkō is matched to Tokyo so it can be named and its distance
    // shown, but it is not something to slot between lunch and a museum.
    const trip = bundle({ stops: [tokyo], places: [place({ id: 'nikko', ...NIKKO })] })
    const inferred = inferStops(trip)
    expect(inferred.get('nikko')?.stopId).toBe('tokyo')
    expect(cityOf(trip.places[0], inferred)).toBeNull()
  })
})
