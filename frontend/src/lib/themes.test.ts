import { describe, expect, it } from 'vitest'

import type { Place, Stop, TripBundle } from '../api/types'

import { planTrip } from './planTrip'

/**
 * A day of the kind you asked for.
 *
 * "Magari mi va di farmi la strada dei negozi, o una giornata musei."
 * Without a theme the planner has one idea of a good day — the nearest
 * well-known things, whatever they are — so a fortnight comes out as
 * fourteen days of the same shape.
 *
 * What has to be true, and it is the whole design in two lines: a theme
 * *sorts* and never *filters*. A shopping day in a city with four shops
 * must still be a day, not four shops and seven empty hours.
 */

const TOKYO = { lat: 35.6896, lon: 139.7006 }
const BEFORE = new Date('2026-04-01T00:00:00Z')

function stop(p: Partial<Stop> & { id: string; name: string }): Stop {
  return {
    trip_id: 'trip', country_code: 'JP', tz: 'Asia/Tokyo', arrive_date: null, depart_date: null,
    position: 0, lat: null, lon: null, notes: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...p,
  }
}

function place(p: Partial<Place> & { id: string }): Place {
  return {
    trip_id: 'trip', stop_id: 'tokyo', name: p.id, category: 'sight', priority: 'normal',
    weather_exposure: 'mixed', description: null, image_url: null,
    lat: TOKYO.lat, lon: TOKYO.lon, address: null, url: null, notes: null,
    visit_minutes: 180, planned_start_at: null, planned_tz: null, opening_hours: {},
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...p,
  }
}

/** One day in Tokyo, a pile of places, and whatever theme is passed. */
function oneDay(places: Place[], theme: string | null): TripBundle {
  return {
    trip: {
      id: 'trip', title: 'Japan', destination_label: null,
      start_date: '2026-04-11', end_date: '2026-04-11', primary_tz: 'Europe/Rome',
      primary_currency: 'EUR', budget_amount: null, status: 'planned', notes: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    },
    stops: [
      stop({ id: 'tokyo', name: 'Tokyo', ...TOKYO, arrive_date: '2026-04-10', depart_date: '2026-04-12' }),
    ],
    bookings: [], places, checklist: [], expenses: [],
    day_notes: theme
      ? [{ id: 'n', trip_id: 'trip', day: '2026-04-11', note: '', theme,
           created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]
      : [],
    diary: [], memories: [], travel_times: [], attachments: [],
    generated_at: '2026-01-01T00:00:00Z',
  } as unknown as TripBundle
}

/**
 * Scattered across the city, not piled on one point.
 *
 * With every place at the same coordinates the route optimiser has
 * nothing to do, so the order it is handed survives to the end — and a
 * theme applied only to the routing would appear to work. Spread out, the
 * two-opt pass reorders freely, and the theme has to be in the sort that
 * decides what gets placed.
 */
function at(n: number): { lat: number; lon: number } {
  return { lat: TOKYO.lat + ((n % 4) - 2) * 0.012, lon: TOKYO.lon + (Math.floor(n / 4) - 1) * 0.012 }
}

/**
 * Two of each kind, three hours each.
 *
 * Deliberately more than fits: a twelve-hour day takes four of these, so
 * six of the ten have to go — which is the only condition under which a
 * theme can be observed doing anything at all.
 */
const MIXED = [
  // Interleaved on purpose. Grouped by kind, the first four in the list
  // are chosen whatever the theme — the sort is stable, so equal ranks
  // keep their input order — and both a shopping day and a museums day
  // came out with the same four places while the test read as passing.
  place({ id: 'sight-a', category: 'sight', ...at(0) }),
  place({ id: 'temple-a', category: 'temple', ...at(1) }),
  place({ id: 'food-a', category: 'food', ...at(2) }),
  place({ id: 'museum-a', category: 'museum', ...at(3) }),
  place({ id: 'shop-a', category: 'shopping', ...at(4) }),
  place({ id: 'sight-b', category: 'sight', ...at(5) }),
  place({ id: 'temple-b', category: 'temple', ...at(6) }),
  place({ id: 'food-b', category: 'food', ...at(7) }),
  place({ id: 'museum-b', category: 'museum', ...at(8) }),
  place({ id: 'shop-b', category: 'shopping', ...at(9) }),
]

/**
 * Which places got into the day — not in what order.
 *
 * The order in `writes` follows the route, because that is what the day
 * planner spends its effort on. What a theme decides is who survives when
 * the day overflows, which is this set.
 */
function scheduled(theme: string | null, places = MIXED): Set<string> {
  // One day, or there is no overflow and a theme cannot matter: the stop
  // spans three days, and ten places fit across three days comfortably.
  const plan = planTrip(oneDay(places, theme), { now: BEFORE, onlyDays: ['2026-04-11'] })
  return new Set(plan.writes.map((write) => write.placeId))
}

/** Three hours each and a twelve-hour day: four of ten get in. */
function dropped(theme: string | null, places = MIXED): Set<string> {
  const chosen = scheduled(theme, places)
  return new Set(places.map((p) => p.id).filter((id) => !chosen.has(id)))
}

describe('a day of the kind you asked for', () => {
  it('keeps the shops when a shopping day overflows', () => {
    const chosen = scheduled('shopping')
    expect(chosen.has('shop-a')).toBe(true)
    expect(chosen.has('shop-b')).toBe(true)
    // And something that is not shopping had to go, or the day did not
    // overflow and this proves nothing.
    expect(dropped('shopping').size).toBeGreaterThan(0)
  })

  it('keeps the museums when a museums day overflows', () => {
    const chosen = scheduled('museums')
    expect(chosen.has('museum-a')).toBe(true)
    expect(chosen.has('museum-b')).toBe(true)
  })

  it('counts a temple as a day outdoors, because visiting one is walking its grounds', () => {
    // The same reason the rain re-balancer treats them as outdoor.
    const chosen = scheduled('outdoors')
    expect(chosen.has('temple-a')).toBe(true)
    expect(chosen.has('temple-b')).toBe(true)
  })

  it('drops a different set depending on what the day is for', () => {
    // The point, stated once: the same ten places and the same day give
    // two different days.
    expect([...scheduled('shopping')].sort()).not.toEqual([...scheduled('museums')].sort())
  })

  it('still fills a shopping day in a city with one shop', () => {
    // The whole reason a theme sorts rather than filters: a day with one
    // shop and seven empty hours is not what you asked for either.
    const thin = [
      place({ id: 'shop-a', category: 'shopping' }),
      ...MIXED.filter((p) => p.category !== 'shopping'),
    ]
    const chosen = scheduled('shopping', thin)
    expect(chosen.has('shop-a')).toBe(true)
    expect(chosen.size).toBeGreaterThan(1)
  })

  it('never beats something you marked unmissable', () => {
    // A theme is worth one step of priority, not a veto. You said this
    // temple was the point of the trip, and a shopping day does not
    // overrule you.
    //
    // Enough shops to fill the day on their own, so a theme worth more
    // than one step would push the temple out and this would notice.
    const withMust = [
      place({ id: 'temple-must', category: 'temple', priority: 'must_see' }),
      ...['s1', 's2', 's3', 's4', 's5'].map((id) => place({ id, category: 'shopping' })),
      ...MIXED,
    ]
    expect(scheduled('shopping', withMust).has('temple-must')).toBe(true)
  })
})
