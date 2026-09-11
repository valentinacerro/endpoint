import { describe, expect, it } from 'vitest'

import type { Booking, Stop } from '../api/types'

import { printableDetails, stopsSummary } from './printable'

function booking(partial: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    trip_id: 'trip',
    stop_id: null,
    kind: 'hotel',
    status: 'confirmed',
    title: 'Hotel Gracery',
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

function stop(partial: Partial<Stop> & { name: string; position: number }): Stop {
  return {
    id: partial.name,
    trip_id: 'trip',
    country_code: 'JP',
    tz: 'Asia/Tokyo',
    arrive_date: null,
    depart_date: null,
    lat: null,
    lon: null,
    notes: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

describe('printableDetails', () => {
  it('puts the confirmation code first', () => {
    // The one thing you cannot reconstruct from memory at a reception desk.
    const details = printableDetails(
      booking({ confirmation_code: 'ABC123', provider: 'Booking', phone: '+81 3 1234 5678' }),
    )
    expect(details[0]).toEqual({ label: 'print.code', value: 'ABC123' })
  })

  it('leaves out the fields that are empty', () => {
    const details = printableDetails(booking({ confirmation_code: 'ABC123' }))
    expect(details.map((detail) => detail.label)).toEqual(['print.code'])
  })

  it('treats a field of spaces as empty', () => {
    // A blank line of ink is worse than no line.
    expect(printableDetails(booking({ provider: '   ' }))).toEqual([])
  })

  it('trims what it does print', () => {
    expect(printableDetails(booking({ confirmation_code: '  ABC123 ' }))[0].value).toBe('ABC123')
  })

  it('joins both ends of a journey', () => {
    const details = printableDetails(
      booking({ kind: 'flight', origin_label: 'Roma FCO', destination_label: 'Tokyo HND' }),
    )
    expect(details[0]).toEqual({ label: 'print.route', value: 'Roma FCO → Tokyo HND' })
  })

  it('prints one end when only one is known', () => {
    expect(printableDetails(booking({ destination_label: 'Tokyo HND' }))[0].value).toBe('Tokyo HND')
  })

  it('keeps the order that a desk asks for things', () => {
    const details = printableDetails(
      booking({
        confirmation_code: 'ABC123',
        provider: 'Booking',
        address: '1-19-1 Kabukicho',
        phone: '+81 3 1234 5678',
        notes: 'late check-in',
      }),
    )
    expect(details.map((detail) => detail.label)).toEqual([
      'print.code',
      'print.provider',
      'print.address',
      'print.phone',
      'print.notes',
    ])
  })
})

describe('stopsSummary', () => {
  it('lists the stops in order with their dates', () => {
    const summary = stopsSummary([
      stop({ name: 'Kyoto', position: 1, arrive_date: '2026-04-16', depart_date: '2026-04-20' }),
      stop({ name: 'Tokyo', position: 0, arrive_date: '2026-04-12', depart_date: '2026-04-16' }),
    ])
    expect(summary).toBe('Tokyo 12/4–16/4 · Kyoto 16/4–20/4')
  })

  it('does not repeat the date for a single night', () => {
    const summary = stopsSummary([
      stop({ name: 'Hakone', position: 0, arrive_date: '2026-04-16', depart_date: '2026-04-16' }),
    ])
    expect(summary).toBe('Hakone 16/4')
  })

  it('drops the leading zeroes a printed line has no room for', () => {
    const summary = stopsSummary([
      stop({ name: 'Osaka', position: 0, arrive_date: '2026-04-05', depart_date: '2026-04-09' }),
    ])
    expect(summary).toBe('Osaka 5/4–9/4')
  })

  it('names a stop with no dates anyway', () => {
    expect(stopsSummary([stop({ name: 'Nara', position: 0 })])).toBe('Nara')
  })

  it('is empty when there are no stops', () => {
    expect(stopsSummary([])).toBe('')
  })

  it('does not reorder the caller’s array', () => {
    const stops = [stop({ name: 'Kyoto', position: 1 }), stop({ name: 'Tokyo', position: 0 })]
    stopsSummary(stops)
    expect(stops.map((entry) => entry.name)).toEqual(['Kyoto', 'Tokyo'])
  })
})
