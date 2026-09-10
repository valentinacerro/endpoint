import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'

import { useDeleteTrip, useTripBundle, useUpdateTrip } from '../api/trips'
import type { TripStatus } from '../api/types'
import { AppBar } from '../components/AppBar'
import { t } from '../i18n'
import { tripStatusLabel } from '../i18n/labels'
import { timeZoneOptions } from '../lib/zones'

const STATUSES: readonly TripStatus[] = ['planned', 'active', 'done', 'archived']

export function TripEdit() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const update = useUpdateTrip(tripId ?? '')
  const remove = useDeleteTrip()
  const navigate = useNavigate()

  const trip = bundle.data?.trip

  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [tz, setTz] = useState('')
  const [currency, setCurrency] = useState('')
  const [budget, setBudget] = useState('')
  const [status, setStatus] = useState<TripStatus>('planned')
  const [ready, setReady] = useState(false)

  // Fill the form once the trip arrives, then leave it alone: re-syncing on
  // every render would wipe out whatever is being typed.
  if (trip && !ready) {
    setTitle(trip.title)
    setDestination(trip.destination_label ?? '')
    setStartDate(trip.start_date ?? '')
    setEndDate(trip.end_date ?? '')
    setTz(trip.primary_tz)
    setCurrency(trip.primary_currency)
    setBudget(trip.budget_amount ? String(trip.budget_amount) : '')
    setStatus(trip.status)
    setReady(true)
  }

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!trip || !tripId) return <main className="page">{t('common.error')}</main>

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      {
        title: title.trim(),
        destination_label: destination.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        primary_tz: tz,
        primary_currency: currency.toUpperCase(),
        budget_amount: budget ? budget : null,
        status,
      },
      { onSuccess: () => navigate(`/trips/${tripId}`) },
    )
  }

  function onDelete() {
    if (!confirm(t('common.confirmDelete', { name: trip!.title }))) return
    remove.mutate(tripId!, { onSuccess: () => navigate('/') })
  }

  return (
    <>
      <AppBar title={t('trip.edit')} subtitle={trip.title} back={`/trips/${tripId}/more`} />
      <main className="page stack">

      <form className="card stack" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">{t('trip.field.title')}</span>
          <input
            className="field__input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">{t('trip.field.destination')}</span>
          <input
            className="field__input"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          />
        </label>

        <div className="row">
          <label className="field field--grow">
            <span className="field__label">{t('trip.field.startDate')}</span>
            <input
              className="field__input"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="field field--grow">
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

        <label className="field">
          <span className="field__label">{t('trip.field.timezone')}</span>
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

        <div className="row">
          <label className="field">
            <span className="field__label">{t('trip.field.currency')}</span>
            <input
              className="field__input"
              value={currency}
              maxLength={3}
              style={{ width: '7ch' }}
              onChange={(event) => setCurrency(event.target.value)}
              required
            />
          </label>
          <label className="field field--grow">
            <span className="field__label">{t('trip.field.budget')}</span>
            <input
              className="field__input"
              type="number"
              min={0}
              step="0.01"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
          <label className="field field--grow">
            <span className="field__label">{t('trip.field.status')}</span>
            <select
              className="field__input"
              value={status}
              onChange={(event) => setStatus(event.target.value as TripStatus)}
            >
              {STATUSES.map((option) => (
                <option key={option} value={option}>
                  {tripStatusLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {update.error && (
          <p className="field__error" role="alert">
            {update.error.message || t('common.error')}
          </p>
        )}

        <div className="row row--end">
          <button className="button" type="submit" disabled={update.isPending || !title.trim()}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>

      <button className="button button--quiet button--danger" onClick={onDelete}>
        {t('common.delete')}
      </button>
      </main>
    </>
  )
}
