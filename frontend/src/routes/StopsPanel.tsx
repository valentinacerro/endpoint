import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import {
  useCreateStop,
  useDeleteStop,
  useReorderStops,
  useTripBundle,
} from '../api/trips'
import type { Stop } from '../api/types'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { LocateStops } from '../components/LocateStops'
import { Nothing } from '../components/Nothing'
import { PlaceSearch } from '../components/PlaceSearch'
import { t } from '../i18n'
import { formatCalendarDate } from '../lib/datetime'
import { timeZoneOptions } from '../lib/zones'

function AddStop({ tripId, defaultZone, onDone }: {
  tripId: string
  defaultZone: string
  onDone: () => void
}) {
  const create = useCreateStop(tripId)
  const [name, setName] = useState('')
  // A stop has had lat/lon in the table since the first migration and
  // nothing ever wrote them. Everything that reasons about which city a
  // place belongs to needs a city to measure from.
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [tz, setTz] = useState(defaultZone)
  const [country, setCountry] = useState('')
  const [arrive, setArrive] = useState('')
  const [depart, setDepart] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(
      {
        name: name.trim(),
        tz,
        country_code: country.trim() || null,
        arrive_date: arrive || null,
        depart_date: depart || null,
        lat: point?.lat ?? null,
        lon: point?.lon ?? null,
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <div className="row">
        <div className="field--grow">
          <PlaceSearch
            label={t('stops.name')}
            near={null}
            autoFocus
            onText={(typed) => {
              setName(typed)
              setPoint(null)
            }}
            onPick={(hit) => {
              setName(hit.name)
              setPoint({ lat: hit.lat, lon: hit.lon })
            }}
          />
        </div>
        <label className="field">
          <span className="field__label">{t('stops.country')}</span>
          <input
            className="field__input"
            value={country}
            maxLength={2}
            style={{ width: '6ch' }}
            onChange={(event) => setCountry(event.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span className="field__label">{t('stops.tz')}</span>
        <input
          className="field__input"
          list="tz-options"
          value={tz}
          onChange={(event) => setTz(event.target.value)}
          required
        />
      </label>
      <datalist id="tz-options">
        {timeZoneOptions().map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <p className="hint">{t('stops.tzHint')}</p>

      <div className="row">
        <label className="field field--grow">
          <span className="field__label">{t('stops.arrive')}</span>
          <input
            className="field__input"
            type="date"
            value={arrive}
            onChange={(event) => setArrive(event.target.value)}
          />
        </label>
        <label className="field field--grow">
          <span className="field__label">{t('stops.depart')}</span>
          <input
            className="field__input"
            type="date"
            value={depart}
            min={arrive || undefined}
            onChange={(event) => setDepart(event.target.value)}
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

export function StopsPanel() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const reorder = useReorderStops(tripId ?? '')
  const remove = useDeleteStop(tripId ?? '')
  const [adding, setAdding] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const stops = bundle.data.stops

  /**
   * Move a stop one place, by sending the whole new order.
   *
   * The API takes the complete list rather than "move this to index n",
   * which makes the operation idempotent and gaps impossible to express.
   */
  function move(stop: Stop, delta: number) {
    const ids = stops.map((item) => item.id)
    const from = ids.indexOf(stop.id)
    const to = from + delta
    if (to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    reorder.mutate(ids)
  }

  return (
    <>
      <AppBar
        title={t('stops.title')}
        subtitle={bundle.data.trip.title}
        back={`/trips/${tripId}/more`}
      />
      <main className="page stack">

      {stops.length === 0 && !adding && (
        <Nothing
          title={t('stops.none')}
          hint={t('stops.noneHint')}
          action={
            <button className="button button--small" onClick={() => setAdding(true)}>
              {t('stops.add')}
            </button>
          }
        />
      )}

      <LocateStops tripId={tripId} stops={stops} />

      <ol className="stops">
        {stops.map((stop, index) => (
          <li key={stop.id} className="stop">
            <span className="stop__index">{index + 1}</span>
            <div className="stop__body">
              <span className="stop__name">
                {stop.name}
                {stop.country_code && <span className="muted"> · {stop.country_code}</span>}
              </span>
              <span className="stop__meta">
                {stop.arrive_date && formatCalendarDate(stop.arrive_date)}
                {stop.depart_date && ` → ${formatCalendarDate(stop.depart_date)}`}
                {stop.arrive_date && ' · '}
                {stop.tz}
              </span>
            </div>
            <div className="stop__actions">
              <button
                className="chip"
                onClick={() => move(stop, -1)}
                disabled={index === 0 || reorder.isPending}
                aria-label={t('stops.moveUp')}
              >
                <Icon name="up" size={15} />
              </button>
              <button
                className="chip"
                onClick={() => move(stop, 1)}
                disabled={index === stops.length - 1 || reorder.isPending}
                aria-label={t('stops.moveDown')}
              >
                <Icon name="down" size={15} />
              </button>
              <button
                className="chip chip--danger"
                onClick={() =>
                  confirm(t('common.confirmDelete', { name: stop.name })) &&
                  remove.mutate(stop.id)
                }
                aria-label={t('common.delete')}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ol>

      {adding ? (
        <AddStop
          tripId={tripId}
          defaultZone={stops.at(-1)?.tz ?? bundle.data.trip.primary_tz}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="button" onClick={() => setAdding(true)}>
          {t('stops.add')}
        </button>
      )}
      </main>
    </>
  )
}
