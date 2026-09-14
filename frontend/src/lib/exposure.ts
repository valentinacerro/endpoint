/**
 * What the server would call a place's weather exposure.
 *
 * A copy of the backend's `DEFAULT_EXPOSURE`, and the only copy: a place
 * added with no network has to show its own row correctly before any
 * server has seen it, and the rain re-balancer reads this field. Without
 * it a temple added underground would read "misto" in the list and be
 * treated as half-indoors by the weather screen, then silently change its
 * mind hours later when the queue drained.
 *
 * The two tables are held together by a test that reads the Python one, so
 * a category added on one side cannot quietly disagree on the other.
 */

import type { PlaceCategory, WeatherExposure } from '../api/types'

const DEFAULT_EXPOSURE: Partial<Record<PlaceCategory, WeatherExposure>> = {
  museum: 'indoor',
  shopping: 'indoor',
  park: 'outdoor',
  garden: 'outdoor',
  viewpoint: 'outdoor',
  // Visiting a Japanese temple or shrine means walking the grounds, so rain
  // spoils it much the same way it spoils a park.
  temple: 'outdoor',
  shrine: 'outdoor',
}

export function defaultExposure(category: PlaceCategory): WeatherExposure {
  return DEFAULT_EXPOSURE[category] ?? 'mixed'
}
