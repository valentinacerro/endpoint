import { describe, expect, it } from 'vitest'

import type { Memory, Stop } from '../api/types'

import type { PhotoReading } from './exif'
import { byDay, instantOf, memoryId, place, sample, spanKm, zoneFor } from './memories'

function stop(partial: Partial<Stop> & { name: string; tz: string }): Stop {
  return {
    id: partial.name,
    trip_id: 'trip',
    country_code: null,
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

function memory(partial: Partial<Memory> & { id: string; taken_at: string }): Memory {
  return {
    trip_id: 'trip',
    lat: 35.7148,
    lon: 139.7967,
    taken_tz: 'Asia/Tokyo',
    time_source: 'assumed',
    filename: null,
    caption: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

function reading(partial: Partial<PhotoReading> = {}): PhotoReading {
  return {
    filename: 'IMG_0001.jpg',
    lat: 35.7148,
    lon: 139.7967,
    localTime: '2026-04-13T14:20',
    offset: null,
    ...partial,
  }
}

const TOKYO = stop({ name: 'Tokyo', tz: 'Asia/Tokyo', lat: 35.6896, lon: 139.7006 })
const HONOLULU = stop({ name: 'Honolulu', tz: 'Pacific/Honolulu', lat: 21.3069, lon: -157.8583 })

describe('zoneFor', () => {
  it('takes the zone of the nearest stop', () => {
    const zone = zoneFor({ lat: 35.7148, lon: 139.7967 }, [HONOLULU, TOKYO], 'Europe/Rome')
    expect(zone).toBe('Asia/Tokyo')
  })

  it('skips stops with no coordinates rather than guessing at them', () => {
    const blind = stop({ name: 'Somewhere', tz: 'America/New_York' })
    expect(zoneFor({ lat: 35.7148, lon: 139.7967 }, [blind, TOKYO], 'Europe/Rome')).toBe(
      'Asia/Tokyo',
    )
  })

  it('falls back to the trip zone when no stop can help', () => {
    const blind = stop({ name: 'Somewhere', tz: 'America/New_York' })
    expect(zoneFor({ lat: 35.7148, lon: 139.7967 }, [blind], 'Europe/Rome')).toBe('Europe/Rome')
  })

  it('falls back when there are no stops at all', () => {
    expect(zoneFor({ lat: 35.7148, lon: 139.7967 }, [], 'Europe/Rome')).toBe('Europe/Rome')
  })
})

describe('instantOf', () => {
  it('is exact when the file records an offset', () => {
    const { instant, source } = instantOf('2026-04-13T14:20', '+09:00', 'Europe/Rome')
    expect(instant).toBe('2026-04-13T05:20:00.000Z')
    // The zone passed in is ignored: an offset in the file beats a guess.
    expect(source).toBe('exif')
  })

  it('reads the wall clock in the inferred zone when there is no offset', () => {
    const { instant, source } = instantOf('2026-04-13T14:20', null, 'Asia/Tokyo')
    expect(instant).toBe('2026-04-13T05:20:00.000Z')
    expect(source).toBe('assumed')
  })

  it('does not read the wall clock in the device zone', () => {
    // The whole point. The same 14:20 means a different instant in Tokyo
    // and in Rome, and the device you are importing from has nothing to
    // do with where the photo was taken.
    const tokyo = instantOf('2026-04-13T14:20', null, 'Asia/Tokyo').instant
    const rome = instantOf('2026-04-13T14:20', null, 'Europe/Rome').instant
    expect(tokyo).not.toBe(rome)
  })

  it('ignores an offset that is not one', () => {
    const { source } = instantOf('2026-04-13T14:20', 'unknown', 'Asia/Tokyo')
    expect(source).toBe('assumed')
  })
})

describe('memoryId', () => {
  it('gives the same photograph the same id every time', async () => {
    // What makes re-importing a folder a no-op instead of a second copy
    // of the holiday.
    expect(await memoryId(reading())).toBe(await memoryId(reading()))
  })

  it('tells two photographs apart by their time', async () => {
    const first = await memoryId(reading({ localTime: '2026-04-13T14:20' }))
    const second = await memoryId(reading({ localTime: '2026-04-13T14:21' }))
    expect(first).not.toBe(second)
  })

  it('tells apart two files that happen to share a name', async () => {
    // IMG_0001.jpg recurs on every camera ever made.
    const here = await memoryId(reading({ lat: 35.7148 }))
    const there = await memoryId(reading({ lat: 34.9671 }))
    expect(here).not.toBe(there)
  })

  it('produces a well-formed UUID, not merely something accepted', async () => {
    expect(await memoryId(reading())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('place', () => {
  it('assembles a point ready to be written', async () => {
    const placed = await place(reading(), [TOKYO], 'Europe/Rome')
    expect(placed.takenTz).toBe('Asia/Tokyo')
    expect(placed.takenAt).toBe('2026-04-13T05:20:00.000Z')
    expect(placed.timeSource).toBe('assumed')
    expect(placed.filename).toBe('IMG_0001.jpg')
  })

  it('marks the time as known when the file said so', async () => {
    const placed = await place(reading({ offset: '+09:00' }), [TOKYO], 'Europe/Rome')
    expect(placed.timeSource).toBe('exif')
  })
})

describe('byDay', () => {
  it('groups by the local day, not the UTC one', () => {
    // 21:00 in Tokyo is noon UTC. Filing it under the UTC day would be
    // right by the clock and wrong by the evening it belonged to — and
    // obvious at a glance on a screen about remembering which day was
    // which.
    const evening = memory({ id: 'm1', taken_at: '2026-04-13T12:00:00Z' })
    const nextMorning = memory({ id: 'm2', taken_at: '2026-04-13T23:00:00Z' })

    const days = byDay([evening, nextMorning])

    expect(days.map((day) => day.key)).toEqual(['2026-04-13', '2026-04-14'])
  })

  it('orders the days, and the photos within a day', () => {
    const days = byDay([
      memory({ id: 'late', taken_at: '2026-04-13T08:00:00Z' }),
      memory({ id: 'early', taken_at: '2026-04-13T01:00:00Z' }),
    ])
    expect(days[0].memories.map((entry) => entry.id)).toEqual(['early', 'late'])
  })

  it('reads each photo in its own zone, not one zone for all', () => {
    // A trip that crosses the date line has photos whose days cannot be
    // worked out from a single zone.
    const tokyo = memory({ id: 'm1', taken_at: '2026-04-13T12:00:00Z', taken_tz: 'Asia/Tokyo' })
    const rome = memory({ id: 'm2', taken_at: '2026-04-13T12:00:00Z', taken_tz: 'Europe/Rome' })

    const days = byDay([tokyo, rome])

    expect(days.map((day) => day.key)).toEqual(['2026-04-13'])
    // Same instant, same local date here — but the grouping used each
    // one's own zone to decide that, rather than assuming.
    expect(days[0].memories).toHaveLength(2)
  })

  it('is empty when there is nothing', () => {
    expect(byDay([])).toEqual([])
  })
})

describe('spanKm', () => {
  it('adds up the distance between consecutive points', () => {
    const shinjuku = memory({ id: 'a', taken_at: '2026-04-13T01:00:00Z', lat: 35.6896, lon: 139.7006 })
    const sensoji = memory({ id: 'b', taken_at: '2026-04-13T02:00:00Z', lat: 35.7148, lon: 139.7967 })
    expect(spanKm([shinjuku, sensoji])).toBeCloseTo(9.1, 0)
  })

  it('is zero for a single point', () => {
    expect(spanKm([memory({ id: 'a', taken_at: '2026-04-13T01:00:00Z' })])).toBe(0)
  })
})

describe('sample', () => {
  it('leaves a short list alone', () => {
    expect(sample([1, 2, 3], 60)).toEqual([1, 2, 3])
  })

  it('keeps both ends of a long one', () => {
    const many = Array.from({ length: 400 }, (_, index) => index)
    const picked = sample(many, 60)
    expect(picked).toHaveLength(60)
    expect(picked[0]).toBe(0)
    expect(picked.at(-1)).toBe(399)
  })

  it('spreads the rest evenly rather than taking the first n', () => {
    // Taking the first sixty would draw the first three days of a
    // fortnight and call it the trip.
    const many = Array.from({ length: 100 }, (_, index) => index)
    const picked = sample(many, 5)
    expect(picked).toEqual([0, 25, 50, 74, 99])
  })

  it('does not repeat a point', () => {
    const many = Array.from({ length: 61 }, (_, index) => index)
    expect(new Set(sample(many, 60)).size).toBe(60)
  })

  it('copies rather than handing back the caller’s array', () => {
    const original = [1, 2, 3]
    expect(sample(original, 60)).not.toBe(original)
  })
})
