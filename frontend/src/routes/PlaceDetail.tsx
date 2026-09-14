import { useNavigate, useParams } from 'react-router'

import { useDeletePlace, useTripBundle, useUpdatePlace } from '../api/trips'
import { PLACE_CATEGORIES, type PlaceCategory, type Priority } from '../api/types'
import { AppBar } from '../components/AppBar'
import { MapsLink } from '../components/MapsLink'
import { t } from '../i18n'
import { exposureLabel, placeCategoryLabel, priorityLabel } from '../i18n/labels'
import { dayKeyInZone, formatDayKey, formatDuration, formatTimeInZone } from '../lib/datetime'

const PRIORITIES: readonly Priority[] = ['must_see', 'high', 'normal', 'low']

/**
 * One place, and everything you might want to do with it.
 *
 * "Quando clicco sulla tab trip non è cliccabile." A booking on the
 * itinerary was a link to its own screen; a visit was a `div` with two
 * arrows on it. So the thing you look at fourteen times a day — the
 * places you are actually going to — was the one thing with nowhere to
 * go, no photograph, and no way to find out what it was.
 *
 * Everything here is one tap from the itinerary and from the list of
 * places, which are the two screens you arrive from.
 */
export function PlaceDetail() {
  const { tripId, placeId } = useParams<{ tripId: string; placeId: string }>()
  const bundle = useTripBundle(tripId)
  const update = useUpdatePlace(tripId ?? '')
  const remove = useDeletePlace(tripId ?? '')
  const navigate = useNavigate()

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const place = bundle.data.places.find((item) => item.id === placeId)
  if (!place) return <main className="page">{t('common.error')}</main>

  const stop = bundle.data.stops.find((item) => item.id === place.stop_id)

  return (
    <>
      <AppBar title={place.name} subtitle={stop?.name} back={`/trips/${tripId}`} />
      <main className="page stack">
        {place.image_url && (
          // The one picture we have, given the room a picture needs. The
          // list shows it at 48 pixels, which is enough to recognise and
          // not enough to look at.
          <img className="place__photo" src={place.image_url} alt="" loading="lazy" />
        )}

        {place.description && <p className="place__what">{place.description}</p>}

        <p className="muted small">
          {[
            placeCategoryLabel(place.category),
            t('timeline.visit', { duration: formatDuration(place.visit_minutes) }),
            exposureLabel(place.weather_exposure),
          ].join(' · ')}
        </p>

        {place.planned_start_at && place.planned_tz ? (
          <p className="hint">
            {t('place.plannedFor', {
              day: formatDayKey(dayKeyInZone(place.planned_start_at, place.planned_tz)),
              time: formatTimeInZone(place.planned_start_at, place.planned_tz),
            })}
          </p>
        ) : (
          <p className="muted small">{t('place.notPlanned')}</p>
        )}

        <MapsLink place={place} />

        <div className="row">
          <label className="field field--grow">
            <span className="field__label">{t('places.category')}</span>
            <select
              className="field__input"
              value={place.category}
              onChange={(event) =>
                update.mutate({ id: place.id, category: event.target.value as PlaceCategory })
              }
            >
              {PLACE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {placeCategoryLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--grow">
            <span className="field__label">{t('places.priority')}</span>
            <select
              className="field__input"
              value={place.priority}
              onChange={(event) =>
                update.mutate({ id: place.id, priority: event.target.value as Priority })
              }
            >
              {PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {priorityLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">{t('places.visitMinutes')}</span>
            <input
              className="field__input"
              type="number"
              min={5}
              max={1440}
              step={5}
              style={{ width: '9ch' }}
              defaultValue={place.visit_minutes}
              onBlur={(event) => {
                const minutes = Number(event.target.value)
                if (minutes > 0 && minutes !== place.visit_minutes) {
                  update.mutate({ id: place.id, visit_minutes: minutes })
                }
              }}
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">{t('places.stop')}</span>
          <select
            className="field__input"
            value={place.stop_id ?? ''}
            onChange={(event) =>
              update.mutate({ id: place.id, stop_id: event.target.value || null })
            }
          >
            <option value="">{t('places.noStop')}</option>
            {bundle.data.stops.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <div className="row row--end">
          {place.planned_start_at && (
            <button
              className="button button--quiet"
              onClick={() =>
                update.mutate({ id: place.id, planned_start_at: null, planned_tz: null })
              }
              disabled={update.isPending}
            >
              {t('timeline.unschedule')}
            </button>
          )}
          <button
            className="button button--danger"
            onClick={() => {
              if (!confirm(t('common.confirmDelete', { name: place.name }))) return
              remove.mutate(place.id, { onSuccess: () => navigate(`/trips/${tripId}/places`) })
            }}
            disabled={remove.isPending}
          >
            {t('common.delete')}
          </button>
        </div>
      </main>
    </>
  )
}
