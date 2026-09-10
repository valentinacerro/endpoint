/**
 * Adding up what a trip cost.
 *
 * Money is summed in minor units as integers, never as decimals. In
 * JavaScript `0.1 + 0.2` is not `0.3`, and a hundred coffees added that way
 * drift far enough to make a total look wrong to anyone checking it against
 * a statement. Amounts arrive from the API as strings for the same reason.
 */

import type { Expense, Trip } from '../api/types'

export interface CurrencyTotal {
  currency: string
  /** In major units, rounded to cents. */
  total: number
}

export interface BudgetSummary {
  /** What was spent, kept apart by the currency it was spent in. */
  byCurrency: CurrencyTotal[]
  /** Everything expressed in the trip's own currency, where that is possible. */
  converted: number
  /** Expenses in another currency with no rate yet, so absent from `converted`. */
  unconverted: number
  budget: number | null
  /** Budget minus converted spend; null when there is no budget to compare to. */
  remaining: number | null
}

/** "980.00" -> 98000 minor units. */
function toMinor(amount: string | number): number {
  return Math.round(Number(amount) * 100)
}

export function summarise(expenses: Expense[], trip: Trip): BudgetSummary {
  const home = trip.primary_currency
  const perCurrency = new Map<string, number>()
  let convertedMinor = 0
  let unconverted = 0

  for (const expense of expenses) {
    const minor = toMinor(expense.amount)
    perCurrency.set(expense.currency, (perCurrency.get(expense.currency) ?? 0) + minor)

    if (expense.currency === home) {
      convertedMinor += minor
    } else if (expense.rate) {
      convertedMinor += Math.round(minor * Number(expense.rate))
    } else {
      // Counted, not guessed. A total that quietly omits a third of the
      // spending is worse than one that says how much it is missing.
      unconverted += 1
    }
  }

  const budget = trip.budget_amount === null ? null : Number(trip.budget_amount)
  const converted = convertedMinor / 100

  return {
    byCurrency: [...perCurrency.entries()]
      .map(([currency, total]) => ({ currency, total: total / 100 }))
      .sort((a, b) => b.total - a.total),
    converted,
    unconverted,
    budget,
    remaining: budget === null ? null : Math.round((budget - converted) * 100) / 100,
  }
}

/** Group expenses by the day they happened, newest first. */
export function byDay(expenses: Expense[]): { day: string; items: Expense[] }[] {
  const groups = new Map<string, Expense[]>()
  for (const expense of expenses) {
    groups.set(expense.spent_at, [...(groups.get(expense.spent_at) ?? []), expense])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, items }))
}

export function formatMoney(amount: number, currency: string, locale = 'it'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // Yen has no minor unit, and Intl already knows that per currency —
      // hard-coding two decimals would print ¥980.00, which is not a thing.
      currencyDisplay: 'narrowSymbol',
    }).format(amount)
  } catch {
    // An unknown or malformed currency code should not blank the screen.
    return `${amount.toFixed(2)} ${currency}`
  }
}
