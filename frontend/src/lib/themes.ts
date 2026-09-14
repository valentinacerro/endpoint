/**
 * What kind of day this is meant to be.
 *
 * "Magari mi va di farmi la strada dei negozi, o comunque una giornata
 * shopping, o una giornata musei." Without this the planner has exactly
 * one idea of a good day — the nearest well-known things, whatever they
 * are — so a fortnight comes out as fourteen days of the same shape, and
 * the day you wanted to spend in shops has a shrine in the middle of it.
 *
 * A theme sorts; it never filters. The categories below go to the front
 * of the queue and the rest stay in it, because a shopping day in a city
 * with four shops should still be a day rather than four shops and seven
 * empty hours.
 */

import type { DayTheme, PlaceCategory } from '../api/types'

export const DAY_THEMES: readonly DayTheme[] = [
  'sights',
  'museums',
  'shopping',
  'food',
  'outdoors',
]

/**
 * Which kinds of place each sort of day is made of.
 *
 * The same table as the server's, and the server's is the one the planner
 * would use if this ever moved. Temples and shrines count as outdoors
 * because visiting one means walking its grounds, which is the same
 * reason the rain re-balancer treats them as outdoor.
 */
export const THEME_CATEGORIES: Record<DayTheme, readonly PlaceCategory[]> = {
  sights: ['sight', 'viewpoint', 'experience'],
  museums: ['museum'],
  shopping: ['shopping'],
  food: ['food'],
  outdoors: ['park', 'garden', 'viewpoint', 'temple', 'shrine'],
}
