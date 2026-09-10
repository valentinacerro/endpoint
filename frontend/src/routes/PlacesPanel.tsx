import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { useCreatePlace, useDeletePlace, useTripBundle, useUpdatePlace } from '../api/trips'
import { PLACE_CATEGORIES, type PlaceCategory, type Priority } from '../api/types'
import { AddPlaceFromLink } from '../components/AddPlaceFromLink'
import { MapsLink } from '../components/MapsLink'
import { t } from '../i18n'
import { exposureLabel, placeCategoryLabel, priorityLabel } from '../i18n/labels'
import { dayKeyInZone, formatDayKey, formatDuration, formatTimeInZone } from '../lib/datetime'

const PRIORITIES: readonly Priority[] = ['must_see', 'high', 'normal', 'low']

function AddPlace({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const create = useCreatePlace(tripId)
  const [name, setName] = useState('')
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
        // weather_exposure is left out on purpose: the server derives it
        // from the category, so the form stays short.
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">{t('places.name')}</span>
        <input
          className="field__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
        />
      </label>

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

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const places = bundle.data.places

  return (
    <main className="page stack">
      <Link className="back" to={`/trips/${tripId}`}>
        ← {bundle.data.trip.title}
      </Link>
      <h1 className="page__title">{t('places.title')}</h1>

      {places.length === 0 && !adding && <p className="empty">{t('places.none')}</p>}

      <ul className="docs">
        {places.map((place) => (
          <li key={place.id} className="doc">
            <span className="doc__open" style={{ cursor: 'default' }}>
              <span className="doc__name">
                {place.name}
                {place.priority === 'must_see' && <span className="pill pill--must">★</span>}
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

      {pasting && <AddPlaceFromLink tripId={tripId} onDone={() => setPasting(false)} />}
      {adding && <AddPlace tripId={tripId} onDone={() => setAdding(false)} />}

      {!adding && !pasting && (
        <div className="row">
          {/* Listed first: pasting a link is how places actually get
              collected, while typing one by hand is the fallback. */}
          <button className="button" onClick={() => setPasting(true)}>
            {t('maps.fromLink')}
          </button>
          <button className="button button--quiet" onClick={() => setAdding(true)}>
            {t('places.add')}
          </button>
        </div>
      )}
    </main>
  )
}
