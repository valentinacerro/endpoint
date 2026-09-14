import { describe, expect, it } from 'vitest'

import type { Booking, Place } from '../api/types'

import { formatDistance, nearby, openState, withoutCoordinates } from './nearby'

/** Shinjuku station, roughly. */
const HERE = { lat: 35.6896, lon: 139.7006 }

function place(partial: Partial<Place> & { id: string; name: string }): Place {
  return {
    trip_id: 'trip',
    stop_id: null,
    category: 'sight',
    priority: 'normal',
    weather_exposure: 'mixed',
    description: null,
    image_url: null,
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

function booking(partial: Partial<Booking> & { id: string; title: string }): Booking {
  return {
    trip_id: 'trip',
    stop_id: null,
    kind: 'hotel',
    status: 'confirmed',
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

function ask(places: Place[], bookings: Booking[] = [], now = new Date('2026-04-12T02:00:00Z')) {
  return nearby({ places, bookings, from: HERE, zone: 'Asia/Tokyo', tripId: 'trip', now })
}

describe('openState', () => {
  // 2026-04-12 is a Sunday. 02:00 UTC is 11:00 in Tokyo.
  const SUNDAY_MORNING_IN_TOKYO = new Date('2026-04-12T02:00:00Z')

  it('knows a place is open, and for how much longer', () => {
    const state = openState(
      { sun: [['09:00', '17:00']] },
      'Asia/Tokyo',
      SUNDAY_MORNING_IN_TOKYO,
    )
    expect(state).toEqual({ kind: 'open', closesInMinutes: 360 })
  })

  it('reads the clock on the wall there, not the one in your pocket', () => {
    // The same instant is 04:00 in Rome — before opening — and 11:00 in
    // Tokyo. Judging by the device zone is the bug this app exists to
    // avoid, and it shows up here as a temple reported shut.
    const state = openState(
      { sun: [['09:00', '17:00']] },
      'Europe/Rome',
      SUNDAY_MORNING_IN_TOKYO,
    )
    expect(state.kind).toBe('closed')
  })

  it('knows a place has already shut', () => {
    const evening = new Date('2026-04-12T10:00:00Z') // 19:00 in Tokyo
    expect(openState({ sun: [['09:00', '17:00']] }, 'Asia/Tokyo', evening).kind).toBe('closed')
  })

  it('knows a place has not opened yet', () => {
    const dawn = new Date('2026-04-11T22:00:00Z') // 07:00 Sunday in Tokyo
    expect(openState({ sun: [['09:00', '17:00']] }, 'Asia/Tokyo', dawn).kind).toBe('closed')
  })

  it('handles a lunchtime closure', () => {
    const lunch = new Date('2026-04-12T03:30:00Z') // 12:30 in Tokyo
    const hours = {
      sun: [
        ['09:00', '12:00'],
        ['13:00', '17:00'],
      ] as [string, string][],
    }
    expect(openState(hours, 'Asia/Tokyo', lunch).kind).toBe('closed')

    const afternoon = new Date('2026-04-12T05:00:00Z') // 14:00
    expect(openState(hours, 'Asia/Tokyo', afternoon)).toEqual({
      kind: 'open',
      closesInMinutes: 180,
    })
  })

  it('says unknown when no hours were ever recorded', () => {
    // Not the same as closed. Almost nothing imported from Maps has hours.
    expect(openState({}, 'Asia/Tokyo', SUNDAY_MORNING_IN_TOKYO).kind).toBe('unknown')
  })

  it('says closed when the day is recorded as having no hours', () => {
    expect(openState({ sun: [] }, 'Asia/Tokyo', SUNDAY_MORNING_IN_TOKYO).kind).toBe('closed')
  })
})

describe('nearby', () => {
  it('puts the nearest first', () => {
    const results = ask([
      place({ id: 'far', name: 'Ueno Park', lat: 35.7156, lon: 139.7745 }),
      place({ id: 'near', name: 'Shinjuku Gyoen', lat: 35.6852, lon: 139.71 }),
    ])
    expect(results.map((item) => item.id)).toEqual(['near', 'far'])
  })

  it('leaves out another city entirely', () => {
    const results = nearby({
      places: [place({ id: 'kyoto', name: 'Fushimi Inari', lat: 34.9671, lon: 135.7727 })],
      bookings: [],
      from: HERE,
      zone: 'Asia/Tokyo',
      tripId: 'trip',
      now: new Date('2026-04-12T02:00:00Z'),
    })
    expect(results).toEqual([])
  })

  it('leaves out anything with no coordinates, and counts it separately', () => {
    const blind = [place({ id: 'p1', name: 'That ramen place someone mentioned' })]
    expect(ask(blind)).toEqual([])
    // Absent from the list, but the screen can still say it exists —
    // silence would read as "you have nothing saved near here".
    expect(withoutCoordinates(blind, [])).toBe(1)
  })

  it('includes bookings, because the way back to the hotel is the one that matters', () => {
    const results = ask(
      [],
      [booking({ id: 'b1', title: 'Hotel Gracery', lat: 35.6955, lon: 139.7006 })],
    )
    expect(results).toHaveLength(1)
    expect(results[0].kind).toBe('booking')
  })

  it('does not pretend a booking has opening hours', () => {
    const results = ask(
      [],
      [booking({ id: 'b1', title: 'Hotel Gracery', lat: 35.6955, lon: 139.7006 })],
    )
    expect(results[0].open.kind).toBe('unknown')
  })

  it('calls a few hundred metres a walk and a few kilometres a train', () => {
    const results = ask([
      place({ id: 'close', name: 'Round the corner', lat: 35.6905, lon: 139.702 }),
      place({ id: 'across', name: 'Across town', lat: 35.7156, lon: 139.7745 }),
    ])
    expect(results[0].mode).toBe('walk')
    expect(results[1].mode).toBe('transit')
  })

  it('says which day something is already planned for', () => {
    const results = ask([
      place({
        id: 'p1',
        name: 'Shinjuku Gyoen',
        lat: 35.6852,
        lon: 139.71,
        planned_start_at: '2026-04-14T01:00:00Z',
        planned_tz: 'Asia/Tokyo',
      }),
    ])
    expect(results[0].plannedDay).toBe('2026-04-14')
  })

  it('dates a planned visit by the local day, not the UTC one', () => {
    // 22:00 UTC is already the next morning in Tokyo. Reporting the UTC
    // day would put the visit on the day before you actually go.
    const results = ask([
      place({
        id: 'p1',
        name: 'Tsukiji',
        lat: 35.6654,
        lon: 139.7707,
        planned_start_at: '2026-04-13T22:00:00Z',
        planned_tz: 'Asia/Tokyo',
      }),
    ])
    expect(results[0].plannedDay).toBe('2026-04-14')
  })

  it('reports nothing planned as nothing planned', () => {
    const results = ask([place({ id: 'p1', name: 'Somewhere', lat: 35.69, lon: 139.7 })])
    expect(results[0].plannedDay).toBeNull()
  })

  it('orders equal distances predictably', () => {
    const results = ask([
      place({ id: 'b', name: 'B', lat: 35.69, lon: 139.7 }),
      place({ id: 'a', name: 'A', lat: 35.69, lon: 139.7 }),
    ])
    expect(results.map((item) => item.name)).toEqual(['A', 'B'])
  })
})

describe('formatDistance', () => {
  it('uses metres for anything under a kilometre', () => {
    expect(formatDistance(0.42)).toBe('420 m')
  })

  it('uses kilometres above that', () => {
    expect(formatDistance(3.27)).toBe('3.3 km')
  })
})
