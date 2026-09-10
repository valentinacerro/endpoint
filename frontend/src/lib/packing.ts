/**
 * The packing list: grouping, progress, and the starter list.
 *
 * Ticking things off is the one thing you genuinely do without signal — in
 * a bedroom the night before, in a hotel room repacking — so every write on
 * this screen goes through the offline queue. That is a decision made in
 * `api/trips.ts`; here there is only arithmetic and text.
 */

import { CHECKLIST_CATEGORIES, type ChecklistCategory, type ChecklistItem } from '../api/types'
import { t, type TranslationKey } from '../i18n'
import { fold } from './text'

export interface Group {
  category: ChecklistCategory
  items: ChecklistItem[]
  done: number
}

export interface Progress {
  done: number
  total: number
  /** 0..1, and 0 rather than NaN when the list is empty. */
  fraction: number
}

export function progress(items: readonly ChecklistItem[]): Progress {
  const done = items.filter((item) => item.is_done).length
  return {
    done,
    total: items.length,
    fraction: items.length === 0 ? 0 : done / items.length,
  }
}

/**
 * Split into category sections, in the order you pack.
 *
 * Empty categories are dropped: a heading with nothing under it is noise on
 * a phone, and the add form offers every category regardless.
 */
export function group(items: readonly ChecklistItem[]): Group[] {
  const groups: Group[] = []

  for (const category of CHECKLIST_CATEGORIES) {
    const mine = items
      .filter((item) => item.category === category)
      .sort(byPositionThenAge)
    if (mine.length > 0) {
      groups.push({
        category,
        items: mine,
        done: mine.filter((item) => item.is_done).length,
      })
    }
  }

  return groups
}

function byPositionThenAge(a: ChecklistItem, b: ChecklistItem): number {
  if (a.position !== b.position) return a.position - b.position
  return a.created_at.localeCompare(b.created_at)
}

/** Where a newly added line goes: after everything already in the list. */
export function nextPosition(items: readonly ChecklistItem[]): number {
  return items.reduce((highest, item) => Math.max(highest, item.position + 1), 0)
}

/**
 * Two lines count as the same thing if they read the same.
 *
 * Used only to avoid offering a suggestion that is already on the list.
 * Accents are folded because "carta d'identità" typed in a hurry may not
 * match the suggestion character for character.
 */
export const normalise = fold

export interface Suggestion {
  text: string
  category: ChecklistCategory
}

interface TripFacts {
  startDate: string | null
  endDate: string | null
  currency: string
  countryCodes: readonly string[]
}

/**
 * Plug types by country, for the ones this app is likely to see.
 *
 * Deliberately short. A country that is not here produces the generic
 * "universal adapter" line, which is the correct answer when we do not
 * know — better than a confident wrong voltage.
 */
const PLUGS: Record<string, string> = {
  JP: 'A/B, 100V',
  US: 'A/B, 120V',
  CA: 'A/B, 120V',
  GB: 'G, 230V',
  IE: 'G, 230V',
  IT: 'C/F/L, 230V',
  FR: 'C/E, 230V',
  ES: 'C/F, 230V',
  DE: 'C/F, 230V',
  CH: 'C/J, 230V',
  AU: 'I, 230V',
  NZ: 'I, 230V',
  CN: 'A/C/I, 220V',
  KR: 'C/F, 220V',
  TH: 'A/B/C, 230V',
}

/**
 * Base list, the same for any trip.
 *
 * Translation keys rather than text: the wording belongs in the locale
 * file like every other string, and the line that ends up in the database
 * is whatever it read at the moment you accepted it — from then on it is
 * yours, and changing the locale will not rewrite it.
 */
const BASE: readonly { key: TranslationKey; category: ChecklistCategory }[] = [
  { key: 'packing.base.passport', category: 'documents' },
  { key: 'packing.base.idCard', category: 'documents' },
  { key: 'packing.base.flightTickets', category: 'documents' },
  { key: 'packing.base.hotelConfirmations', category: 'documents' },
  { key: 'packing.base.insurance', category: 'documents' },
  { key: 'packing.base.cards', category: 'documents' },

  { key: 'packing.base.underwear', category: 'clothes' },
  { key: 'packing.base.socks', category: 'clothes' },
  { key: 'packing.base.walkingShoes', category: 'clothes' },
  { key: 'packing.base.lightJacket', category: 'clothes' },
  { key: 'packing.base.pyjamas', category: 'clothes' },

  { key: 'packing.base.phoneCharger', category: 'electronics' },
  { key: 'packing.base.powerBank', category: 'electronics' },
  { key: 'packing.base.headphones', category: 'electronics' },

  { key: 'packing.base.toothbrush', category: 'toiletries' },
  { key: 'packing.base.deodorant', category: 'toiletries' },
  { key: 'packing.base.sunscreen', category: 'toiletries' },

  { key: 'packing.base.medicines', category: 'health' },
  { key: 'packing.base.plasters', category: 'health' },
  { key: 'packing.base.painkiller', category: 'health' },

  { key: 'packing.base.umbrella', category: 'other' },
  { key: 'packing.base.waterBottle', category: 'other' },
]

/**
 * The list to offer someone starting from nothing.
 *
 * Everything beyond the base list is derived from something the trip
 * actually records — its length, where it goes, what it spends — rather
 * than guessed. If a trip has no dates and no stops yet, the extra lines
 * simply do not appear.
 */
export function suggestions(facts: TripFacts, existing: readonly ChecklistItem[]): Suggestion[] {
  const all: Suggestion[] = [
    ...BASE.map((entry) => ({ text: t(entry.key), category: entry.category })),
    ...derived(facts),
  ]
  const taken = new Set(existing.map((item) => normalise(item.text)))
  return all.filter((suggestion) => !taken.has(normalise(suggestion.text)))
}

function derived(facts: TripFacts): Suggestion[] {
  const extra: Suggestion[] = []
  const nights = tripNights(facts.startDate, facts.endDate)

  if (nights !== null) {
    // Enough to reach a laundry, not one outfit per day for three weeks.
    const changes = Math.min(nights + 1, 7)
    extra.push({ text: t('packing.suggest.tops', { count: changes }), category: 'clothes' })
    if (nights >= 7) {
      extra.push({ text: t('packing.suggest.laundry'), category: 'other' })
    }
  }

  const known = facts.countryCodes.map((code) => code.toUpperCase())
  const plugs = [...new Set(known.map((code) => PLUGS[code]).filter(Boolean))]
  if (plugs.length > 0) {
    extra.push({
      text: t('packing.suggest.adapter', { plugs: plugs.join(' / ') }),
      category: 'electronics',
    })
  } else if (known.length > 0) {
    extra.push({ text: t('packing.suggest.adapterUnknown'), category: 'electronics' })
  }

  if (facts.currency && facts.currency.toUpperCase() !== 'EUR') {
    extra.push({
      text: t('packing.suggest.cash', { currency: facts.currency.toUpperCase() }),
      category: 'other',
    })
  }

  return extra
}

/**
 * Nights between two dates, or null if either is missing.
 *
 * Plain date arithmetic on `YYYY-MM-DD`, via UTC so that a summer-time
 * boundary inside the trip cannot shave off a day.
 */
function tripNights(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  const nights = Math.round((end - start) / 86_400_000)
  return nights >= 0 ? nights : null
}
