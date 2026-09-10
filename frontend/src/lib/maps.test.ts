import { describe, expect, it } from 'vitest'

import { canOpenInMaps, mapsDirectionsUrl, mapsSearchUrl } from './maps'

describe('building a link to Google Maps', () => {
  it('prefers coordinates over a name', () => {
    // A name is a search and can land on the wrong branch of a chain;
    // a coordinate pair drops the pin exactly where it belongs.
    const url = mapsSearchUrl({ lat: 35.7147, lon: 139.7966, name: 'Senso-ji' })
    expect(url).toContain('query=35.7147%2C139.7966')
    expect(url).not.toContain('Senso')
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
  })

  it('handles negative coordinates', () => {
    expect(mapsSearchUrl({ lat: -54.8019, lon: -68.303 })).toContain('-54.8019%2C-68.303')
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
