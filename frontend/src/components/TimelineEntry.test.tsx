import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { Booking, Place } from '../api/types'
import { ICON_PATHS, type IconName } from './Icon'
import { TimelineEntry } from './TimelineEntry'

/**
 * The row that appears more often than anything else in the app, rendered
 * for real.
 *
 * This exists because of a bug the type checker could not see. When the
 * emoji became icons, `BOOKING_KIND_ICON` stopped holding a glyph and
 * started holding a NAME — and the marker still wrote `{icon}` into the
 * JSX. A string is a perfectly legal child, so `tsc` was happy and every
 * itinerary row typeset the word "hotel" inside its dot.
 *
 * Nothing in the suite could catch that: every other test here is over
 * pure functions. So this one renders the component and reads what comes
 * out, which is the only way to tell a drawing from its name.
 */

const NAMES = Object.keys(ICON_PATHS) as IconName[]

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    trip_id: 't1',
    stop_id: null,
    kind: 'hotel',
    status: 'confirmed',
    title: 'Ryokan Sanga',
    provider: null,
    confirmation_code: null,
    start_at: '2026-04-12T06:30:00Z',
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Booking
}

function place(over: Partial<Place> = {}): Place {
  return {
    id: 'p1',
    trip_id: 't1',
    stop_id: null,
    name: 'Fushimi Inari',
    category: 'shrine',
    priority: 'must_see',
    address: null,
    lat: null,
    lon: null,
    url: null,
    notes: null,
    visit_minutes: 90,
    weather_exposure: 'outdoor',
    description: null,
    image_url: null,
    opening_hours: null,
    planned_start_at: null,
    planned_tz: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Place
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

function renderBooking(over: Partial<Booking> = {}, documents = 0): string {
  return render(
    <TimelineEntry
      placed={{
        entry: {
          type: 'booking',
          id: 'b1',
          startAt: '2026-04-12T06:30:00Z',
          busyUntil: null,
          zone: 'Asia/Tokyo',
          booking: booking(over),
        },
        gapMinutes: null,
        overlaps: false,
      }}
      showZone={false}
      tripId="t1"
      documents={documents}
    />,
  )
}

/** The words between tags — what a reader actually sees. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ')
}

describe('a row of the itinerary', () => {
  it('draws the kind rather than naming it', () => {
    const markup = renderBooking({ kind: 'hotel' })
    expect(markup).toContain(ICON_PATHS.hotel)
    expect(visibleText(markup)).toContain('Ryokan Sanga')
  })

  it('never shows an icon name as a word, for any kind', () => {
    const kinds = [
      'hotel',
      'flight',
      'train',
      'bus',
      'ferry',
      'car_rental',
      'activity',
      'restaurant',
      'other',
    ] as const

    for (const kind of kinds) {
      const words = visibleText(renderBooking({ kind })).split(/\s+/)
      for (const name of NAMES) {
        expect(words, `${kind} rendered the icon name "${name}"`).not.toContain(name)
      }
    }
  })

  it('draws the paperclip when there are documents, and nothing when there are none', () => {
    expect(renderBooking({}, 2)).toContain(ICON_PATHS.paperclip)
    expect(renderBooking({}, 0)).not.toContain(ICON_PATHS.paperclip)
  })

  it('draws a pin for a place, and its name in words', () => {
    const markup = render(
      <TimelineEntry
        placed={{
          entry: {
            type: 'place',
            id: 'p1',
            startAt: '2026-04-12T00:30:00Z',
            busyUntil: '2026-04-12T02:00:00Z',
            zone: 'Asia/Tokyo',
            place: place(),
          },
          gapMinutes: null,
          overlaps: false,
        }}
        showZone={false}
        tripId="t1"
        documents={0}
      />,
    )
    expect(markup).toContain(ICON_PATHS.pin)
    expect(visibleText(markup)).toContain('Fushimi Inari')
  })
})
