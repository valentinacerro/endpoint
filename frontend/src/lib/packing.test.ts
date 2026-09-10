import { describe, expect, it } from 'vitest'

import type { ChecklistItem } from '../api/types'

import { group, nextPosition, normalise, progress, suggestions } from './packing'

function item(partial: Partial<ChecklistItem> & { id: string }): ChecklistItem {
  return {
    trip_id: 'trip',
    text: 'thing',
    category: 'other',
    is_done: false,
    position: 0,
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    ...partial,
  }
}

const JAPAN = {
  startDate: '2026-04-10',
  endDate: '2026-04-24',
  currency: 'JPY',
  countryCodes: ['JP'],
}

describe('progress', () => {
  it('counts what is done', () => {
    const done = progress([
      item({ id: 'a', is_done: true }),
      item({ id: 'b' }),
      item({ id: 'c', is_done: true }),
    ])
    expect(done).toEqual({ done: 2, total: 3, fraction: 2 / 3 })
  })

  it('is zero rather than NaN on an empty list', () => {
    expect(progress([])).toEqual({ done: 0, total: 0, fraction: 0 })
  })
})

describe('group', () => {
  it('orders sections the way you pack, papers first', () => {
    const groups = group([
      item({ id: 'a', category: 'other' }),
      item({ id: 'b', category: 'documents' }),
      item({ id: 'c', category: 'clothes' }),
    ])
    expect(groups.map((entry) => entry.category)).toEqual(['documents', 'clothes', 'other'])
  })

  it('leaves out categories with nothing in them', () => {
    const groups = group([item({ id: 'a', category: 'health' })])
    expect(groups).toHaveLength(1)
  })

  it('orders within a section by position, then by age', () => {
    const groups = group([
      item({ id: 'late', position: 0, created_at: '2026-04-02T10:00:00Z' }),
      item({ id: 'last', position: 5 }),
      item({ id: 'early', position: 0, created_at: '2026-04-01T10:00:00Z' }),
    ])
    expect(groups[0].items.map((entry) => entry.id)).toEqual(['early', 'late', 'last'])
  })
})

describe('nextPosition', () => {
  it('goes after everything already there', () => {
    expect(nextPosition([item({ id: 'a', position: 3 }), item({ id: 'b', position: 7 })])).toBe(8)
  })

  it('starts at zero', () => {
    expect(nextPosition([])).toBe(0)
  })
})

describe('normalise', () => {
  it('ignores case, accents and stray spaces', () => {
    expect(normalise('  Carta  d’identità ')).toBe(normalise("carta d’identita"))
  })

  it('keeps genuinely different things apart', () => {
    expect(normalise('Calzini')).not.toBe(normalise('Calze'))
  })
})

describe('suggestions', () => {
  it('does not offer something already on the list', () => {
    const offered = suggestions(JAPAN, [item({ id: 'a', text: 'Passaporto' })])
    expect(offered.map((entry) => entry.text)).not.toContain('Passaporto')
  })

  it('matches an existing line even when it was typed without the accent', () => {
    const offered = suggestions(JAPAN, [item({ id: 'a', text: 'carta d’identita' })])
    expect(offered.map((entry) => entry.text)).not.toContain('Carta d’identità')
  })

  it('names the plug type when it knows the country', () => {
    const adapter = suggestions(JAPAN, []).find((entry) => entry.text.includes('Adattatore'))
    expect(adapter?.text).toContain('A/B, 100V')
    expect(adapter?.category).toBe('electronics')
  })

  it('falls back to a universal adapter rather than guessing a voltage', () => {
    const offered = suggestions({ ...JAPAN, countryCodes: ['ZZ'] }, [])
    const adapter = offered.find((entry) => entry.text.includes('Adattatore'))
    expect(adapter?.text).toBe('Adattatore presa universale')
  })

  it('says nothing about plugs when it does not know where you are going', () => {
    const offered = suggestions({ ...JAPAN, countryCodes: [] }, [])
    expect(offered.some((entry) => entry.text.includes('Adattatore'))).toBe(false)
  })

  it('lists every plug type when the trip crosses a border', () => {
    const offered = suggestions({ ...JAPAN, countryCodes: ['JP', 'KR'] }, [])
    const adapter = offered.find((entry) => entry.text.includes('Adattatore'))
    expect(adapter?.text).toContain('A/B, 100V')
    expect(adapter?.text).toContain('C/F, 220V')
  })

  it('caps the clothes count at a laundry-sized week', () => {
    const offered = suggestions(JAPAN, [])
    // 14 nights, but you do washing rather than carrying fifteen shirts.
    expect(offered.map((entry) => entry.text)).toContain('Magliette (7)')
  })

  it('scales the clothes count on a short trip', () => {
    const offered = suggestions({ ...JAPAN, startDate: '2026-04-10', endDate: '2026-04-12' }, [])
    expect(offered.map((entry) => entry.text)).toContain('Magliette (3)')
  })

  it('suggests detergent only when the trip is long enough to need it', () => {
    const short = suggestions({ ...JAPAN, endDate: '2026-04-13' }, [])
    expect(short.some((entry) => entry.text.includes('Detersivo'))).toBe(false)
    const long = suggestions(JAPAN, [])
    expect(long.some((entry) => entry.text.includes('Detersivo'))).toBe(true)
  })

  it('leaves out the length-based lines when the trip has no dates', () => {
    const offered = suggestions({ ...JAPAN, startDate: null, endDate: null }, [])
    expect(offered.some((entry) => entry.text.startsWith('Magliette'))).toBe(false)
  })

  it('mentions cash in the local currency, but not for euros', () => {
    expect(suggestions(JAPAN, []).map((entry) => entry.text)).toContain('Contanti in JPY')
    const home = suggestions({ ...JAPAN, currency: 'EUR' }, [])
    expect(home.some((entry) => entry.text.startsWith('Contanti'))).toBe(false)
  })

  it('offers nothing once everything has been added', () => {
    const all = suggestions(JAPAN, [])
    const asItems = all.map((entry, index) =>
      item({ id: String(index), text: entry.text, category: entry.category }),
    )
    expect(suggestions(JAPAN, asItems)).toEqual([])
  })
})
