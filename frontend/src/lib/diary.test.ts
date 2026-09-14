import { describe, expect, it } from 'vitest'

import type { Booking, DiaryEntry, Place, TripBundle } from '../api/types'

import { diaryDays, firstUnwritten, written } from './diary'

function bundle(partial: Partial<TripBundle> = {}): TripBundle {
  return {
    trip: {
      id: 'trip',
      title: 'Japan',
      destination_label: null,
      start_date: '2026-04-12',
      end_date: '2026-04-16',
      primary_tz: 'Asia/Tokyo',
      primary_currency: 'JPY',
      budget_amount: null,
      status: 'active',
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

function entry(day: string, text = 'Ramen, then rain.'): DiaryEntry {
  return {
    id: day,
    trip_id: 'trip',
    day,
    text,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  }
}

function booking(id: string, title: string, startAt: string): Booking {
  return {
    id,
    trip_id: 'trip',
    stop_id: null,
    kind: 'restaurant',
    status: 'confirmed',
    title,
    provider: null,
    confirmation_code: null,
    start_at: startAt,
    start_tz: 'Asia/Tokyo',
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
  }
}

function place(id: string, name: string, plannedAt: string): Place {
  return {
    id,
    trip_id: 'trip',
    stop_id: null,
    name,
    category: 'temple',
    priority: 'normal',
    weather_exposure: 'outdoor',
    lat: null,
    lon: null,
    address: null,
    url: null,
    notes: null,
    visit_minutes: 60,
    planned_start_at: plannedAt,
    planned_tz: 'Asia/Tokyo',
    opening_hours: {},
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  }
}

/** 14 April 2026, 10:00 in Tokyo — the trip is half over. */
const MIDTRIP = new Date('2026-04-14T01:00:00Z')

describe('diaryDays', () => {
  it('covers every day of the trip, written or not', () => {
    const days = diaryDays(bundle({ diary: [entry('2026-04-13')] }), MIDTRIP)
    expect(days.map((day) => day.key)).toEqual([
      '2026-04-12',
      '2026-04-13',
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
    ])
    expect(days[1].entry?.text).toBe('Ramen, then rain.')
    expect(days[0].entry).toBeUndefined()
  })

  it('counts today as writable, because you write in the evening', () => {
    const days = diaryDays(bundle(), MIDTRIP)
    expect(days.find((day) => day.key === '2026-04-14')?.isPast).toBe(true)
  })

  it('does not count days that have not happened', () => {
    const days = diaryDays(bundle(), MIDTRIP)
    expect(days.find((day) => day.key === '2026-04-15')?.isPast).toBe(false)
  })

  it('decides what today is by the trip zone, not the device', () => {
    // 15:30 UTC on the 14th is already the 15th in Tokyo. Judging by UTC
    // would tell someone standing in Japan that tomorrow has not happened
    // when for them it has.
    const lateInTokyo = new Date('2026-04-14T15:30:00Z')
    const days = diaryDays(bundle(), lateInTokyo)
    expect(days.find((day) => day.key === '2026-04-15')?.isPast).toBe(true)
  })

  it('lists what happened that day, as a prompt', () => {
    const days = diaryDays(
      bundle({
        bookings: [booking('b1', 'Ichiran', '2026-04-13T04:00:00Z')],
        places: [place('p1', 'Senso-ji', '2026-04-13T01:00:00Z')],
      }),
      MIDTRIP,
    )
    const thirteenth = days.find((day) => day.key === '2026-04-13')
    // In the order the day ran: the temple in the morning, ramen after.
    expect(thirteenth?.happened).toEqual(['Senso-ji', 'Ichiran'])
    expect(thirteenth?.more).toBe(0)
  })

  it('caps the prompt and says how many it left out', () => {
    const places = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) =>
      place(name, name, `2026-04-13T0${index}:00:00Z`),
    )
    const days = diaryDays(bundle({ places }), MIDTRIP)
    const thirteenth = days.find((day) => day.key === '2026-04-13')
    expect(thirteenth?.happened).toHaveLength(4)
    expect(thirteenth?.more).toBe(2)
  })

  it('says nothing happened when nothing did', () => {
    const days = diaryDays(bundle(), MIDTRIP)
    expect(days[0].happened).toEqual([])
    expect(days[0].more).toBe(0)
  })
})

describe('written', () => {
  it('counts only days that have happened', () => {
    // Three days in. Counting the whole trip would read "1 of 5" and
    // feel like failure on the first evening.
    const days = diaryDays(bundle({ diary: [entry('2026-04-12')] }), MIDTRIP)
    expect(written(days)).toEqual({ written: 1, writable: 3 })
  })

  it('is complete when every past day is written', () => {
    const days = diaryDays(
      bundle({ diary: [entry('2026-04-12'), entry('2026-04-13'), entry('2026-04-14')] }),
      MIDTRIP,
    )
    expect(written(days)).toEqual({ written: 3, writable: 3 })
  })

  it('is zero of zero before the trip starts', () => {
    const days = diaryDays(bundle(), new Date('2026-04-01T00:00:00Z'))
    expect(written(days)).toEqual({ written: 0, writable: 0 })
  })
})

describe('firstUnwritten', () => {
  it('finds the earliest gap', () => {
    const days = diaryDays(bundle({ diary: [entry('2026-04-12'), entry('2026-04-14')] }), MIDTRIP)
    expect(firstUnwritten(days)).toBe('2026-04-13')
  })

  it('ignores days that have not happened', () => {
    const days = diaryDays(
      bundle({ diary: [entry('2026-04-12'), entry('2026-04-13'), entry('2026-04-14')] }),
      MIDTRIP,
    )
    expect(firstUnwritten(days)).toBeNull()
  })
})
