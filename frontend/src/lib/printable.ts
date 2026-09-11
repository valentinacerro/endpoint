/**
 * What a booking looks like on paper.
 *
 * The offline design covers a dead network. It does not cover a dead
 * phone, and that is the one failure it cannot cover — so the answer is a
 * sheet of paper, which needs no battery and no signal at all.
 *
 * Paper cannot be tapped, so anything hidden behind a tap has to be
 * printed outright: the confirmation code above all, then whatever you
 * would need to reach the place or the desk.
 */

import type { Booking, Stop } from '../api/types'
import type { TranslationKey } from '../i18n'

export interface Detail {
  /** Resolved by the caller: this file decides what is printed, not how
      it is worded. */
  label: TranslationKey
  value: string
}

/**
 * The fields worth ink, in the order you would need them.
 *
 * Code first: it is the single thing you cannot reconstruct from memory
 * standing at a reception desk. Then who to ask for it from, then how to
 * get there, then how to call.
 */
export function printableDetails(booking: Booking): Detail[] {
  const fields: [TranslationKey, string | null | undefined][] = [
    ['print.code', booking.confirmation_code],
    ['print.provider', booking.provider],
    ['print.route', route(booking)],
    ['print.address', booking.address],
    ['print.phone', booking.phone],
    ['print.notes', booking.notes],
  ]

  return fields
    .filter((entry): entry is [TranslationKey, string] => Boolean(entry[1]?.trim()))
    .map(([label, value]) => ({ label, value: value.trim() }))
}

/** "Roma → Tokyo", when both ends are known. */
function route(booking: Booking): string | null {
  const { origin_label: from, destination_label: to } = booking
  if (from && to) return `${from} → ${to}`
  return from ?? to ?? null
}

/**
 * The stops as one line, in order.
 *
 * A trip's shape at a glance, which is what you want at the top of a
 * printed sheet before any of the detail.
 */
export function stopsSummary(stops: readonly Stop[]): string {
  return [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => {
      const from = stop.arrive_date
      const to = stop.depart_date
      if (from && to && from !== to) return `${stop.name} ${short(from)}–${short(to)}`
      if (from) return `${stop.name} ${short(from)}`
      return stop.name
    })
    .join(' · ')
}

/** "12/4" out of "2026-04-12": a printed line has no room for the year. */
function short(day: string): string {
  const [, month, date] = day.split('-')
  return `${Number(date)}/${Number(month)}`
}
