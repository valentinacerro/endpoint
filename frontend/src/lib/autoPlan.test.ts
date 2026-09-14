import { describe, expect, it } from 'vitest'

import type { Place, Stop, TripBundle } from '../api/types'

import { gapsIn, unsearchable } from './autoPlan'
import { planTrip } from './planTrip'

/**
 * Reading a plan to find out what it lacked.
 *
 * The whole point is that the threshold is not invented: "this city needs
 * places" means the planner was given the day and put nothing on it. What
 * has to be right is the distinction between that and a day the planner
 * *refused* — no dates, arrival unknown — because those need you, not a
 * list of museums, and burying them under suggestions is how a real
 * problem goes unnoticed.
 */

const TOKYO = { lat: 35.6896, lon: 139.7006 }
const KYOTO = { lat: 34.9858, lon: 135.7588 }
const BEFORE = new Date('2026-04-01T00:00:00Z')

function stop(p: Partial<Stop> & { id: string; name: string }): Stop {
  return {
    trip_id: 'trip', country_code: 'JP', tz: 'Asia/Tokyo', arrive_date: null,
    depart_date: null, position: 0, lat: null, lon: null, notes: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...p,
  }
}

function place(p: Partial<Place> & { id: string }): Place {
  return {
    trip_id: 'trip', stop_id: null, name: p.id, category: 'sight', priority: 'normal',
    weather_exposure: 'mixed', lat: null, lon: null, address: null, url: null, notes: null,
    visit_minutes: 90, planned_start_at: null, planned_tz: null, opening_hours: {},
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...p,
  }
}

function bundle(stops: Stop[], places: Place[]): TripBundle {
  return {
    trip: {
      id: 'trip', title: 'Japan', destination_label: null, start_date: '2026-04-11',
      end_date: '2026-04-14', primary_tz: 'Europe/Rome', primary_currency: 'EUR',
      budget_amount: null, status: 'planned', notes: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    },
    stops, bookings: [], places, checklist: [], expenses: [], day_notes: [], diary: [],
    memories: [], travel_times: [], attachments: [], generated_at: '2026-01-01T00:00:00Z',
  } as unknown as TripBundle
}

const tokyoFourDays = stop({
  id: 'tokyo', name: 'Tokyo', ...TOKYO, arrive_date: '2026-04-11', depart_date: '2026-04-14',
})

describe('what a plan says it was missing', () => {
  it('names the days a city was given and could not fill', () => {
    // One place for four days: three days come back with nothing on them.
    const data = bundle([tokyoFourDays], [place({ id: 'sensoji', stop_id: 'tokyo', ...TOKYO })])
    const gaps = gapsIn(data, planTrip(data, { now: BEFORE }))

    expect(gaps).toHaveLength(1)
    expect(gaps[0].stopName).toBe('Tokyo')
    expect(gaps[0].emptyDays).toHaveLength(3)
    expect(gaps[0].centre).toEqual(TOKYO)
  })

  it('asks for enough to fill them, and not for a forced march', () => {
    // Measured: the planner can fit nine sixty-minute visits in a day. It
    // asks for four, which is a day a person walks.
    const data = bundle([tokyoFourDays], [place({ id: 'sensoji', stop_id: 'tokyo', ...TOKYO })])
    expect(gapsIn(data, planTrip(data, { now: BEFORE }))[0].wanted).toBe(12)
  })

  it('says nothing at all about a city whose days are full', () => {
    const places = Array.from({ length: 24 }, (_, i) =>
      place({
        id: `p${i}`, stop_id: 'tokyo', visit_minutes: 60,
        lat: TOKYO.lat + ((i % 5) - 2) * 0.01, lon: TOKYO.lon + (Math.floor(i / 5) - 2) * 0.01,
      }),
    )
    const data = bundle([tokyoFourDays], places)
    expect(gapsIn(data, planTrip(data, { now: BEFORE }))).toEqual([])
  })

  it('does not count a day the planner refused outright', () => {
    // A city with no dates is never given a day at all. Proposing museums
    // for it would hide the thing only you can fix: telling it when you
    // are there.
    const data = bundle(
      [tokyoFourDays, stop({ id: 'kyoto', name: 'Kyoto', ...KYOTO })],
      [place({ id: 'sensoji', stop_id: 'tokyo', ...TOKYO })],
    )
    const gaps = gapsIn(data, planTrip(data, { now: BEFORE }))
    expect(gaps.map((gap) => gap.stopName)).toEqual(['Tokyo'])
  })

  it('ignores a day with no usable hours, because arriving and leaving in one', () => {
    // arrive === depart leaves no window to put anything in, and the
    // planner refuses it by name. Offering places for it would be
    // offering places for a day that does not exist.
    const data = bundle(
      [stop({ id: 'tokyo', name: 'Tokyo', ...TOKYO, arrive_date: '2026-04-11', depart_date: '2026-04-11' })],
      [],
    )
    expect(gapsIn(data, planTrip(data, { now: BEFORE }))).toEqual([])
  })

  it('puts the biggest hole first', () => {
    const data = bundle(
      [
        // Changeover on the 12th, which belongs to the city you arrive
        // in: one empty day in Tokyo against three in Kyoto.
        stop({ id: 'tokyo', name: 'Tokyo', ...TOKYO, arrive_date: '2026-04-11', depart_date: '2026-04-12' }),
        stop({ id: 'kyoto', name: 'Kyoto', ...KYOTO, arrive_date: '2026-04-12', depart_date: '2026-04-14' }),
      ],
      [],
    )
    const gaps = gapsIn(data, planTrip(data, { now: BEFORE }))
    expect(gaps.map((gap) => gap.stopName)).toEqual(['Kyoto', 'Tokyo'])
  })

  it('separates a city it cannot look around from one it can', () => {
    // No position, so there is no "around" to ask about. Naming it is the
    // only useful thing to do, and it is not a gap that searching fills.
    const data = bundle(
      [stop({ id: 'kyoto', name: 'Kyoto', arrive_date: '2026-04-12', depart_date: '2026-04-13' })],
      [],
    )
    const plan = planTrip(data, { now: BEFORE })
    expect(gapsIn(data, plan)).toEqual([])
    expect(unsearchable(plan)).toEqual(['Kyoto'])
  })
})
