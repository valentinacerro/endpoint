import { describe, expect, it } from 'vitest'

import type { Place, Suggestion } from '../api/types'
import { isTheSamePlace, onlyNew } from './suggest'

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
