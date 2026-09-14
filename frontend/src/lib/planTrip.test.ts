import { describe, expect, it } from 'vitest'

import type { Booking, Place, Stop, TripBundle } from '../api/types'

import { planTrip } from './planTrip'

const SHINJUKU = { lat: 35.6896, lon: 139.7006 }
const SENSOJI = { lat: 35.7148, lon: 139.7967 }
const UENO = { lat: 35.7141, lon: 139.7774 }
const SHIBUYA = { lat: 35.6595, lon: 139.7005 }
const KYOTO = { lat: 34.9858, lon: 135.7588 }
const FUSHIMI = { lat: 34.9671, lon: 135.7727 }
const NIKKO = { lat: 36.7199, lon: 139.6982 }

/** Well before the trip, so no day is ever refused as past. */
const BEFORE = new Date('2026-04-01T00:00:00Z')

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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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
    visit_minutes: 90,
    planned_start_at: null,
    planned_tz: null,
    opening_hours: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function booking(partial: Partial<Booking> & { id: string }): Booking {
  return {
    trip_id: 'trip',
    stop_id: null,
    kind: 'flight',
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
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
    generated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

const TOKYO = stop({
  id: 'tokyo',
  name: 'Tokyo',
  arrive_date: '2026-04-12',
  depart_date: '2026-04-16',
  ...SHINJUKU,
})
const KYOTO_STOP = stop({
  id: 'kyoto',
  name: 'Kyoto',
  arrive_date: '2026-04-16',
  depart_date: '2026-04-20',
  position: 1,
  ...KYOTO,
})

/** The day a write landed on, read in the zone it was written for. */
function dayOf(write: { startAt: string; zone: string }): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: write.zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(write.startAt))
}

