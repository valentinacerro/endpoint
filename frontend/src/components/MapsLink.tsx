import { t } from '../i18n'
import { canOpenInMaps, mapsDirectionsUrl, mapsSearchUrl, type Locatable } from '../lib/maps'

/**
 * Buttons that hand over to Google Maps.
 *
 * `rel="noreferrer"` and `target="_blank"`: on Android this opens the Maps
 * app itself with the destination already set, and coming back leaves the
 * itinerary exactly where it was.
 */
export function MapsLink({ place }: { place: Locatable }) {
  if (!canOpenInMaps(place)) return null

  const search = mapsSearchUrl(place)
  const directions = mapsDirectionsUrl(place)

  return (
    <div className="row">
      {search && (
        <a className="button button--small button--quiet" href={search} target="_blank" rel="noreferrer">
          🗺 {t('maps.open')}
        </a>
      )}
      {directions && (
        <a
          className="button button--small button--quiet"
          href={directions}
          target="_blank"
          rel="noreferrer"
        >
          ➜ {t('maps.directions')}
        </a>
      )}
    </div>
  )
}
