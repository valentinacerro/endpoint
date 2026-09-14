import { describe, expect, it } from 'vitest'

import { canOpenInMaps, mapsDirectionsUrl, mapsSearchUrl } from './maps'

describe('building a link to Google Maps', () => {
  it('opens a place by its name, not by two numbers', () => {
    // It used to send the coordinates, on the grounds that a pin is exact
    // and a name is a search that can land on the wrong branch of a
    // chain. Both true, and beside the point: Maps then showed
    // "35.7147, 139.7966" — no name, no photograph, no opening hours,
    // none of what you opened Maps for.
    const url = mapsSearchUrl({ lat: 35.7147, lon: 139.7966, name: 'Senso-ji' })
    expect(url).toContain('Senso-ji')
    expect(url).not.toContain('35.7147')
  })

  it('sends the address with the name, which is what keeps Ichiran in Shibuya', () => {
    const url = mapsSearchUrl({
      name: 'Ichiran',
      address: '1-22-7 Jinnan, Shibuya',
      lat: 35.66,
      lon: 139.7,
    })
    expect(decodeURIComponent(url ?? '')).toContain('Ichiran, 1-22-7 Jinnan, Shibuya')
  })

  it('still navigates to the exact point, whatever it is called', () => {
    // This one ends with a phone telling you to turn left, and it should
    // be turning towards the place you saved rather than towards whatever
    // a search matched.
    const url = mapsDirectionsUrl({ lat: 35.7147, lon: 139.7966, name: 'Senso-ji' })
    expect(url).toContain('destination=35.7147%2C139.7966')
    expect(url).not.toContain('Senso')
  })

  it('navigates by name only when there is no position at all', () => {
    expect(mapsDirectionsUrl({ name: 'Nezu Museum' })).toContain('Nezu%20Museum')
  })

  it('falls back to the address, then to the name', () => {
    expect(mapsSearchUrl({ address: '1-19-1 Kabukicho, Shinjuku' })).toContain('Kabukicho')
    expect(mapsSearchUrl({ name: 'Nezu Museum' })).toContain('Nezu%20Museum')
  })

  it('escapes what it puts in the query', () => {
    const url = mapsSearchUrl({ name: 'Caffè & Co, Roma' })
    expect(url).toContain('Caff%C3%A8%20%26%20Co')
  })

  it('handles coordinates at zero without treating them as missing', () => {
    // 0 is falsy in JavaScript, and the Gulf of Guinea is a real place.
    expect(mapsSearchUrl({ lat: 0, lon: 0 })).toContain('query=0%2C0')
    expect(mapsDirectionsUrl({ lat: 0, lon: 0 })).toContain('destination=0%2C0')
  })

  it('handles negative coordinates', () => {
    expect(mapsDirectionsUrl({ lat: -54.8019, lon: -68.303 })).toContain('-54.8019%2C-68.303')
  })

  it('gives nothing when there is nothing to point at', () => {
    expect(mapsSearchUrl({})).toBeNull()
    expect(mapsSearchUrl({ name: '   ' })).toBeNull()
    expect(mapsSearchUrl({ lat: 35.7, lon: null })).toBeNull()
    expect(canOpenInMaps({})).toBe(false)
  })

  it('builds directions without an origin', () => {
    // Maps then starts from wherever you are, which on the road is the
    // only starting point that makes sense.
    const url = mapsDirectionsUrl({ lat: 35.7147, lon: 139.7966 })
    expect(url).toContain('destination=35.7147%2C139.7966')
    expect(url).not.toContain('origin=')
  })
})