describe('planTrip', () => {
  it('accounts for every place, always', () => {
    // The invariant the whole thing rests on. A planner that quietly
    // loses one is worse than one that refuses it out loud, and this is
    // the only way to know it never does. `planTrip` also asserts it
    // internally and throws.
    const trip = bundle({
      stops: [TOKYO, KYOTO_STOP],
      places: [
        place({ id: 'sensoji', ...SENSOJI }),
        place({ id: 'ueno', ...UENO }),
        place({ id: 'fushimi', ...FUSHIMI }),
        place({ id: 'nikko', ...NIKKO }),
        place({ id: 'senzaposto' }),
      ],
    })
    const result = planTrip(trip, { now: BEFORE })

    expect(result.writes.length + result.kept.length + result.unplaced.length).toBe(
      trip.places.length,
    )
  })

  it('spreads a city over its days instead of filling the first', () => {
    // The complaint this exists to answer. The arrival is booked and
    // lands at eight, so every Tokyo day is a full one and all four
    // visits would comfortably fit on the Sunday — if nothing shared
    // them out, that is exactly where they would all go.
    const landed = booking({
      id: 'volo',
      kind: 'flight',
      start_at: '2026-04-11T12:00:00Z',
      start_tz: 'Europe/Rome',
      end_at: '2026-04-11T23:00:00Z', // 08:00 on the 12th in Tokyo
      end_tz: 'Asia/Tokyo',
    })
    const places = [SENSOJI, UENO, SHIBUYA, { lat: 35.6764, lon: 139.6993 }].map(
      (point, index) => place({ id: `p${index}`, ...point, visit_minutes: 60 }),
    )
    const result = planTrip(
      bundle({ stops: [TOKYO], bookings: [landed], places }),
      { now: BEFORE },
    )

    expect(result.writes).toHaveLength(4)
    expect(new Set(result.writes.map(dayOf)).size).toBeGreaterThan(2)
  })

  it('never puts a place on a day spent in another city', () => {
    // Kyoto and Osaka are forty kilometres apart, which the travel model
    // prices at about three hours — comfortably inside a day. That
    // matters: with Tokyo and Kyoto the sheer distance refuses a
    // misplaced visit all by itself, so a test using them would pass
    // even with the city rule deleted. Here only the rule can hold.
    const kyoto = stop({
      id: 'kyoto',
      name: 'Kyoto',
      arrive_date: '2026-04-12',
      depart_date: '2026-04-15',
      ...KYOTO,
    })
    const osaka = stop({
      id: 'osaka',
      name: 'Osaka',
      arrive_date: '2026-04-15',
      depart_date: '2026-04-18',
      position: 1,
      lat: 34.7024,
      lon: 135.4959,
    })
    const places = [
      place({ id: 'k0', ...FUSHIMI }),
      place({ id: 'k1', lat: 35.0394, lon: 135.7292 }),
      place({ id: 'o0', lat: 34.6873, lon: 135.5262 }),
      place({ id: 'o1', lat: 34.6546, lon: 135.5064 }),
    ]
    const result = planTrip(bundle({ stops: [kyoto, osaka], places }), { now: BEFORE })

    expect(result.writes.length).toBeGreaterThan(2)

    const stopOfDay = new Map(result.days.map((day) => [day.key, day.stop?.id ?? null]))
    for (const write of result.writes) {
      const expected = write.placeId.startsWith('k') ? 'kyoto' : 'osaka'
      expect(stopOfDay.get(dayOf(write)), `${write.placeId} on ${dayOf(write)}`).toBe(expected)
    }
  })

  it('does not plan the morning of a day you are still in the air', () => {
    // buildTimeline keys a booking by its departure, so an overnight
    // Rome to Tokyo never appears on the arrival day at all and the
    // planner used to start it at nine while the plane was on approach.
    const flight = booking({
      id: 'volo',
      kind: 'flight',
      start_at: '2026-04-11T12:00:00Z',
      start_tz: 'Europe/Rome',
      end_at: '2026-04-12T00:35:00Z', // 09:35 in Tokyo
      end_tz: 'Asia/Tokyo',
    })
    const result = planTrip(
      bundle({
        stops: [TOKYO],
        bookings: [flight],
        places: [place({ id: 'sensoji', ...SENSOJI, visit_minutes: 60 })],
      }),
      { now: BEFORE },
    )

    for (const write of result.writes.filter((w) => dayOf(w) === '2026-04-12')) {
      expect(new Date(write.startAt).getTime()).toBeGreaterThanOrEqual(
        new Date(flight.end_at!).getTime(),
      )
    }
  })

  it('says out loud when it guessed at an arrival time', () => {
    const result = planTrip(
      bundle({ stops: [TOKYO], places: [place({ id: 'sensoji', ...SENSOJI })] }),
      { now: BEFORE },
    )
    expect(result.assumptions).toContainEqual({ day: '2026-04-12', what: 'arrival_assumed' })
  })

  it('leaves what you scheduled by hand exactly where it is', () => {
    const byHand = place({
      id: 'mio',
      ...SENSOJI,
      planned_start_at: '2026-04-13T01:00:00Z',
      planned_tz: 'Asia/Tokyo',
    })
    const result = planTrip(
      bundle({ stops: [TOKYO], places: [byHand, place({ id: 'altro', ...UENO })] }),
      { now: BEFORE },
    )

    expect(result.kept).toEqual(['mio'])
    expect(result.writes.map((write) => write.placeId)).not.toContain('mio')
  })

  it('refuses a day out rather than squeezing it into an afternoon', () => {
    const result = planTrip(
      bundle({ stops: [TOKYO], places: [place({ id: 'nikko', ...NIKKO })] }),
      { now: BEFORE },
    )
    const refusal = result.unplaced.find((item) => item.placeId === 'nikko')
    expect(refusal?.reason).toBe('day_trip')
    expect(refusal?.km).toBeGreaterThan(100)
  })

  it('names the days it tried when it says there was no room', () => {
    // "No room" is only a true statement if it was actually offered
    // everywhere, so the days are listed and are checkable.
    const huge = Array.from({ length: 12 }, (_, index) =>
      place({ id: `big${index}`, ...SENSOJI, visit_minutes: 600 }),
    )
    const result = planTrip(bundle({ stops: [TOKYO], places: huge }), { now: BEFORE })

    const refused = result.unplaced.filter((item) => item.reason === 'no_room')
    expect(refused.length).toBeGreaterThan(0)
    for (const item of refused) expect(item.daysTried.length).toBeGreaterThan(0)
  })

  it('refuses a place shut on every day of its city, before blaming the room', () => {
    const result = planTrip(
      bundle({
        stops: [TOKYO],
        // Shut Sunday to Wednesday, which is the whole Tokyo leg.
        places: [
          place({
            id: 'chiuso',
            ...SENSOJI,
            opening_hours: { sun: [], mon: [], tue: [], wed: [], thu: [] },
          }),
        ],
      }),
      { now: BEFORE },
    )
    const refusal = result.unplaced.find((item) => item.placeId === 'chiuso')
    expect(refusal?.reason).toBe('closed_on_every_day')
    expect(refusal?.daysTried.length).toBeGreaterThan(0)
  })

  it('says nothing can be done when no stop has a position', () => {
    const blind = stop({
      id: 'tokyo',
      name: 'Tokyo',
      arrive_date: '2026-04-12',
      depart_date: '2026-04-16',
    })
    const result = planTrip(
      bundle({ stops: [blind], places: [place({ id: 'sensoji', ...SENSOJI })] }),
      { now: BEFORE },
    )
    expect(result.unplaced[0].reason).toBe('no_located_stop')
  })

  it('works from the stops when the trip itself has no dates', () => {
    // Both trip dates are nullable and nothing requires them, so a trip
    // sketched as a list of cities would otherwise get no days at all.
    const base = bundle()
    const result = planTrip(
      bundle({
        trip: { ...base.trip, start_date: null, end_date: null },
        stops: [TOKYO],
        places: [place({ id: 'sensoji', ...SENSOJI })],
      }),
      { now: BEFORE },
    )
    expect(result.days.length).toBeGreaterThan(0)
  })

  it('does not plan a day that has already gone', () => {
    const result = planTrip(bundle({ stops: [TOKYO], places: [] }), {
      now: new Date('2026-04-14T03:00:00Z'),
    })
    const past = result.days.find((day) => day.key === '2026-04-12')
    expect(past?.refused).toBe('in_the_past')
  })

  it('touches only the days it was asked about', () => {
    const result = planTrip(
      bundle({
        stops: [TOKYO],
        places: [place({ id: 'a', ...SENSOJI }), place({ id: 'b', ...UENO })],
      }),
      { now: BEFORE, onlyDays: ['2026-04-13'] },
    )
    expect(result.days.map((day) => day.key)).toEqual(['2026-04-13'])
    for (const write of result.writes) expect(dayOf(write)).toBe('2026-04-13')
  })

  it('returns a requested day’s visits to the pool when replanning it', () => {
    const already = place({
      id: 'gia',
      ...SENSOJI,
      planned_start_at: '2026-04-13T01:00:00Z',
      planned_tz: 'Asia/Tokyo',
    })
    const result = planTrip(bundle({ stops: [TOKYO], places: [already] }), {
      now: BEFORE,
      onlyDays: ['2026-04-13'],
      replan: 'day',
    })
    expect(result.kept).toEqual([])
    expect(result.writes.map((write) => write.placeId)).toContain('gia')
  })

  it('plans nothing at all for a trip with no stops', () => {
    const result = planTrip(bundle({ places: [place({ id: 'p', ...SENSOJI })] }), {
      now: BEFORE,
    })
    expect(result.writes).toEqual([])
    expect(result.unplaced).toHaveLength(1)
  })
})
