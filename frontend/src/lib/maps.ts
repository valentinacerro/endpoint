/**
 * Links that open Google Maps.
 *
 * Google's universal URL scheme needs no key, no SDK and no account, and on
 * Android it hands straight over to the Maps app with the destination
 * already filled in. That is the whole integration for this half.
 *
 * Every builder returns null when there is nothing to point at, so a button
 * can simply not be rendered rather than opening an empty map.
 */

export interface Locatable {
  lat?: number | null
  lon?: number | null
  address?: string | null
  name?: string | null
}

/** Coordinates when we have them, otherwise whatever text we can offer. */
function target(place: Locatable): string | null {
  if (typeof place.lat === 'number' && typeof place.lon === 'number') {
    // A coordinate pair drops a pin exactly where it should be; a name is
    // a search and can land on the wrong branch of a chain.
    return `${place.lat},${place.lon}`
  }
  const text = place.address?.trim() || place.name?.trim()
  return text || null
}

export function mapsSearchUrl(place: Locatable): string | null {
  const query = target(place)
  if (!query) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function mapsDirectionsUrl(place: Locatable): string | null {
  const destination = target(place)
  if (!destination) return null
  // No origin: Maps uses where you are, which on the road is the only
  // sensible starting point.
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

/** Does this have enough to be worth a map button at all? */
export function canOpenInMaps(place: Locatable): boolean {
  return target(place) !== null
}
