import { describe, expect, it } from 'vitest'

import type { Booking, Place, TripBundle } from '../api/types'

import { search } from './search'

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

function place(partial: Partial<Place> & { id: string; name: string }): Place {
  return {
    trip_id: 'trip',
    stop_id: null,
    category: 'sight',
    priority: 'normal',
    weather_exposure: 'mixed',
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

function bundle(partial: Partial<TripBundle> = {}): TripBundle {
  return {
    trip: {
      id: 'trip',
      title: 'Japan',
      destination_label: null,
      start_date: '2026-04-10',
      end_date: '2026-04-24',
      primary_tz: 'Asia/Tokyo',
      primary_currency: 'JPY',
      budget_amount: null,
      status: 'planned',
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
    attachments: [],
    generated_at: '2026-04-01T00:00:00Z',
    ...partial,
  }
}

describe('search', () => {
  it('finds a booking by its name', () => {
    const results = search(
      bundle({ bookings: [booking({ id: 'b1', title: 'Hotel Gracery Shinjuku' })] }),
      'gracery',
    )
    expect(results.map((result) => result.id)).toEqual(['b1'])
    expect(results[0].to).toBe('/trips/trip/bookings/b1')
  })

  it('finds it from the start of a word, not just the whole word', () => {
    const results = search(
      bundle({ bookings: [booking({ id: 'b1', title: 'Hotel Gracery Shinjuku' })] }),
      'grac',
    )
    expect(results).toHaveLength(1)
  })

  it('ignores accents, so Kyoto finds Kyōto', () => {
    const results = search(bundle({ places: [place({ id: 'p1', name: 'Kyōto Gosho' })] }), 'kyoto')
    expect(results).toHaveLength(1)
  })

  it('finds a confirmation code typed without its punctuation', () => {
    // How a code is printed and how it is remembered are different things.
    const results = search(
      bundle({
        bookings: [booking({ id: 'b1', title: 'Ryokan', confirmation_code: 'ABC-123 / 45' })],
      }),
      'abc12345',
    )
    expect(results).toHaveLength(1)
  })

  it('finds a code by the fragment you remember', () => {
    const results = search(
      bundle({ bookings: [booking({ id: 'b1', title: 'Ryokan', confirmation_code: 'XY-99871' })] }),
      '99871',
    )
    expect(results).toHaveLength(1)
  })

  it('ranks a hit in the name above a hit in the notes', () => {
    const results = search(
      bundle({
        bookings: [
          booking({ id: 'aside', title: 'Ryokan', notes: 'ten minutes from the museum' }),
          booking({ id: 'the-one', title: 'Museum of Modern Art' }),
        ],
      }),
      'museum',
    )
    expect(results.map((result) => result.id)).toEqual(['the-one', 'aside'])
  })

  it('ranks a whole-field match above a fragment', () => {
    const results = search(
      bundle({
        places: [
          place({ id: 'longer', name: 'Nara Deer Park Entrance' }),
          place({ id: 'exact', name: 'Nara' }),
        ],
      }),
      'nara',
    )
    expect(results[0].id).toBe('exact')
  })

  it('narrows as you add words rather than widening', () => {
    const two = bundle({
      places: [place({ id: 'p1', name: 'Senso-ji Temple' }), place({ id: 'p2', name: 'Temple Bar' })],
    })
    expect(search(two, 'temple')).toHaveLength(2)
    expect(search(two, 'temple senso').map((result) => result.id)).toEqual(['p1'])
  })

  it('matches words in any order', () => {
    const results = search(
      bundle({ places: [place({ id: 'p1', name: 'Senso-ji Temple' })] }),
      'temple senso',
    )
    expect(results).toHaveLength(1)
  })

  it('searches across every kind of record', () => {
    const everything = bundle({
      bookings: [booking({ id: 'b', title: 'Sakura Hotel' })],
      places: [place({ id: 'p', name: 'Sakura Park' })],
      stops: [
        {
          id: 's',
          trip_id: 'trip',
          name: 'Sakura',
          country_code: 'JP',
          tz: 'Asia/Tokyo',
          arrive_date: '2026-04-10',
          depart_date: '2026-04-12',
          position: 0,
          lat: null,
          lon: null,
          notes: null,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      expenses: [
        {
          id: 'e',
          trip_id: 'trip',
          stop_id: null,
          booking_id: null,
          description: 'Sakura mochi',
          amount: '400',
          currency: 'JPY',
          spent_at: '2026-04-11',
          category: 'food',
          payment_method: 'cash',
          rate: null,
          rate_date: null,
          rate_source: null,
          notes: null,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      checklist: [
        {
          id: 'c',
          trip_id: 'trip',
          text: 'Sakura guidebook',
          category: 'other',
          is_done: false,
          position: 0,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      day_notes: [
        {
          id: 'n',
          trip_id: 'trip',
          day: '2026-04-11',
          note: 'the sakura should be out',
          created_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      diary: [
        {
          id: 'd',
          trip_id: 'trip',
          day: '2026-04-11',
          text: 'the sakura were out after all',
          created_at: '2026-04-01T00:00:00Z',
          updated_at: '2026-04-01T00:00:00Z',
        },
      ],
      attachments: [
        {
          id: 'a',
          trip_id: 'trip',
          stop_id: null,
          booking_id: null,
          kind: 'voucher',
          filename: 'sakura-ticket.pdf',
          content_type: 'application/pdf',
          byte_size: 1000,
          sha256: 'x'.repeat(64),
          storage: 'db',
          created_at: '2026-04-01T00:00:00Z',
        },
      ],
    })

    const kinds = search(everything, 'sakura').map((result) => result.kind)
    expect(new Set(kinds)).toEqual(
      new Set([
        'booking',
        'place',
        'stop',
        'expense',
        'checklist',
        'note',
        'diary',
        'document',
      ]),
    )
  })

  it('sends a document to the booking it belongs to', () => {
    const results = search(
      bundle({
        attachments: [
          {
            id: 'a',
            trip_id: null,
            stop_id: null,
            booking_id: 'b1',
            kind: 'voucher',
            filename: 'hotel-voucher.pdf',
            content_type: 'application/pdf',
            byte_size: 1000,
            sha256: 'x'.repeat(64),
            storage: 'db',
            created_at: '2026-04-01T00:00:00Z',
          },
        ],
      }),
      'voucher',
    )
    expect(results[0].to).toBe('/trips/trip/bookings/b1')
  })

  it('returns nothing for an empty query rather than everything', () => {
    const full = bundle({ places: [place({ id: 'p1', name: 'Senso-ji' })] })
    expect(search(full, '')).toEqual([])
    expect(search(full, '   ')).toEqual([])
  })

  it('returns nothing when nothing matches', () => {
    expect(search(bundle({ places: [place({ id: 'p1', name: 'Senso-ji' })] }), 'zzz')).toEqual([])
  })

  it('orders equal scores predictably, so the list does not shuffle', () => {
    const results = search(
      bundle({
        places: [place({ id: 'p1', name: 'Temple B' }), place({ id: 'p2', name: 'Temple A' })],
      }),
      'temple',
    )
    expect(results.map((result) => result.title)).toEqual(['Temple A', 'Temple B'])
  })

  it('does not let a punctuation-stripped query match across ordinary words', () => {
    // "ho" + "tel" must not find "Hotel" by way of the code path, or every
    // short query would start matching things it has no business matching.
    const results = search(
      bundle({ bookings: [booking({ id: 'b1', title: 'Hotel Gracery', notes: 'nice place' })] }),
      'telgracery',
    )
    expect(results).toEqual([])
  })
})
