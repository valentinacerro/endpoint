import { describe, expect, it } from 'vitest'

import type { Attachment, Booking, ChecklistItem, Expense, Trip, TripBundle } from '../api/types'
import { chooseMoment, readiness, refine, spentOn, stopToday } from './today'

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    title: 'Giappone',
    destination_label: 'Giappone',
    start_date: '2026-04-11',
    end_date: '2026-04-24',
    primary_tz: 'Europe/Rome',
    primary_currency: 'EUR',
    budget_amount: null,
    status: 'planned',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Trip
}

function bundle(over: Partial<TripBundle> = {}): TripBundle {
  return {
    trip: trip(),
    stops: [],
    bookings: [],
    places: [],
    checklist: [],
    expenses: [],
    day_notes: [],
    diary: [],
    memories: [],
    attachments: [],
    generated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as TripBundle
}

const at = (iso: string) => new Date(iso)

describe('which trip today is about', () => {
  it('has nothing to say with no trips', () => {
    expect(chooseMoment([], at('2026-04-01T10:00:00Z')).phase).toBe('none')
  })

  it('counts the days to the one that has not started', () => {
    const moment = chooseMoment([trip()], at('2026-03-30T10:00:00Z'))
    expect(moment).toMatchObject({ phase: 'before', daysAway: 12 })
  })

  it('numbers the days of the one you are on, first day included', () => {
    expect(chooseMoment([trip()], at('2026-04-11T09:00:00Z'))).toMatchObject({
      phase: 'during',
      day: 1,
      total: 14,
    })
    expect(chooseMoment([trip()], at('2026-04-24T09:00:00Z'))).toMatchObject({
      phase: 'during',
      day: 14,
      total: 14,
    })
  })

  it('counts the day against the home clock, which is all it has', () => {
    // `chooseMoment` only has the trip list, so it uses `primary_tz` —
    // documented as the home clock. Refining that against where you are
    // actually standing is `refine`'s job, below.
    const inTokyo = trip({ primary_tz: 'Asia/Tokyo' })
    const inRome = trip({ primary_tz: 'Europe/Rome' })
    const instant = at('2026-04-12T16:00:00Z')

    expect(chooseMoment([inTokyo], instant)).toMatchObject({ phase: 'during', day: 3 })
    expect(chooseMoment([inRome], instant)).toMatchObject({ phase: 'during', day: 2 })
  })

  it('lets the trip happening now beat the one coming up', () => {
    const running = trip({ id: 'now', start_date: '2026-04-11', end_date: '2026-04-24' })
    const later = trip({ id: 'later', start_date: '2026-06-01', end_date: '2026-06-10' })
    const moment = chooseMoment([later, running], at('2026-04-15T10:00:00Z'))
    expect(moment).toMatchObject({ phase: 'during' })
    expect(moment.phase === 'during' && moment.trip.id).toBe('now')
  })

  it('picks the nearest of several still to come', () => {
    const soon = trip({ id: 'soon', start_date: '2026-05-01', end_date: '2026-05-04' })
    const far = trip({ id: 'far', start_date: '2026-09-01', end_date: '2026-09-10' })
    const moment = chooseMoment([far, soon], at('2026-04-01T10:00:00Z'))
    expect(moment.phase === 'before' && moment.trip.id).toBe('soon')
  })

  it('looks back at the most recent one only when nothing is ahead', () => {
    const old = trip({ id: 'old', start_date: '2025-01-01', end_date: '2025-01-10' })
    const recent = trip({ id: 'recent', start_date: '2026-03-01', end_date: '2026-03-08' })
    const moment = chooseMoment([old, recent], at('2026-04-01T10:00:00Z'))
    expect(moment).toMatchObject({ phase: 'after', daysSince: 24 })
    expect(moment.phase === 'after' && moment.trip.id).toBe('recent')
  })

  it('treats a trip with a start and no end as one day long', () => {
    const oneDay = trip({ start_date: '2026-04-11', end_date: null })
    expect(chooseMoment([oneDay], at('2026-04-11T09:00:00Z'))).toMatchObject({
      phase: 'during',
      day: 1,
      total: 1,
    })
    expect(chooseMoment([oneDay], at('2026-04-12T09:00:00Z'))).toMatchObject({ phase: 'after' })
  })

  it('still shows a trip that has no dates at all', () => {
    // Otherwise creating a trip and not filling the dates in yet makes the
    // home screen claim you have none.
    const undated = trip({ start_date: null, end_date: null })
    expect(chooseMoment([undated], at('2026-04-01T10:00:00Z'))).toMatchObject({
      phase: 'undated',
    })
  })

  it('prefers a dated trip over an undated one', () => {
    const undated = trip({ id: 'undated', start_date: null, end_date: null })
    const dated = trip({ id: 'dated' })
    const moment = chooseMoment([undated, dated], at('2026-04-15T10:00:00Z'))
    expect(moment.phase).toBe('during')
  })
})

function booking(over: Partial<Booking>): Booking {
  return { id: 'b', trip_id: 't1', kind: 'hotel', status: 'confirmed', title: 'x', ...over } as Booking
}
const item = (done: boolean, id: string): ChecklistItem =>
  ({ id, trip_id: 't1', text: id, is_done: done }) as ChecklistItem
const doc = (id: string): Attachment => ({ id, trip_id: 't1', filename: id }) as Attachment

describe('what is still unfinished', () => {
  it('is ready when there is nothing at all to be ready about', () => {
    expect(readiness(bundle(), () => false).ready).toBe(true)
  })

  it('counts bookings that are booked but not confirmed', () => {
    const state = readiness(
      bundle({
        bookings: [
          booking({ id: '1', status: 'pending' }),
          booking({ id: '2', status: 'confirmed' }),
          booking({ id: '3', status: 'pending' }),
        ],
      }),
      () => false,
    )
    expect(state.pending.map((b) => b.id)).toEqual(['1', '3'])
    expect(state.ready).toBe(false)
  })

  it('is not ready while the packing list has an unticked line', () => {
    const state = readiness(
      bundle({ checklist: [item(true, 'a'), item(false, 'b')] }),
      () => false,
    )
    expect(state.packing).toMatchObject({ done: 1, total: 2 })
    expect(state.ready).toBe(false)
  })

  it('is not ready while a document is only on the server', () => {
    const onPhone = new Set(['a'])
    const state = readiness(
      bundle({ attachments: [doc('a'), doc('b')] }),
      (attachment) => onPhone.has(attachment.id),
    )
    expect(state.documents).toEqual({ saved: 1, total: 2 })
    expect(state.ready).toBe(false)
  })

  it('is ready once all three are clear', () => {
    const state = readiness(
      bundle({
        bookings: [booking({ status: 'confirmed' })],
        checklist: [item(true, 'a')],
        attachments: [doc('a')],
      }),
      () => true,
    )
    expect(state.ready).toBe(true)
  })
})

const expense = (day: string, amount: string): Expense =>
  ({
    id: day + amount,
    trip_id: 't1',
    category: 'food',
    description: 'x',
    amount,
    currency: 'EUR',
    rate: null,
    spent_at: day,
    payment_method: 'card',
  }) as Expense

describe('what today cost', () => {
  it('adds up only the expenses filed under that day', () => {
    const data = bundle({
      expenses: [expense('2026-04-12', '18.50'), expense('2026-04-12', '6.00'), expense('2026-04-13', '90.00')],
    })
    expect(spentOn(data, '2026-04-12')).toBeCloseTo(24.5, 2)
  })

  it('is zero on a day with nothing on it', () => {
    expect(spentOn(bundle({ expenses: [expense('2026-04-12', '18.50')] }), '2026-04-13')).toBe(0)
  })
})

describe('where you are today', () => {
  const stop = (id: string, arrive: string | null, depart: string | null) =>
    ({ id, trip_id: 't1', name: id, tz: 'Asia/Tokyo', arrive_date: arrive, depart_date: depart }) as never

  it('names the stop whose dates cover the day', () => {
    const data = bundle({
      stops: [stop('Tokyo', '2026-04-11', '2026-04-16'), stop('Kyoto', '2026-04-16', '2026-04-20')],
    })
    expect(stopToday(data, '2026-04-13')?.name).toBe('Tokyo')
    expect(stopToday(data, '2026-04-18')?.name).toBe('Kyoto')
  })

  it('says nothing for a day outside every stop', () => {
    const data = bundle({ stops: [stop('Tokyo', '2026-04-11', '2026-04-16')] })
    expect(stopToday(data, '2026-04-20')).toBeNull()
  })

  it('ignores a stop that never says when it starts', () => {
    const data = bundle({ stops: [stop('Ovunque', null, null)] })
    expect(stopToday(data, '2026-04-13')).toBeNull()
  })
})

describe('re-reading the day where you are standing', () => {
  // Rome is on summer time in April, so Tokyo is seven hours ahead: at
  // 16:00 UTC on the 12th it is already the 13th there and still the
  // evening of the 12th at home.
  const evening = at('2026-04-12T16:00:00Z')
  const home = trip({ primary_tz: 'Europe/Rome' })

  it('moves the day forward when the trip zone is ahead of home', () => {
    const chosen = chooseMoment([home], evening)
    expect(chosen).toMatchObject({ phase: 'during', day: 2 })
    expect(refine(chosen, 'Asia/Tokyo', evening)).toMatchObject({
      day: 3,
      today: '2026-04-13',
    })
  })

  it('leaves it alone when the zone is the same', () => {
    const chosen = chooseMoment([home], evening)
    expect(refine(chosen, 'Europe/Rome', evening)).toEqual(chosen)
  })

  it('leaves it alone when there is no zone to refine against', () => {
    const chosen = chooseMoment([home], evening)
    expect(refine(chosen, null, evening)).toEqual(chosen)
  })

  it('does not touch a trip that has not started or has ended', () => {
    const soon = chooseMoment([trip({ start_date: '2026-05-01', end_date: '2026-05-04' })], evening)
    expect(refine(soon, 'Asia/Tokyo', evening)).toEqual(soon)
  })

  it('does not push the last day past the end of the trip', () => {
    // The evening of the final day at home is already tomorrow in Tokyo,
    // and "day 15 of 14" is not a thing to show anyone.
    const lastEvening = at('2026-04-24T16:00:00Z')
    const chosen = chooseMoment([home], lastEvening)
    expect(chosen).toMatchObject({ day: 14, total: 14 })
    expect(refine(chosen, 'Asia/Tokyo', lastEvening)).toEqual(chosen)
  })
})
