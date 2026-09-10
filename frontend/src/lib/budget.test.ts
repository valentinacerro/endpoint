import { describe, expect, it } from 'vitest'

import type { Expense, Trip } from '../api/types'
import { byDay, formatMoney, summarise } from './budget'

const trip = (over: Partial<Trip> = {}): Trip =>
  ({ primary_currency: 'EUR', budget_amount: null, ...over }) as Trip

const expense = (over: Partial<Expense>): Expense =>
  ({
    id: crypto.randomUUID(),
    amount: '10.00',
    currency: 'EUR',
    rate: null,
    spent_at: '2026-04-13',
    ...over,
  }) as Expense

describe('adding up a trip', () => {
  it('keeps currencies apart', () => {
    const summary = summarise(
      [
        expense({ amount: '980.00', currency: 'JPY' }),
        expense({ amount: '1200.00', currency: 'JPY' }),
        expense({ amount: '15.50', currency: 'EUR' }),
      ],
      trip(),
    )
    expect(summary.byCurrency).toEqual([
      { currency: 'JPY', total: 2180 },
      { currency: 'EUR', total: 15.5 },
    ])
  })

  it('does not drift when adding many small amounts', () => {
    // The classic: 0.1 + 0.2 is not 0.3 in binary floating point, and a
    // hundred coffees added that way stop matching the statement.
    const coffees = Array.from({ length: 100 }, () => expense({ amount: '0.10' }))
    expect(summarise(coffees, trip()).converted).toBe(10)
  })

  it('converts what it can and counts what it cannot', () => {
    const summary = summarise(
      [
        expense({ amount: '10.00', currency: 'EUR' }),
        expense({ amount: '1000.00', currency: 'JPY', rate: '0.0061' }),
        expense({ amount: '500.00', currency: 'JPY' }),
      ],
      trip(),
    )
    expect(summary.converted).toBe(16.1)
    // Said out loud rather than silently dropped: a total missing a third
    // of the spending is worse than one that admits it.
    expect(summary.unconverted).toBe(1)
  })

  it('leaves the remaining budget alone when there is no budget', () => {
    expect(summarise([expense({})], trip()).remaining).toBeNull()
  })

  it('works out what is left', () => {
    const summary = summarise([expense({ amount: '250.00' })], trip({ budget_amount: '1000.00' }))
    expect(summary.remaining).toBe(750)
  })

  it('goes negative rather than clamping when overspent', () => {
    const summary = summarise([expense({ amount: '1200.00' })], trip({ budget_amount: '1000.00' }))
    expect(summary.remaining).toBe(-200)
  })

  it('copes with no expenses at all', () => {
    const summary = summarise([], trip({ budget_amount: '1000.00' }))
    expect(summary.converted).toBe(0)
    expect(summary.remaining).toBe(1000)
    expect(summary.byCurrency).toEqual([])
  })
})

describe('grouping by day', () => {
  it('puts the most recent day first', () => {
    const groups = byDay([
      expense({ spent_at: '2026-04-11' }),
      expense({ spent_at: '2026-04-13' }),
      expense({ spent_at: '2026-04-13' }),
    ])
    expect(groups.map((group) => [group.day, group.items.length])).toEqual([
      ['2026-04-13', 2],
      ['2026-04-11', 1],
    ])
  })
})

describe('showing an amount', () => {
  it('uses the right number of decimals for the currency', () => {
    // Yen has no minor unit; ¥980.00 is not a thing anyone writes.
    expect(formatMoney(980, 'JPY')).not.toContain('980,00')
    expect(formatMoney(15.5, 'EUR')).toContain('15,50')
  })

  it('does not blank the screen on a currency it does not know', () => {
    expect(formatMoney(10, 'XXXX')).toBe('10.00 XXXX')
  })
})
