import { describe, expect, it } from 'vitest'

import type { Place, Suggestion, TripBundle } from '../api/types'

import type { Gap } from './autoPlan'
import { asPlace, bundleWith, proposeFor } from './fillGaps'

/**
 * What the app proposes when you have not collected anything.
 *
 * Two things must hold, and they are the two that make the difference
 * between a helpful list and an insulting one: it never offers back
 * somewhere you already saved, and it never offers more than the days
 * have room for.
 */

const suggestion = (over: Partial<Suggestion> & { name: string }): Suggestion => ({
  lat: 35.7148,
  lon: 139.7967,
  category: 'sight',
  fame: 10,
  wikidata: null,
  osm_id: `n/${over.name}`,
  ...over,
})

const gap: Gap = {
  stopId: 'tokyo',
  stopName: 'Tokyo',
  centre: { lat: 35.6896, lon: 139.7006 },
  emptyDays: ['2026-04-12', '2026-04-13'],
  wanted: 8,
}

let n = 0
const newId = () => `proposed-${n++}`

describe('proposing places for an empty city', () => {
  it('stops at what the empty days have room for', () => {
    const found = Array.from({ length: 30 }, (_, i) => suggestion({ name: `p${i}` }))
    expect(proposeFor('trip', gap, found, [], new Set(), newId)).toHaveLength(8)
  })

  it('never offers back something already on your list', () => {
    // Being shown "Sensō-ji" as a discovery when Sensō-ji is the one place
    // you did save reads as the app not having looked at your trip.
    const mine = [{ id: 'a', name: 'Sensō-ji', lat: 35.7148, lon: 139.7967 } as Place]
    // Different coordinates, because `onlyNew` matches on where a place
    // is and not only on what it is called — two names for one spot are
    // one place, which is the point of it.
    const found = [
      suggestion({ name: 'Sensō-ji' }),
      suggestion({ name: 'Ueno Park', lat: 35.7141, lon: 139.7744 }),
    ]
    const proposed = proposeFor('trip', gap, found, mine, new Set(), newId)
    expect(proposed.map((item) => item.place.name)).toEqual(['Ueno Park'])
  })

  it('puts what you said you care about first', () => {
    const found = [suggestion({ name: 'A museum', category: 'museum' }), suggestion({ name: 'A park', category: 'park' })]
    const proposed = proposeFor('trip', { ...gap, wanted: 2 }, found, [], new Set(['park']), newId)
    expect(proposed[0].place.name).toBe('A park')
  })

  it('says which city it went looking in', () => {
    const proposed = proposeFor('trip', gap, [suggestion({ name: 'Ueno' })], [], new Set(), newId)
    expect(proposed[0].stopName).toBe('Tokyo')
    // Stated outright rather than left to be inferred: it was this app
    // that chose where to look, so it can say so.
    expect(proposed[0].place.stop_id).toBe('tokyo')
  })
})

describe('a place made out of a suggestion', () => {
  it('reads its exposure from its category, like every other place', () => {
    expect(asPlace('trip', 'tokyo', suggestion({ name: 'Meiji', category: 'shrine' }), 'x')
      .weather_exposure).toBe('outdoor')
  })

  it('carries the same default visit length as one you type', () => {
    expect(asPlace('trip', 'tokyo', suggestion({ name: 'Ueno' }), 'x').visit_minutes).toBe(60)
  })

  it('links to what is written about it, when there is something', () => {
    expect(asPlace('trip', 'tokyo', suggestion({ name: 'Ueno', wikidata: 'Q123' }), 'x').url)
      .toBe('https://www.wikidata.org/wiki/Q123')
    expect(asPlace('trip', 'tokyo', suggestion({ name: 'Ueno' }), 'x').url).toBeNull()
  })
})

describe('the trip the planner is shown', () => {
  it('is the real one with the proposals added, and the real one untouched', () => {
    const bundle = { places: [{ id: 'mine' } as Place] } as TripBundle
    const proposed = proposeFor('trip', gap, [suggestion({ name: 'Ueno' })], [], new Set(), newId)
    const copy = bundleWith(bundle, proposed)

    expect(copy.places).toHaveLength(2)
    expect(bundle.places).toHaveLength(1)
  })
})
