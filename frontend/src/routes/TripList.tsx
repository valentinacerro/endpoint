import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { useLogout } from '../api/auth'
import { useCreateTrip, useTrips } from '../api/trips'
import type { Trip } from '../api/types'
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

function NewTripForm({ onDone }: { onDone: () => void }) {
  const create = useCreateTrip()
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    create.mutate(
      {
        title: title.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        // The zone you are planning from; each stop carries its own.
        primary_tz: deviceTimeZone(),
        // Spelled out rather than left to the server's defaults: the
        // generated types treat a field with a default as always present,
        // and being explicit here is clearer than fighting that.
        primary_currency: 'EUR',
        status: 'planned',
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">{t('trip.field.title')}</span>
        <input
          className="field__input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          required
        />
      </label>

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
