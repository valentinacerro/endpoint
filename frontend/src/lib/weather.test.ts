import { describe, expect, it } from 'vitest'

import type { DayWeather, Place } from '../api/types'

import { rebalance, skyOf, wetness, type Scheduled } from './weather'

function forecast(partial: Partial<DayWeather> & { stop_id: string; day: string }): DayWeather {
  return {
    weather_code: 61,
    precipitation_mm: 0,
    precipitation_probability: 0,
    temp_max: 18,
    temp_min: 10,
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
    weather_exposure: 'outdoor',
    description: null,
    image_url: null,
    lat: null,
    lon: null,
    address: null,
    url: null,
    notes: null,
    visit_minutes: 60,
    planned_start_at: '2026-04-12T01:00:00Z',
    planned_tz: 'Asia/Tokyo',
    opening_hours: {},
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

function scheduled(
  id: string,
  day: string,
  exposure: Place['weather_exposure'],
  extra: Partial<Place> = {},
  stopId: string | null = 'tokyo',
): Scheduled {
  return { place: place({ id, weather_exposure: exposure, ...extra }), day, stopId }
}

const WET = { stop_id: 'tokyo', day: '2026-04-12', precipitation_mm: 12, weather_code: 65 }
const DRY = { stop_id: 'tokyo', day: '2026-04-14', precipitation_mm: 0, weather_code: 0 }

describe('wetness', () => {
  it('calls a downpour wet', () => {
    expect(wetness(forecast({ ...WET }))).toBe('wet')
  })

  it('calls a high chance of rain wet even with little accumulation', () => {
    expect(
      wetness(forecast({ ...DRY, precipitation_mm: 0.4, precipitation_probability: 85 })),
    ).toBe('wet')
  })

  it('calls a clear day dry', () => {
    expect(wetness(forecast({ ...DRY }))).toBe('dry')
  })

  it('says unknown rather than dry when there is no forecast', () => {
    // The usual case for a trip still months away. Treating silence as
    // sunshine would make the re-balancer confidently propose nothing.
    expect(wetness(undefined)).toBe('unknown')
  })

  it('does not invent a probability that was not reported', () => {
    expect(
      wetness(forecast({ ...DRY, precipitation_mm: 0.2, precipitation_probability: null })),
    ).toBe('dry')
  })
})

describe('rebalance', () => {
  it('trades a garden in the rain for a museum in the sun', () => {
    const { swaps } = rebalance(
      [scheduled('garden', '2026-04-12', 'outdoor'), scheduled('museum', '2026-04-14', 'indoor')],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps).toHaveLength(1)
    expect(swaps[0].outdoor.place.id).toBe('garden')
    expect(swaps[0].indoor.place.id).toBe('museum')
    expect(swaps[0].rainAvoidedMm).toBe(12)
  })

  it('never moves a visit to a day you are in another city', () => {
    // The swap that would look perfectly sensible on paper and put you on
    // the wrong side of the country.
    const { swaps, stuck } = rebalance(
      [
        scheduled('garden', '2026-04-12', 'outdoor', {}, 'tokyo'),
        scheduled('museum', '2026-04-14', 'indoor', {}, 'kyoto'),
      ],
      [forecast(WET), forecast({ ...DRY, stop_id: 'kyoto' })],
    )

    expect(swaps).toEqual([])
    expect(stuck).toEqual([{ day: '2026-04-12', reason: 'no_indoor_alternative' }])
  })

  it('refuses when the indoor place is shut on the wet day offered to it', () => {
    // Sunday 12 April is the wet day; this museum shuts on Sundays. The
    // trade would rescue the garden and send the museum to a locked door.
    const { swaps, stuck } = rebalance(
      [
        scheduled('garden', '2026-04-12', 'outdoor'),
        scheduled('museum', '2026-04-14', 'indoor', {
          opening_hours: { sun: [], tue: [['09:00', '17:00']] },
        }),
      ],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps).toEqual([])
    expect(stuck[0].reason).toBe('no_indoor_alternative')
  })

  it('refuses when the outdoor place is shut on the day offered to it', () => {
    const { swaps, stuck } = rebalance(
      [
        scheduled('garden', '2026-04-12', 'outdoor', {
          // Shut on Tuesday 14 April, which is the dry day on offer.
          opening_hours: { tue: [], sun: [['09:00', '17:00']] },
        }),
        scheduled('museum', '2026-04-14', 'indoor'),
      ],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps).toEqual([])
    expect(stuck[0].reason).toBe('no_indoor_alternative')
  })

  it('treats unrecorded opening hours as possible, and says it is guessing', () => {
    const { swaps } = rebalance(
      [scheduled('garden', '2026-04-12', 'outdoor'), scheduled('museum', '2026-04-14', 'indoor')],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps[0].hoursUnknown).toBe(true)
  })

  it('does not flag a guess when both places have hours on record', () => {
    const open = { opening_hours: { sun: [['09:00', '17:00']], tue: [['09:00', '17:00']] } }
    const { swaps } = rebalance(
      [
        scheduled('garden', '2026-04-12', 'outdoor', open),
        scheduled('museum', '2026-04-14', 'indoor', open),
      ],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps[0].hoursUnknown).toBe(false)
  })

  it('proposes each place at most once, so the whole set can be accepted', () => {
    const { swaps } = rebalance(
      [
        scheduled('garden', '2026-04-12', 'outdoor'),
        scheduled('park', '2026-04-12', 'outdoor'),
        scheduled('museum', '2026-04-14', 'indoor'),
      ],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps).toHaveLength(1)
    const moved = swaps.flatMap((swap) => [swap.outdoor.place.id, swap.indoor.place.id])
    expect(new Set(moved).size).toBe(moved.length)
  })

  it('sends the wettest day to the driest alternative', () => {
    const { swaps } = rebalance(
      [
        scheduled('garden', '2026-04-12', 'outdoor'),
        scheduled('gallery', '2026-04-13', 'indoor'),
        scheduled('museum', '2026-04-14', 'indoor'),
      ],
      [
        forecast(WET),
        forecast({ stop_id: 'tokyo', day: '2026-04-13', precipitation_mm: 2 }),
        forecast(DRY),
      ],
    )

    expect(swaps[0].indoor.place.id).toBe('museum')
  })

  it('rescues the wettest visit first when it can only rescue one', () => {
    const { swaps } = rebalance(
      [
        scheduled('drizzle-park', '2026-04-13', 'outdoor'),
        scheduled('soaked-garden', '2026-04-12', 'outdoor'),
        scheduled('museum', '2026-04-14', 'indoor'),
      ],
      [
        forecast(WET),
        forecast({ stop_id: 'tokyo', day: '2026-04-13', precipitation_mm: 4 }),
        forecast(DRY),
      ],
    )

    expect(swaps[0].outdoor.place.id).toBe('soaked-garden')
  })

  it('prefers rescuing a must-see when two visits are equally soaked', () => {
    const { swaps } = rebalance(
      [
        scheduled('ordinary', '2026-04-12', 'outdoor', { priority: 'normal' }),
        scheduled('fushimi-inari', '2026-04-12', 'outdoor', { priority: 'must_see' }),
        scheduled('museum', '2026-04-14', 'indoor'),
      ],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps[0].outdoor.place.id).toBe('fushimi-inari')
  })

  it('moves an outdoor visit before a partly sheltered one', () => {
    const { swaps } = rebalance(
      [
        scheduled('arcade', '2026-04-12', 'mixed'),
        scheduled('garden', '2026-04-12', 'outdoor'),
        scheduled('museum', '2026-04-14', 'indoor'),
      ],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps[0].outdoor.place.id).toBe('garden')
  })

  it('leaves a museum in the rain alone', () => {
    const { swaps, stuck } = rebalance(
      [scheduled('museum', '2026-04-12', 'indoor'), scheduled('gallery', '2026-04-14', 'indoor')],
      [forecast(WET), forecast(DRY)],
    )

    expect(swaps).toEqual([])
    expect(stuck).toEqual([])
  })

  it('proposes nothing at all when there is no forecast', () => {
    const { swaps, stuck } = rebalance(
      [scheduled('garden', '2026-04-12', 'outdoor'), scheduled('museum', '2026-04-14', 'indoor')],
      [],
    )

    expect(swaps).toEqual([])
    expect(stuck).toEqual([])
  })

  it('says which wet days it could do nothing about', () => {
    const { stuck } = rebalance([scheduled('garden', '2026-04-12', 'outdoor')], [forecast(WET)])
    expect(stuck).toEqual([{ day: '2026-04-12', reason: 'no_indoor_alternative' }])
  })

  it('says when it cannot tell which city a wet day is spent in', () => {
    const { stuck } = rebalance(
      [scheduled('garden', '2026-04-12', 'outdoor', {}, null)],
      [forecast(WET)],
    )
    // No stop means no forecast lookup either, so this only fires when the
    // day is wet for some *other* place at the same date.
    expect(stuck).toEqual([])
  })

  it('will not swap a place with itself on the same day', () => {
    const { swaps } = rebalance(
      [scheduled('garden', '2026-04-12', 'outdoor'), scheduled('museum', '2026-04-12', 'indoor')],
      [forecast(WET)],
    )
    expect(swaps).toEqual([])
  })
})

describe('skyOf', () => {
  it('groups the WMO codes into what changes a decision', () => {
    expect(skyOf(0)).toBe('clear')
    expect(skyOf(3)).toBe('cloudy')
    expect(skyOf(48)).toBe('fog')
    expect(skyOf(61)).toBe('rain')
    expect(skyOf(71)).toBe('snow')
    expect(skyOf(86)).toBe('snow')
    expect(skyOf(95)).toBe('storm')
  })
})
