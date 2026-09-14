import { useState } from 'react'
import { useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import type { BookingKind, Place } from '../api/types'
import { TripMap, type MapPin } from '../components/TripMap'
import { AppBar } from '../components/AppBar'
import { Nothing, NothingLink } from '../components/Nothing'
import { count, t } from '../i18n'
import { formatDayKey } from '../lib/datetime'
import { buildTimeline, type Day, type PlacedEntry } from '../lib/itinerary'

/** The filter chip for places that have not been given a day. */
const WAITING = 'waiting'

const TRAVEL: ReadonlySet<BookingKind> = new Set([
  'flight',
  'train',
  'bus',
  'ferry',
  'car_rental',
])

function pinKind(placed: PlacedEntry): MapPin['kind'] {
  const { entry } = placed
  if (entry.type === 'place') {
    return entry.place.category === 'food' ? 'food' : 'see'
  }
  if (TRAVEL.has(entry.booking.kind)) return 'travel'
  if (entry.booking.kind === 'hotel') return 'stay'
  if (entry.booking.kind === 'restaurant') return 'food'
  if (entry.booking.kind === 'activity') return 'see'
  return 'other'
}

function coordsOf(placed: PlacedEntry): { lat: number; lon: number; label: string } | null {
  const source =
    placed.entry.type === 'place'
      ? { lat: placed.entry.place.lat, lon: placed.entry.place.lon, label: placed.entry.place.name }
      : {
          lat: placed.entry.booking.lat,
          lon: placed.entry.booking.lon,
          label: placed.entry.booking.title,
        }
  if (typeof source.lat !== 'number' || typeof source.lon !== 'number') return null
  return { lat: source.lat, lon: source.lon, label: source.label }
}

/**
 * Pins for what is planned, and for what is not.
 *
 * `waiting` used to be missing entirely, and that was the whole of "the
 * map does not work": a trip you have just collected twenty places for
 * has nothing on any day yet, so the map drew none of them and said
 * there was nothing to show. The places you are deciding between are
 * exactly the ones worth seeing on a map.
 */
export function pinsFor(
  days: Day[],
  waiting: readonly Place[] = [],
): { pins: MapPin[]; missing: number } {
  const pins: MapPin[] = []
  let missing = 0

  for (const day of days) {
    day.entries.forEach((placed) => {
      const found = coordsOf(placed)
      if (!found) {
        missing += 1
        return
      }
      pins.push({
        id: placed.entry.id,
        // Numbered across the selection, so a whole-trip view still reads
        // as a sequence rather than a scatter of identical dots.
        order: pins.length + 1,
        lat: found.lat,
        lon: found.lon,
        label: found.label,
        kind: pinKind(placed),
      })
    })
  }

  for (const place of waiting) {
    if (typeof place.lat !== 'number' || typeof place.lon !== 'number') {
      missing += 1
      continue
    }
    pins.push({
      id: place.id,
      order: null,
      lat: place.lat,
      lon: place.lon,
      label: place.name,
      kind: place.category === 'food' ? 'food' : 'see',
    })
  }

  return { pins, missing }
}

export function MapView() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const [selected, setSelected] = useState<string | null>(null)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const timeline = buildTimeline(bundle.data)
  // Only days with something on them: chips for empty days would be noise.
  const days = timeline.days.filter((day) => day.entries.length > 0)
  const waiting = timeline.unscheduledPlaces
  const showWaiting = selected === null || selected === WAITING
  const shown = selected && selected !== WAITING ? days.filter((day) => day.key === selected) : days
  // Two different empties: nothing collected at all, or things collected
  // that have no position. They need different advice.
  const anyPlaces = bundle.data.places.length > 0
  const { pins, missing } = pinsFor(
    selected === WAITING ? [] : shown,
    showWaiting ? waiting : [],
  )

  return (
    <>
      <AppBar
        title={t('map.title')}
        subtitle={bundle.data.trip.title}
        back={`/trips/${tripId}`}
      />
      <main className="page stack">

      {(days.length > 1 || (days.length > 0 && waiting.length > 0)) && (
        <nav className="toolbar">
          <button
            className={`toolbar__link ${selected === null ? 'toolbar__link--on' : ''}`}
            onClick={() => setSelected(null)}
          >
            {t('map.allDays')}
          </button>
          {days.map((day) => (
            <button
              key={day.key}
              className={`toolbar__link ${selected === day.key ? 'toolbar__link--on' : ''}`}
              onClick={() => setSelected(day.key)}
            >
              {formatDayKey(day.key)}
            </button>
          ))}
          {waiting.length > 0 && (
            <button
              className={`toolbar__link ${selected === WAITING ? 'toolbar__link--on' : ''}`}
              onClick={() => setSelected(WAITING)}
            >
              {t('map.waiting')}
            </button>
          )}
        </nav>
      )}

      <TripMap
        pins={pins}
        empty={
          <Nothing
            title={t('map.nothingToShow')}
            hint={anyPlaces ? t('map.noPositions') : t('map.noPlaces')}
            action={
              <NothingLink
                to={`/trips/${tripId}/places`}
                label={anyPlaces ? t('map.goFindPositions') : t('map.goAddPlaces')}
              />
            }
          />
        }
      />

      {/* Said plainly rather than left as grey squares: everything else in
          this app works offline, and this one screen does not. */}
      <p className="muted small">{t('map.needsNetwork')}</p>

      {missing > 0 && <p className="hint">{count('map.missingCoords', missing)}</p>}
      </main>
    </>
  )
}
