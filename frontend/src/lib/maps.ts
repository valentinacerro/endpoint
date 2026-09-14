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

/** Exactly where it is. For being taken there. */
function point(place: Locatable): string | null {
  if (typeof place.lat === 'number' && typeof place.lon === 'number') {
    return `${place.lat},${place.lon}`
  }
  return null
}

/**
 * What to ask Maps to show you.
 *
 * Both of these used to be the coordinates, because a coordinate pair
 * drops a pin exactly where it should be and a name is a search that can
 * land on the wrong branch of a chain. True, and beside the point:
 * opening Maps and being shown "35.7148, 139.7967" tells you nothing —
 * no name, no photograph, no opening hours, nothing you went to Maps
 * for. Recognising the place is the whole reason for the button.
 *
 * The address goes in with the name where there is one, which is what
 * keeps "Ichiran" in Shibuya rather than in Hong Kong. `query` is
 * documented to take a place name, an address, or a coordinate pair, so
 * this is the supported form and not a trick.
 */
function searchText(place: Locatable): string | null {
  const name = place.name?.trim()
  const address = place.address?.trim()
  if (name) return address ? `${name}, ${address}` : name
  return address || point(place)
}

export function mapsSearchUrl(place: Locatable): string | null {
  const query = searchText(place)
  if (!query) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function mapsDirectionsUrl(place: Locatable): string | null {
  // Coordinates here, and deliberately not the name: this one ends with a
  // phone telling you to turn left, and it should be turning towards the
  // place you saved rather than towards whatever a search matched.
  const destination = point(place) ?? searchText(place)
  if (!destination) return null
  // No origin: Maps uses where you are, which on the road is the only
  // sensible starting point.
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

/** Does this have enough to be worth a map button at all? */
export function canOpenInMaps(place: Locatable): boolean {
  return searchText(place) !== null
}
