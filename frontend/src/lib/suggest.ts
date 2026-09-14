/**
 * Deciding whether a suggested place is one you already have.
 *
 * Its own module because it is the part that can be wrong quietly. Offer
 * Senso-ji to someone who added it from a Maps link this morning and the
 * suggestions look careless; match too eagerly and a shrine inside a
 * temple's grounds disappears from the list because the temple is eighty
 * metres away.
 */

import type { Place, Suggestion } from '../api/types'
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
