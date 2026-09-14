/**
 * Turning suggestions into a trip that can be planned.
 *
 * `gapsIn` says which cities came out empty and how much each needs; this
 * takes what the server found around them and makes places out of it —
 * proposed places, with ids chosen here, that exist only in a copy of the
 * bundle until you press apply.
 *
 * Nothing here writes. The planner is then run again over the copy, so
 * what you are shown is a real plan of real places rather than a promise
 * that something could be arranged.
 */

import type { Place, PlaceCategory, Suggestion, TripBundle } from '../api/types'

import type { Gap } from './autoPlan'
import { defaultExposure } from './exposure'
import { byTaste, onlyNew } from './suggest'

/** A place this app proposed, not one you collected. */
export interface Proposed {
  place: Place
  stopName: string
  /** How much has been written about it, which is our only clue to famous. */
  fame: number
  /** One line saying what it is, and a photograph, both from Wikidata. */
  description: string | null
  image: string | null
}

/**
 * How long to allow for somewhere nobody has said how long to allow for.
 *
 * The form's own default, so a proposed place and a typed one are planned
 * on the same terms. Measured against that default, a day holds nine —
 * which is why `gapsIn` asks for four and not nine.
 */
const VISIT_MINUTES = 60

export function asPlace(
  tripId: string,
  stopId: string,
  suggestion: Suggestion,
  id: string,
): Place {
  const now = new Date().toISOString()
  return {
    id,
    trip_id: tripId,
    // Said outright, not inferred: this is the app's guess at which city
    // it belongs to, and it was the app that went looking there.
    stop_id: stopId,
    name: suggestion.name,
    category: suggestion.category as PlaceCategory,
    priority: 'normal',
    weather_exposure: defaultExposure(suggestion.category as PlaceCategory),
    lat: suggestion.lat,
    lon: suggestion.lon,
    address: null,
    url: suggestion.wikidata ? `https://www.wikidata.org/wiki/${suggestion.wikidata}` : null,
    // Kept, not just shown while choosing. Both were thrown away the
    // moment a proposal was accepted, so the itinerary you ended up with
    // was a list of names again.
    description: suggestion.description ?? null,
    image_url: suggestion.image ?? null,
    notes: null,
    visit_minutes: VISIT_MINUTES,
    planned_start_at: null,
    planned_tz: null,
    opening_hours: {},
    created_at: now,
    updated_at: now,
  } as Place
}

/**
 * The places to propose for one city.
 *
 * `onlyNew` first, so somewhere already on your list is never offered
 * back to you as a discovery; then your taste, then fame, which is the
 * order `byTaste` leaves them in.
 */
export function proposeFor(
  tripId: string,
  gap: Gap,
  found: readonly Suggestion[],
  existing: readonly Place[],
  wanted: ReadonlySet<PlaceCategory>,
  newId: () => string,
): Proposed[] {
  return byTaste(onlyNew(found, existing), wanted)
    .slice(0, gap.wanted)
    .map((suggestion) => ({
      place: asPlace(tripId, gap.stopId, suggestion, newId()),
      stopName: gap.stopName,
      fame: suggestion.fame,
      description: suggestion.description ?? null,
      image: suggestion.image ?? null,
    }))
}

/** The same trip, with the proposals in it, for the planner to look at again. */
export function bundleWith(bundle: TripBundle, proposed: readonly Proposed[]): TripBundle {
  return { ...bundle, places: [...bundle.places, ...proposed.map((item) => item.place)] }
}
