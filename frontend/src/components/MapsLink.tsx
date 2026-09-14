import { t } from '../i18n'
import { Icon } from './Icon'
import { canOpenInMaps, mapsDirectionsUrl, mapsSearchUrl, type Locatable } from '../lib/maps'

/**
 * Buttons that hand over to Google Maps.
 *
 * `rel="noreferrer"` and `target="_blank"`: on Android this opens the Maps
 * app itself with the destination already set, and coming back leaves the
 * itinerary exactly where it was.
 */
export function MapsLink({ place, compact = false }: { place: Locatable; compact?: boolean }) {
  if (!canOpenInMaps(place)) return null

  const search = mapsSearchUrl(place)
  const directions = mapsDirectionsUrl(place)

  // `compact` is for a list you are scanning: two labelled buttons per
  // row turn twenty places into a wall, and the icons say the same thing.
  // The words stay on a detail screen, where there is one of each.
  if (compact) {
    return (
      <>
        {search && (
          <a
            className="chip"
            href={search}
            target="_blank"
            rel="noreferrer"
            aria-label={t('maps.open')}
            title={t('maps.open')}
          >
            <Icon name="map" size={15} />
          </a>
        )}
        {directions && (
          <a
            className="chip"
            href={directions}
            target="_blank"
            rel="noreferrer"
            aria-label={t('maps.directions')}
            title={t('maps.directions')}
          >
            <Icon name="directions" size={15} />
          </a>
        )}
      </>
    )
  }

  return (
    <div className="row">
      {search && (
        <a className="button button--small button--quiet" href={search} target="_blank" rel="noreferrer">
          <Icon name="map" size={15} />
          {t('maps.open')}
        </a>
      )}
      {directions && (
        <a
          className="button button--small button--quiet"
          href={directions}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="directions" size={15} />
          {t('maps.directions')}
        </a>
      )}
    </div>
  )
}
