import { describe, expect, it } from 'vitest'

import type { Booking, Place, Stop, TripBundle } from '../api/types'
import { baseStopOn, buildTimeline, nextBooking, stopsOn } from './itinerary'

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
    kind: 'activity',
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

function place(over: Partial<Place>): Place {
  return {
    id: crypto.randomUUID(),
    trip_id: 't1',
    stop_id: null,
    name: 'Senso-ji',
    category: 'temple',
    priority: 'normal',
    weather_exposure: 'outdoor',
    lat: null,
    lon: null,
    address: null,
    url: null,
    notes: null,
    visit_minutes: 60,
    planned_start_at: null,
    planned_tz: null,
    opening_hours: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Place
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

const titles = (t: ReturnType<typeof buildTimeline>, day: string) =>
  t.days
    .find((d) => d.key === day)
    ?.entries.map((e) => (e.entry.type === 'booking' ? e.entry.booking.title : e.entry.place.name))

describe('building the day-by-day timeline', () => {
  it('shows every day of the trip, including the empty ones', () => {
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
    expect(buildTimeline(bundle()).days.map((day) => day.number)).toEqual([1, 2, 3, 4])
  })

  it('files a booking under the day it happens in its own zone', () => {
    // 06:30 UTC is 15:30 on the 12th in Tokyo but only 08:30 in Rome.
    const checkIn = booking({
      kind: 'hotel',
      title: 'Gracery',
      start_at: '2026-04-12T06:30:00Z',
      start_tz: 'Asia/Tokyo',
    })
    const timeline = buildTimeline(bundle({ bookings: [checkIn] }))
    expect(titles(timeline, '2026-04-12')).toEqual(['Gracery'])
  })

  it('keeps a booking that falls outside the declared trip dates', () => {
    // The outbound flight often leaves the evening before the trip formally
    // starts; dropping it would hide the most important row of all.
    const flight = booking({
      kind: 'flight',
      title: 'Rome to Tokyo',
      start_at: '2026-04-10T20:00:00Z',
      start_tz: 'Europe/Rome',
    })
    const timeline = buildTimeline(bundle({ bookings: [flight] }))
    expect(timeline.days[0].key).toBe('2026-04-10')
  })

  it('sets aside bookings and places that are not scheduled', () => {
    const timeline = buildTimeline(
      bundle({
        bookings: [booking({ title: 'Ryokan, still deciding' })],
        places: [place({ name: 'Nezu Museum' })],
      }),
    )
    expect(timeline.undatedBookings.map((b) => b.title)).toEqual(['Ryokan, still deciding'])
    expect(timeline.unscheduledPlaces.map((p) => p.name)).toEqual(['Nezu Museum'])
  })

  it('labels a day with the stop you are based at', () => {
    const kyoto = stop({ name: 'Kyoto', arrive_date: '2026-04-13', depart_date: '2026-04-14' })
    const timeline = buildTimeline(bundle({ stops: [kyoto] }))
    expect(timeline.days.find((d) => d.key === '2026-04-12')?.stop).toBeNull()
    expect(timeline.days.find((d) => d.key === '2026-04-13')?.stop?.name).toBe('Kyoto')
  })
})

describe('places on the itinerary', () => {
  it('a scheduled place sits among the bookings, in time order', () => {
    const lunch = booking({
      kind: 'restaurant',
      title: 'Pranzo',
      start_at: '2026-04-13T03:00:00Z', // 12:00 in Tokyo
      start_tz: 'Asia/Tokyo',
    })
    const temple = place({
      name: 'Senso-ji',
      planned_start_at: '2026-04-13T01:00:00Z', // 10:00 in Tokyo
      planned_tz: 'Asia/Tokyo',
      visit_minutes: 90,
    })
    const timeline = buildTimeline(bundle({ bookings: [lunch], places: [temple] }))
    expect(titles(timeline, '2026-04-13')).toEqual(['Senso-ji', 'Pranzo'])
  })

  it('a place occupies the time its visit takes', () => {
    const temple = place({
      planned_start_at: '2026-04-13T01:00:00Z',
      planned_tz: 'Asia/Tokyo',
      visit_minutes: 90,
    })
    const timeline = buildTimeline(bundle({ places: [temple] }))
    const entry = timeline.days.find((d) => d.key === '2026-04-13')!.entries[0].entry
    expect(entry.busyUntil).toBe(new Date('2026-04-13T02:30:00Z').toISOString())
  })
})

describe('free time and clashes', () => {
  const at = (hourUtc: number, minute = 0) =>
    `2026-04-13T${String(hourUtc).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`

  it('reports the gap between two things', () => {
    const timeline = buildTimeline(
      bundle({
        places: [
          place({ name: 'A', planned_start_at: at(1), planned_tz: 'Asia/Tokyo', visit_minutes: 60 }),
          place({ name: 'B', planned_start_at: at(4), planned_tz: 'Asia/Tokyo', visit_minutes: 60 }),
        ],
      }),
    )
    const entries = timeline.days.find((d) => d.key === '2026-04-13')!.entries
    expect(entries[0].gapMinutes).toBeNull()
    expect(entries[1].gapMinutes).toBe(120)
  })

  it('stays quiet about a sliver of a gap', () => {
    const timeline = buildTimeline(
      bundle({
        places: [
          place({ name: 'A', planned_start_at: at(1), planned_tz: 'Asia/Tokyo', visit_minutes: 60 }),
          place({
            name: 'B',
            planned_start_at: at(2, 10),
            planned_tz: 'Asia/Tokyo',
            visit_minutes: 60,
          }),
        ],
      }),
    )
    // Ten minutes is walking time, not an opportunity.
    expect(timeline.days.find((d) => d.key === '2026-04-13')!.entries[1].gapMinutes).toBeNull()
  })

  it('flags a clash', () => {
    const timeline = buildTimeline(
      bundle({
        places: [
          place({ name: 'A', planned_start_at: at(1), planned_tz: 'Asia/Tokyo', visit_minutes: 120 }),
          place({ name: 'B', planned_start_at: at(2), planned_tz: 'Asia/Tokyo', visit_minutes: 60 }),
        ],
      }),
    )
    expect(timeline.days.find((d) => d.key === '2026-04-13')!.entries[1].overlaps).toBe(true)
  })

  it('does not let a hotel make the rest of the trip look like a clash', () => {
    // The bug this guards against: a hotel runs from check-in to check-out,
    // so counting it as busy time would mark every activity of the next
    // three days as overlapping it.
    const hotel = booking({
      kind: 'hotel',
      title: 'Gracery',
      start_at: '2026-04-12T06:00:00Z',
      start_tz: 'Asia/Tokyo',
      end_at: '2026-04-15T01:00:00Z',
      end_tz: 'Asia/Tokyo',
    })
    const temple = place({
      name: 'Senso-ji',
      planned_start_at: '2026-04-13T01:00:00Z',
      planned_tz: 'Asia/Tokyo',
    })
    const timeline = buildTimeline(bundle({ bookings: [hotel], places: [temple] }))
    const day13 = timeline.days.find((d) => d.key === '2026-04-13')!
    expect(day13.entries[0].overlaps).toBe(false)
    expect(day13.entries[0].gapMinutes).toBeNull()
  })

  it('keeps shielding behind the longest thing so far', () => {
    // A long visit followed by a short one must still protect what comes
    // after it, rather than the comparison resetting to the short one.
    const timeline = buildTimeline(
      bundle({
        places: [
          place({ name: 'lungo', planned_start_at: at(1), planned_tz: 'Asia/Tokyo', visit_minutes: 240 }),
          place({ name: 'breve', planned_start_at: at(2), planned_tz: 'Asia/Tokyo', visit_minutes: 30 }),
          place({ name: 'dopo', planned_start_at: at(4), planned_tz: 'Asia/Tokyo', visit_minutes: 30 }),
        ],
      }),
    )
    const entries = timeline.days.find((d) => d.key === '2026-04-13')!.entries
    // 'dopo' starts at 04:00, while 'lungo' runs until 05:00.
    expect(entries[2].overlaps).toBe(true)
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

/**
 * Which city a day belongs to.
 *
 * `stopForDay` used to return whichever covering stop came first, which
 * is wrong in the two cases where more than one covers a day — and both
 * of those are ordinary, not edge cases.
 */
describe('baseStopOn', () => {
  const tokyo = stop({ name: 'Tokyo', arrive_date: '2026-04-12', depart_date: '2026-04-16' })
  const kyoto = stop({ name: 'Kyoto', arrive_date: '2026-04-16', depart_date: '2026-04-20' })
  const hakone = stop({ name: 'Hakone', arrive_date: '2026-04-14', depart_date: '2026-04-15' })

  it('gives an ordinary day to the one stop that covers it', () => {
    expect(baseStopOn([tokyo, kyoto], '2026-04-13')).toEqual({ stop: tokyo, why: 'only_stop' })
  })

  it('gives a handover day to the city you arrive in, not the one you leave', () => {
    // You sleep in Kyoto on the 16th. First-match gave it to Tokyo
    // because Tokyo comes first in the list.
    expect(baseStopOn([tokyo, kyoto], '2026-04-16')).toEqual({ stop: kyoto, why: 'arriving' })
  })

  it('does not depend on the order the stops arrive in', () => {
    expect(baseStopOn([kyoto, tokyo], '2026-04-16').stop?.name).toBe('Kyoto')
  })

  it('gives a day trip to the shorter stay inside the longer one', () => {
    // Hakone sits inside the Tokyo leg. The narrower span is the more
    // specific statement about where you actually are.
    expect(baseStopOn([tokyo, hakone], '2026-04-14')).toEqual({ stop: hakone, why: 'day_trip' })
  })

  it('says so when no stop covers the day', () => {
    expect(baseStopOn([tokyo, kyoto], '2026-04-25')).toEqual({ stop: null, why: 'no_stop' })
  })

  it('refuses to guess when two stops simply overlap', () => {
    // Not a handover and not a nesting: a data problem worth naming
    // rather than resolving by list order.
    const osaka = stop({ name: 'Osaka', arrive_date: '2026-04-14', depart_date: '2026-04-18' })
    expect(baseStopOn([tokyo, osaka], '2026-04-15')).toEqual({
      stop: null,
      why: 'overlapping_stops',
    })
  })

  it('reaches the timeline, which is what the rain rebalancer reads', () => {
    // Weather.tsx labels every visit with `day.stop.id`. With the old
    // rule a Kyoto temple on the handover day was tagged as Tokyo, and
    // rebalance was then free to trade it with a Tokyo place on another
    // day — the cross-city swap its own comment forbids.
    const base = bundle()
    const timeline = buildTimeline(
      bundle({
        stops: [tokyo, kyoto],
        trip: { ...base.trip, start_date: '2026-04-12', end_date: '2026-04-20' },
      }),
    )
    const handover = timeline.days.find((day) => day.key === '2026-04-16')
    expect(handover?.stop?.name).toBe('Kyoto')
  })

  it('ignores a stop with no dates', () => {
    const sketch = stop({ name: 'Da decidere', arrive_date: null, depart_date: null })
    expect(baseStopOn([sketch, tokyo], '2026-04-13').stop?.name).toBe('Tokyo')
  })

  it('treats a one-day stop with no departure as covering that day', () => {
    const nara = stop({ name: 'Nara', arrive_date: '2026-04-17', depart_date: null })
    expect(stopsOn([nara], '2026-04-17')).toHaveLength(1)
    expect(stopsOn([nara], '2026-04-18')).toHaveLength(0)
  })
})
