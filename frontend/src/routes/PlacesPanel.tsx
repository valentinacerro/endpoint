import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { useCreatePlace, useDeletePlace, useTripBundle, useUpdatePlace } from '../api/trips'
import { PLACE_CATEGORIES, type Place, type PlaceCategory, type Priority } from '../api/types'
import { AddPlaceFromLink } from '../components/AddPlaceFromLink'
import { PlaceSearch } from '../components/PlaceSearch'
import { inferStops, tripCentre } from '../lib/stops'
import { ImportPlaces } from '../components/ImportPlaces'
import { SuggestPlaces } from '../components/SuggestPlaces'
import { MapsLink } from '../components/MapsLink'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { t } from '../i18n'
import { exposureLabel, placeCategoryLabel, priorityLabel } from '../i18n/labels'
import { dayKeyInZone, formatDayKey, formatDuration, formatTimeInZone } from '../lib/datetime'

const PRIORITIES: readonly Priority[] = ['must_see', 'high', 'normal', 'low']

function AddPlace({
  tripId,
  near,
  onDone,
}: {
  tripId: string
  near: { lat: number; lon: number } | null
  onDone: () => void
}) {
  const create = useCreatePlace(tripId)
  const [name, setName] = useState('')
  // Filled in by picking a suggestion. Typing a name by hand still
  // works and simply leaves these null, which is what happens today.
  const [found, setFound] = useState<{ lat: number; lon: number; address: string | null } | null>(
    null,
  )
  const [category, setCategory] = useState<PlaceCategory>('sight')
  const [priority, setPriority] = useState<Priority>('normal')
  const [minutes, setMinutes] = useState(60)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(
      {
        name: name.trim(),
        category,
        priority,
        visit_minutes: minutes,
        lat: found?.lat ?? null,
        lon: found?.lon ?? null,
        address: found?.address ?? null,
        // weather_exposure is left out on purpose: the server derives it
        // from the category, so the form stays short.
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <PlaceSearch
        label={t('places.name')}
        near={near}
        autoFocus
        onText={(typed) => {
          setName(typed)
          // Typing after picking means the suggestion no longer
          // describes what is in the box, so its position goes with it
          // rather than being attached to a different place.
          setFound(null)
        }}
        onPick={(hit) => {
          setName(hit.name)
          setCategory(hit.category)
          setFound({ lat: hit.lat, lon: hit.lon, address: hit.address })
        }}
      />

      {found ? (
        <p className="muted small">{t('lookup.located')}</p>
      ) : (
        name.trim() !== '' && <p className="muted small">{t('lookup.noPosition')}</p>
      )}

      <div className="row">
        <label className="field field--grow">
          <span className="field__label">{t('places.category')}</span>
          <select
            className="field__input"
            value={category}
            onChange={(event) => setCategory(event.target.value as PlaceCategory)}
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
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
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
            step={15}
            style={{ width: '9ch' }}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
        </label>
      </div>

      {create.error && (
        <p className="field__error" role="alert">
          {create.error.message || t('common.error')}
        </p>
      )}

      <div className="row row--end">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

export function PlacesPanel() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const remove = useDeletePlace(tripId ?? '')
  const update = useUpdatePlace(tripId ?? '')
  const [adding, setAdding] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const places = bundle.data.places

  /**
   * Where to look first when searching by name.
   *
   * The first stop that has coordinates. Unbiased, "ichiran ramen"
   * offers Hong Kong before Tokyo; biased, it offers the one round the
   * corner. A trip with no located stop yet simply searches the world.
   */
  /**
   * The city we would put each place in, when you have not said.
   *
   * Shown, never saved. There is no column recording whether a stop was
   * chosen or guessed, so writing a guess would make it permanent and
   * indistinguishable from your own — this way the guess is visible in
   * the very control that overrules it.
   */
  const inferred = inferStops(bundle.data)
  const stopName = new Map(bundle.data.stops.map((stop) => [stop.id, stop.name]))

  function inferredLabel(place: Place): string | null {
    const match = inferred.get(place.id)
    if (!match) return null
    const name = stopName.get(match.stopId)
    if (!name) return null
    const km = Math.round(match.km)
    return match.band === 'city'
      ? t('places.inferredCity', { stop: name, km })
      : match.band === 'day_trip'
        ? t('places.inferredDayTrip', { stop: name, km })
        : t('places.inferredFar', { stop: name, km })
  }

  const located = bundle.data.stops.find((stop) => stop.lat !== null && stop.lon !== null)
  const near = located ? { lat: located.lat as number, lon: located.lon as number } : null
  const locatedStop = located
    ? { id: located.id, name: located.name, lat: located.lat as number, lon: located.lon as number }
    : null

  return (
    <>
      <AppBar
        title={t('places.title')}
        subtitle={bundle.data.trip.title}
        back={`/trips/${tripId}`}
      />
      <main className="page stack">

      {places.length === 0 && !adding && <p className="empty">{t('places.none')}</p>}

      <ul className="docs">
        {places.map((place) => (
          <li key={place.id} className="doc">
            <span className="doc__open" style={{ cursor: 'default' }}>
              <span className="doc__name">
                {place.name}
                {place.priority === 'must_see' && <span className="pill pill--must">
                    <Icon name="star" size={12} title={priorityLabel('must_see')} />
                  </span>}
              </span>
              <span className="doc__meta">
                {placeCategoryLabel(place.category)} ·{' '}
                {formatDuration(place.visit_minutes)} · {exposureLabel(place.weather_exposure)}
              </span>
              {place.planned_start_at && place.planned_tz && (
                <span className="doc__meta doc__meta--planned">
                  {formatDayKey(dayKeyInZone(place.planned_start_at, place.planned_tz))} ·{' '}
                  {formatTimeInZone(place.planned_start_at, place.planned_tz)}
                </span>
              )}
            </span>
            <label className="doc__stop">
              {/* The link between a place and a day: without a city, no
                  day can claim it and the optimiser cannot see it. */}
              <select
                className="field__input field__input--compact"
                value={place.stop_id ?? ''}
                onChange={(event) =>
                  update.mutate({ id: place.id, stop_id: event.target.value || null })
                }
              >
                <option value="">{inferredLabel(place) ?? t('places.noStop')}</option>
                {bundle.data!.stops.map((stop) => (
                  <option key={stop.id} value={stop.id}>
                    {stop.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="doc__actions">
              <MapsLink place={place} />
              {place.planned_start_at && (
                <button
                  className="chip"
                  onClick={() =>
                    update.mutate({ id: place.id, planned_start_at: null, planned_tz: null })
                  }
                  disabled={update.isPending}
                >
                  {t('timeline.unschedule')}
                </button>
              )}
              <button
                className="chip chip--danger"
                onClick={() =>
                  confirm(t('common.confirmDelete', { name: place.name })) &&
                  remove.mutate(place.id)
                }
                aria-label={t('common.delete')}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pasting && (
        <>
          <AddPlaceFromLink
            tripId={tripId}
            near={tripCentre(bundle.data)}
            onDone={() => setPasting(false)}
          />
          <p className="muted small">{t('share.hint')}</p>
        </>
      )}
      {importing && (
        <ImportPlaces
          tripId={tripId}
          places={places}
          near={tripCentre(bundle.data)}
          onDone={() => setImporting(false)}
        />
      )}
      {adding && <AddPlace tripId={tripId} near={near} onDone={() => setAdding(false)} />}
      {suggesting &&
        (locatedStop ? (
          <SuggestPlaces
            tripId={tripId}
            stop={locatedStop}
            places={places}
            onDone={() => setSuggesting(false)}
          />
        ) : (
          <p className="hint">{t('suggest.needsStop')}</p>
        ))}

      {!adding && !pasting && !importing && !suggesting && (
        <div className="row">
          {/* Listed first: pasting a link is how places actually get
              collected, while typing one by hand is the fallback. */}
          <button className="button" onClick={() => setPasting(true)}>
            {t('maps.fromLink')}
          </button>
          <button className="button button--quiet" onClick={() => setAdding(true)}>
            {t('places.add')}
          </button>
          <button className="button button--quiet" onClick={() => setSuggesting(true)}>
            {t('suggest.find')}
          </button>
          <button className="button button--quiet" onClick={() => setImporting(true)}>
            {t('maps.import')}
          </button>
        </div>
      )}
      </main>
    </>
  )
}
