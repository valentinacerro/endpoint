import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { useLogout } from '../api/auth'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'

import { apiFetch } from '../api/client'
import { keys, useCreateTrip, useTrips } from '../api/trips'
import type { PlaceHit, Trip } from '../api/types'
import { PlaceSearch } from '../components/PlaceSearch'
import { AppBar } from '../components/AppBar'
import { t } from '../i18n'
import { tripStatusLabel } from '../i18n/labels'
import { deviceTimeZone, formatCalendarDate } from '../lib/datetime'

function dateLabel(trip: Trip): string {
  if (!trip.start_date) return t('trips.noDates')
  if (!trip.end_date) return formatCalendarDate(trip.start_date)
  return t('trips.dates', {
    from: formatCalendarDate(trip.start_date),
    to: formatCalendarDate(trip.end_date),
  })
}

/**
 * Starting a trip.
 *
 * It used to ask for a title. That is the wrong first question: it is the
 * one field the app cannot do anything with, and it left a newcomer at
 * "now what?" — the destination stayed empty forever, so the home screen
 * fell back to showing the title, and the first real step (a stop with a
 * position) was three screens away behind a tab called More.
 *
 * It asks where you are going instead. Choosing a place from the lookup
 * gives a name, a position, a country and a time zone at once — which is
 * exactly a first stop — so the trip is created and the stop with it, and
 * step one of three is done before the form closes.
 */
function NewTripForm({ onDone }: { onDone: () => void }) {
  const create = useCreateTrip()
  const [title, setTitle] = useState('')
  const [where, setWhere] = useState<PlaceHit | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const name = title.trim()
    if (!name) return

    const trip = await create.mutateAsync({
      title: name,
      destination_label: where?.name ?? name,
      start_date: startDate || null,
      end_date: endDate || null,
      // The home clock the app compares against — "08:30 where you are" —
      // not where the trip happens. Each stop carries its own.
      primary_tz: deviceTimeZone(),
      // Spelled out rather than left to the server's defaults: the
      // generated types treat a field with a default as always present,
      // and being explicit here is clearer than fighting that.
      primary_currency: 'EUR',
      status: 'planned',
    })

    // The lookup already told us everything a first stop needs. Asking
    // for it again on another screen would be asking twice.
    if (where) {
      await apiFetch(`/api/trips/${trip.id}/stops`, {
        method: 'POST',
        body: {
          name: where.name,
          tz: where.tz ?? deviceTimeZone(),
          country_code: where.country ?? null,
          lat: where.lat,
          lon: where.lon,
          arrive_date: startDate || null,
          depart_date: endDate || null,
        },
      })
      await queryClient.invalidateQueries({ queryKey: keys.bundle(trip.id) })
    }

    onDone()
    navigate(`/trips/${trip.id}`)
  }

  return (
    <form className="card stack" onSubmit={(event) => void onSubmit(event)}>
      <PlaceSearch
        label={t('trip.field.where')}
        near={null}
        autoFocus
        onText={(typed) => {
          setTitle(typed)
          setWhere(null)
        }}
        onPick={(hit) => {
          setTitle(hit.name)
          setWhere(hit)
        }}
      />
      <p className="muted small">{where ? t('trip.whereFound') : t('trip.whereHint')}</p>

      <div className="row">
        <label className="field">
          <span className="field__label">{t('trip.field.startDate')}</span>
          <input
            className="field__input"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('trip.field.endDate')}</span>
          <input
            className="field__input"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
      </div>

      {create.error && (
        <p className="field__error" role="alert">
          {t('common.error')}
        </p>
      )}

      <div className="row row--end">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={create.isPending || !title.trim()}>
          {create.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

export function TripList() {
  const trips = useTrips()
  const logout = useLogout()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <AppBar
        title={t('trips.title')}
        back="/"
        action={
          <button className="appbar__button" onClick={() => logout.mutate()}>
            {t('trips.logout')}
          </button>
        }
      />
      <main className="page stack">

      {adding ? (
        <NewTripForm onDone={() => setAdding(false)} />
      ) : (
        <button className="button" onClick={() => setAdding(true)}>
          {t('trips.new')}
        </button>
      )}

      {trips.isPending && <p className="muted">{t('common.loading')}</p>}

      {trips.data?.length === 0 && !adding && <p className="empty">{t('trips.empty')}</p>}

      <ul className="list">
        {trips.data?.map((trip) => (
          <li key={trip.id}>
            <Link className="list__item" to={`/trips/${trip.id}`}>
              <span className="list__title">{trip.title}</span>
              <span className="list__meta">
                {dateLabel(trip)} · {tripStatusLabel(trip.status)}
              </span>
              <span className="list__chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      </main>
    </>
  )
}
