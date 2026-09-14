import { describe, expect, it } from 'vitest'

import type { Place, Suggestion } from '../api/types'
import { byTaste, categoriesIn, isTheSamePlace, onlyNew } from './suggest'

const suggestion = (over: Partial<Suggestion> = {}): Suggestion =>
  ({
    name: 'Sensō-ji',
    lat: 35.7148,
    lon: 139.7967,
    category: 'temple',
    fame: 31,
    wikidata: 'Q200787',
    osm_id: 'way/1',
    ...over,
  }) as Suggestion

const place = (over: Partial<Place> = {}): Place =>
  ({
    id: 'p1',
    trip_id: 't1',
    name: 'Senso-ji',
    category: 'temple',
    priority: 'normal',
    lat: 35.7148,
    lon: 139.7967,
    visit_minutes: 60,
    ...over,
  }) as Place

describe('recognising a place you already have', () => {
  it('matches the same building however it is spelled', () => {
    // "Sensō-ji" from OpenStreetMap against "Senso-ji" from a Maps link:
    // the names differ, the position does not.
    expect(isTheSamePlace(place(), suggestion())).toBe(true)
  })

  it('tolerates the two sources disagreeing by a few dozen metres', () => {
    // 0.0005° of latitude is about 55 m — routine between OSM's building
    // centroid and Google's pin on the gate.
    expect(isTheSamePlace(place({ lat: 35.7153 }), suggestion())).toBe(true)
  })

  it('keeps two genuinely different sights apart when they are neighbours', () => {
    // Asakusa Shrine sits inside Senso-ji's grounds, about 160 m from the
    // main hall. It is a separate place and must still be offered.
    const shrine = suggestion({ name: 'Asakusa Shrine', lat: 35.7163, lon: 139.7974 })
    expect(isTheSamePlace(place(), shrine)).toBe(false)
  })

  it('falls back to the name for a place saved without a position', () => {
    const unplaced = place({ lat: null, lon: null, name: '  SENSŌ-JI ' })
    expect(isTheSamePlace(unplaced, suggestion({ name: 'Sensō-ji' }))).toBe(true)
    expect(isTheSamePlace(unplaced, suggestion({ name: 'Asakusa Shrine' }))).toBe(false)
  })

  it('does not match two different places that share a name, when both are placed', () => {
    // Every other neighbourhood in Japan has an Inari shrine.
    const mine = place({ name: 'Inari Shrine', lat: 35.71, lon: 139.79 })
    const theirs = suggestion({ name: 'Inari Shrine', lat: 34.96, lon: 135.77 })
    expect(isTheSamePlace(mine, theirs)).toBe(false)
  })
})

describe('filtering the list', () => {
  it('drops what you have and keeps the rest', () => {
    const suggestions = [
      suggestion({ osm_id: 'way/1' }),
      suggestion({ osm_id: 'way/2', name: 'Tokyo Skytree', lat: 35.7101, lon: 139.8107 }),
    ]
    expect(onlyNew(suggestions, [place()]).map((s) => s.osm_id)).toEqual(['way/2'])
  })

  it('returns everything when you have nothing', () => {
    expect(onlyNew([suggestion()], [])).toHaveLength(1)
  })
})

const named = (name: string, category: string, fame: number): Suggestion =>
  ({
    name,
    lat: 35.7,
    lon: 139.8,
    category,
    fame,
    wikidata: null,
    osm_id: name,
  }) as Suggestion

describe('ordering by what you said you care about', () => {
  const list = [
    named('Tokyo Skytree', 'sight', 72),
    named('Tokyo National Museum', 'museum', 52),
    named('Sensō-ji', 'temple', 31),
    named('Tsukiji Market', 'shopping', 4),
    named('A ramen counter', 'food', 0),
  ]

  it('leaves the order alone when nothing is ticked', () => {
    // An empty answer means "everything", which is also what the button
    // did before there was anything to tick.
    expect(byTaste(list, new Set()).map((s) => s.name)).toEqual(list.map((s) => s.name))
  })

  it('brings the kinds you want to the front, obscure ones included', () => {
    // The whole point: a ramen counter nobody has written about beats the
    // Skytree, if eating is what you came for.
    const order = byTaste(list, new Set(['food', 'shopping'] as never)).map((s) => s.name)
    expect(order.slice(0, 2)).toEqual(['Tsukiji Market', 'A ramen counter'])
  })

  it('keeps fame as the order within each half', () => {
    const order = byTaste(list, new Set(['museum', 'temple'] as never)).map((s) => s.name)
    expect(order).toEqual([
      'Tokyo National Museum',
      'Sensō-ji',
      'Tokyo Skytree',
      'Tsukiji Market',
      'A ramen counter',
    ])
  })

  it('drops nothing — the rest is demoted, not hidden', () => {
    expect(byTaste(list, new Set(['food'] as never))).toHaveLength(list.length)
  })

  it('offers only the kinds that are actually there', () => {
    expect(categoriesIn(list).sort()).toEqual(['food', 'museum', 'shopping', 'sight', 'temple'])
  })
})
