/**
 * Deciding whether a suggested place is one you already have.
 *
 * Its own module because it is the part that can be wrong quietly. Offer
 * Senso-ji to someone who added it from a Maps link this morning and the
 * suggestions look careless; match too eagerly and a shrine inside a
 * temple's grounds disappears from the list because the temple is eighty
 * metres away.
 */

import type { Place, PlaceCategory, Suggestion } from '../api/types'
import { haversineKm } from './geo'

/**
 * How close two things have to be to be the same thing.
 *
 * A hundred and twenty metres. OpenStreetMap and Google rarely put the
 * same building more than fifty apart, and the nearest genuinely separate
 * attraction is almost always further — Senso-ji's main hall and Asakusa
 * Shrine, which are about as close as two distinct sights ever get, are
 * roughly a hundred and sixty apart.
 */
export const SAME_PLACE_KM = 0.12

export function isTheSamePlace(place: Place, suggestion: Suggestion): boolean {
  // A place saved from a link that carried no position has only its name
  // to be recognised by. Comparing names is weak — two "Inari Shrine"
  // entries are usually two different shrines — so it is the fallback
  // rather than the rule.
  if (place.lat === null || place.lon === null) {
    return place.name.trim().toLowerCase() === suggestion.name.trim().toLowerCase()
  }
  return haversineKm({ lat: place.lat, lon: place.lon }, suggestion) < SAME_PLACE_KM
}

/** The suggestions that are not already on the list. */
export function onlyNew(
  suggestions: readonly Suggestion[],
  places: readonly Place[],
): Suggestion[] {
  return suggestions.filter(
    (suggestion) => !places.some((place) => isTheSamePlace(place, suggestion)),
  )
}


/**
 * The suggestions, ordered by what you said you care about.
 *
 * The ranking underneath is how much has been written about a place,
 * which measures fame and not taste: it puts the Skytree and the National
 * Museum on top, which are right and are also what any guidebook would
 * have told you. It has no way of knowing you would rather eat than look
 * at things.
 *
 * So: a partition, not a weighting. The kinds you ticked come first, in
 * their own order of fame, and everything else follows in its own. A
 * weighted score would need numbers nobody can defend — is a famous
 * temple worth more than an obscure market to someone who ticked
 * "food"? — and would leave you unable to predict what the button does.
 * This way the rule is one sentence long and you can see it worked.
 *
 * Ticking nothing means caring about everything, and that falls out of
 * the partition rather than being handled: nothing matches an empty set,
 * so the first half is empty and the order is untouched. There was an
 * early return for it until sabotaging it changed no answer.
 */
export function byTaste(
  suggestions: readonly Suggestion[],
  wanted: ReadonlySet<PlaceCategory>,
): Suggestion[] {
  const mine = suggestions.filter((item) => wanted.has(item.category))
  const rest = suggestions.filter((item) => !wanted.has(item.category))
  return [...mine, ...rest]
}

/** The kinds actually present, so the picker offers nothing empty. */
export function categoriesIn(suggestions: readonly Suggestion[]): PlaceCategory[] {
  const seen = new Set<PlaceCategory>()
  for (const item of suggestions) seen.add(item.category)
  return [...seen]
}
