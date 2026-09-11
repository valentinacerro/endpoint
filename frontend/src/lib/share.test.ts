import { describe, expect, it } from 'vitest'

import { linksIn, looksLikeAList, shortenLink } from './share'

describe('linksIn', () => {
  it('pulls the link out of what Android actually shares', () => {
    // Google Maps does not share a bare URL: it shares the name and the
    // link together, which is why the share target cannot just read the
    // `url` field and be done.
    expect(linksIn('Senso-ji\nhttps://maps.app.goo.gl/abc123')).toEqual([
      'https://maps.app.goo.gl/abc123',
    ])
  })

  it('reads a whole list pasted at once, in order', () => {
    const pasted = `
      https://maps.app.goo.gl/one
      https://maps.app.goo.gl/two
      https://maps.app.goo.gl/three
    `
    expect(linksIn(pasted)).toHaveLength(3)
    expect(linksIn(pasted)[0]).toBe('https://maps.app.goo.gl/one')
  })

  it('does not import the same place twice', () => {
    // A share often carries the same URL in both `text` and `url`.
    const both = 'https://maps.app.goo.gl/abc https://maps.app.goo.gl/abc'
    expect(linksIn(both)).toEqual(['https://maps.app.goo.gl/abc'])
  })

  it('leaves the sentence’s punctuation out of the link', () => {
    expect(linksIn('vai qui (https://maps.app.goo.gl/abc).')).toEqual([
      'https://maps.app.goo.gl/abc',
    ])
  })

  it('keeps punctuation that is part of the link', () => {
    const real = 'https://www.google.com/maps/place/Senso-ji/@35.7,139.8,17z'
    expect(linksIn(real)).toEqual([real])
  })

  it('finds nothing in text with no links', () => {
    expect(linksIn('ricordati di andare al mercato')).toEqual([])
    expect(linksIn('')).toEqual([])
    expect(linksIn(null)).toEqual([])
  })
})

describe('looksLikeAList', () => {
  it('recognises a shared list', () => {
    expect(looksLikeAList('https://www.google.com/maps/placelists/list/abc')).toBe(true)
    expect(looksLikeAList('https://www.google.com/local/userlists/list/abc')).toBe(true)
  })

  it('does not mistake a single place for one', () => {
    expect(looksLikeAList('https://www.google.com/maps/place/Senso-ji/@35.7,139.8,17z')).toBe(false)
  })

  it('admits it cannot tell from a short link', () => {
    // Which it is only becomes clear once the redirect is followed, and
    // that is the server's job.
    expect(looksLikeAList('https://maps.app.goo.gl/abc')).toBe(false)
  })
})

describe('shortenLink', () => {
  it('uses the place name Maps puts in the path', () => {
    expect(shortenLink('https://www.google.com/maps/place/Tokyo+Skytree/@35.7,139.8')).toBe(
      'Tokyo Skytree',
    )
  })

  it('does not label a link with its viewport coordinates', () => {
    // The last path segment is usually "@35.7,139.8,17z", which tells you
    // nothing about which of a dozen links is being fetched.
    expect(shortenLink('https://www.google.com/maps/place/Senso-ji/@35.7,139.8,17z')).toBe(
      'Senso-ji',
    )
  })

  it('falls back to the host when the path says nothing', () => {
    expect(shortenLink('https://maps.app.goo.gl/a')).toBe('maps.app.goo.gl')
  })

  it('does not throw on something that is not a URL', () => {
    expect(shortenLink('not a url at all')).toBe('not a url at all')
  })
})

describe('a single link, which is still the common case', () => {
  it('reads one pasted link exactly as before', () => {
    expect(linksIn('https://maps.app.goo.gl/abc123')).toEqual(['https://maps.app.goo.gl/abc123'])
  })

  it('tolerates the spaces a paste leaves around it', () => {
    expect(linksIn('  https://maps.app.goo.gl/abc123  \n')).toEqual([
      'https://maps.app.goo.gl/abc123',
    ])
  })

  it('finds nothing in a link missing its scheme', () => {
    // Worth pinning: the form has to say so rather than just greying out
    // its button, which is what it used to do.
    expect(linksIn('maps.app.goo.gl/abc123')).toEqual([])
  })
})
