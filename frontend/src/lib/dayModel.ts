/**
 * Asking the model what a day of this kind should be made of.
 *
 * The theme already does the blunt half: a shopping day puts shops before
 * temples, because a shop is a shop. What it cannot know is that Ginza
 * and Omotesandō are a day and Ginza and a suburban mall are an errand —
 * that is read, not derived, and it is the one thing a language model has
 * genuinely got over a lookup table.
 *
 * It is never asked to produce places. It scores places it was handed, by
 * index, and every index it invents is dropped — so it cannot add
 * somewhere that does not exist, lose one, rename one or move a
 * coordinate. The worst it can do is rank badly, which you can see and
 * undo. Everything here runs on the phone: nothing about where you are
 * going is sent anywhere.
 *
 * The planner stays pure. What comes back is a map of scores, handed to
 * `planTrip` as a tiebreak, so the day is still worked out by the same
 * deterministic code whether or not a model ever ran.
 */

import type { Place } from '../api/types'
import { dayThemeLabel } from '../i18n/labels'
import type { DayTheme } from '../api/types'

import { applyScores, buildPrompt, parseScores, MAX_CANDIDATES, type Rankable } from './taste'

export { MAX_CANDIDATES }

/**
 * What to tell the model it is choosing for.
 *
 * Written as a sentence about a day rather than as the theme's own name:
 * "shopping" is a label in our schema, and the model reads English about
 * travelling far better than it reads our vocabulary.
 */
export function describeDay(theme: DayTheme, city: string | null): string {
  const what: Record<DayTheme, string> = {
    sights: 'seeing the things this place is known for',
    museums: 'museums and galleries',
    shopping: 'shopping — shops, markets and the streets they are on',
    food: 'eating and drinking',
    outdoors: 'being outside — parks, gardens, views and temple grounds',
  }
  const where = city ? ` in ${city}` : ''
  return [
    `One day${where} spent ${what[theme]}.`,
    'Rate each place by how well it belongs in that day together with the',
    'others — somewhere that only makes sense on its own is worth less',
    'than somewhere that fits the rest of the day.',
  ].join(' ')
}

export function promptFor(places: readonly Place[], theme: DayTheme, city: string | null): string {
  return buildPrompt(places as readonly Rankable[], describeDay(theme, city))
}

/**
 * The model's answer, as a score per place id.
 *
 * A map rather than an order, because the planner has its own opinion
 * about the order — travel time, opening hours, what else is that day —
 * and this is one voice in it rather than the last word.
 */
export function scoresById(
  places: readonly Place[],
  reply: string,
): Map<string, number> {
  const byIndex = parseScores(reply)
  const ranked = applyScores(places, byIndex)
  const scores = new Map<string, number>()
  for (const { suggestion, score } of ranked) {
    if (score !== null) scores.set(suggestion.id, score)
  }
  return scores
}

/** The theme's own label, for saying on screen what was asked. */
export function askedFor(theme: DayTheme): string {
  return dayThemeLabel(theme)
}
