import { describe, expect, it } from 'vitest'

import type { Booking, Stop, TripBundle } from '../api/types'
import { buildTimeline, nextBooking } from './itinerary'

function bundle(overrides: Partial<TripBundle> = {}): TripBundle {
  return {
    trip: {
      id: 't1',
      title: 'Japan',
      destination_label: null,
      start_date: '2026-04-11',
      end_date: '2026-04-14',
      primary_tz: 'Europe/Rome',
      primary_currency: 'EUR',
      budget_amount: null,
      status: 'planned',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    stops: [],
    bookings: [],
    places: [],
    attachments: [],
    generated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as TripBundle
}

function booking(over: Partial<Booking>): Booking {
  return {
    id: crypto.randomUUID(),
    trip_id: 't1',
    stop_id: null,
    kind: 'hotel',
    status: 'confirmed',
    title: 'something',
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Booking
}

function stop(over: Partial<Stop>): Stop {
  return {
    id: crypto.randomUUID(),
    trip_id: 't1',
    name: 'Tokyo',
    country_code: 'JP',
    tz: 'Asia/Tokyo',
    arrive_date: null,
    depart_date: null,
    position: 0,
    lat: null,
    lon: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Stop
}

describe('building the day-by-day timeline', () => {
  it('shows every day of the trip, including the empty ones', () => {
    // A Thursday with nothing on it is information, not something to hide.
    const timeline = buildTimeline(bundle())
    expect(timeline.days.map((day) => day.key)).toEqual([
      '2026-04-11',
      '2026-04-12',
      '2026-04-13',
      '2026-04-14',
    ])
    expect(timeline.days.every((day) => day.entries.length === 0)).toBe(true)
  })

  it('numbers the days from one', () => {
    const timeline = buildTimeline(bundle())
    expect(timeline.days.map((day) => day.number)).toEqual([1, 2, 3, 4])
  })

  it('files a booking under the day it happens in its own zone', () => {
    // 06:30 UTC is 15:30 on the 12th in Tokyo, but only 08:30 in Rome.
    // Filing it by the Rome clock would put a Tokyo hotel on the wrong day.
    const checkIn = booking({
      title: 'Gracery',
      start_at: '2026-04-12T06:30:00Z',
      start_tz: 'Asia/Tokyo',
    })
    const timeline = buildTimeline(bundle({ bookings: [checkIn] }))
    const day = timeline.days.find((entry) => entry.key === '2026-04-12')
    expect(day?.entries).toHaveLength(1)
    expect(day?.entries[0].zone).toBe('Asia/Tokyo')
  })

  it('files a late-evening event by the local day, not the UTC one', () => {
    // 23:30 in Tokyo on the 12th is 14:30 UTC — still the 12th locally, and
    // that is the day it must appear under.
    const dinner = booking({
      title: 'Late dinner',
      kind: 'restaurant',
      start_at: '2026-04-12T14:30:00Z',
      start_tz: 'Asia/Tokyo',
    })
    const timeline = buildTimeline(bundle({ bookings: [dinner] }))
    expect(timeline.days.find((day) => day.key === '2026-04-12')?.entries).toHaveLength(1)
  })

  it('keeps a booking that falls outside the declared trip dates', () => {
    // The outbound flight often leaves the evening before the trip formally
    // starts; dropping it would hide the single most important row.
    const flight = booking({
      title: 'Rome to Tokyo',
      kind: 'flight',
      start_at: '2026-04-10T20:00:00Z',
      start_tz: 'Europe/Rome',
    })
    const timeline = buildTimeline(bundle({ bookings: [flight] }))
    expect(timeline.days[0].key).toBe('2026-04-10')
    expect(timeline.days[0].entries[0].booking.title).toBe('Rome to Tokyo')
  })

  it('orders a day chronologically even when its events sit in different zones', () => {
    const landing = booking({
      title: 'Landing',
      kind: 'flight',
      start_at: '2026-04-12T00:35:00Z',
      start_tz: 'Asia/Tokyo',
    })
    const earlier = booking({
      title: 'Breakfast in Rome',
      kind: 'restaurant',
      start_at: '2026-04-11T23:00:00Z',
      start_tz: 'Europe/Rome',
    })
    const timeline = buildTimeline(bundle({ bookings: [landing, earlier] }))
    // Both are on the 12th in Tokyo terms for the first, the 12th in Rome
    // terms for the second — what matters is each lands on its own day and
    // the ordering inside a day follows the actual instant.
    const all = timeline.days.flatMap((day) => day.entries.map((e) => e.booking.title))
    expect(all.indexOf('Breakfast in Rome')).toBeLessThan(all.indexOf('Landing'))
  })

  it('sets aside bookings that have no date yet', () => {
    const idea = booking({ title: 'Ryokan, still deciding' })
    const timeline = buildTimeline(bundle({ bookings: [idea] }))
    expect(timeline.undated.map((item) => item.title)).toEqual(['Ryokan, still deciding'])
    expect(timeline.days.every((day) => day.entries.length === 0)).toBe(true)
  })

  it('labels a day with the stop you are based at', () => {
    const kyoto = stop({
      name: 'Kyoto',
      arrive_date: '2026-04-13',
      depart_date: '2026-04-14',
    })
    const timeline = buildTimeline(bundle({ stops: [kyoto] }))
    expect(timeline.days.find((day) => day.key === '2026-04-12')?.stop).toBeNull()
    expect(timeline.days.find((day) => day.key === '2026-04-13')?.stop?.name).toBe('Kyoto')
    expect(timeline.days.find((day) => day.key === '2026-04-14')?.stop?.name).toBe('Kyoto')
  })

  it('copes with a trip that has no dates at all', () => {
    const draft = bundle()
    draft.trip.start_date = null
    draft.trip.end_date = null
    const timeline = buildTimeline(draft)
    expect(timeline.days).toEqual([])
  })
})

describe('what happens next', () => {
  const now = new Date('2026-04-12T05:00:00Z')

  it('picks the first thing still to come', () => {
    const past = booking({ title: 'Yesterday', start_at: '2026-04-11T09:00:00Z', start_tz: 'Asia/Tokyo' })
    const soon = booking({ title: 'Check-in', start_at: '2026-04-12T06:00:00Z', start_tz: 'Asia/Tokyo' })
    const later = booking({ title: 'Dinner', start_at: '2026-04-12T11:00:00Z', start_tz: 'Asia/Tokyo' })
    expect(nextBooking(bundle({ bookings: [later, past, soon] }), now)?.title).toBe('Check-in')
  })

  it('returns nothing once the trip is over', () => {
    const past = booking({ title: 'Done', start_at: '2026-04-01T09:00:00Z', start_tz: 'Asia/Tokyo' })
    expect(nextBooking(bundle({ bookings: [past] }), now)).toBeNull()
  })
})
