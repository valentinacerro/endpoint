import { useState, type FormEvent } from 'react'

import { useCreateBooking } from '../api/trips'
import { BOOKING_KINDS, type BookingKind, type Stop } from '../api/types'
import { t } from '../i18n'
import { bookingKindLabel } from '../i18n/labels'
import { shortZoneName, zonedInputToInstant } from '../lib/datetime'

/** Kinds that move you from one place to another, and so have two ends. */
const TRAVEL_KINDS: ReadonlySet<BookingKind> = new Set([
  'flight',
  'train',
  'bus',
  'ferry',
  'car_rental',
])

/** Kinds where an address is what you actually need on arrival. */
const PLACE_KINDS: ReadonlySet<BookingKind> = new Set([
  'hotel',
  'restaurant',
  'activity',
  'other',
])

interface Props {
  tripId: string
  defaultZone: string
  stops: Stop[]
  onDone: () => void
}

export function BookingForm({ tripId, defaultZone, stops, onDone }: Props) {
  const create = useCreateBooking(tripId)

  const [kind, setKind] = useState<BookingKind>('hotel')
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState('')
  const [code, setCode] = useState('')
  const [start, setStart] = useState('')
  const [startTz, setStartTz] = useState(defaultZone)
  const [end, setEnd] = useState('')
  const [endTz, setEndTz] = useState(defaultZone)
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [address, setAddress] = useState('')

  // The zones actually relevant to this trip, rather than a list of 400.
  const zones = [...new Set([defaultZone, ...stops.map((stop) => stop.tz)])]

  const isTravel = TRAVEL_KINDS.has(kind)
  const isPlace = PLACE_KINDS.has(kind)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return

    create.mutate(
      {
        kind,
        title: title.trim(),
        status: 'confirmed',
        // The form always collects a time, never a bare date.
        start_precision: 'datetime',
        end_precision: 'datetime',
        provider: provider.trim() || null,
        confirmation_code: code.trim() || null,
        // The typed time is wall-clock time *in the chosen zone*. Reading it
        // as the device's local time is the mistake this whole app is built
        // to avoid.
        start_at: start ? zonedInputToInstant(start, startTz) : null,
        start_tz: start ? startTz : null,
        end_at: end ? zonedInputToInstant(end, endTz) : null,
        end_tz: end ? endTz : null,
        origin_label: isTravel && origin.trim() ? origin.trim() : null,
        destination_label: isTravel && destination.trim() ? destination.trim() : null,
        address: isPlace && address.trim() ? address.trim() : null,
      },
      { onSuccess: onDone },
    )
  }

  const zoneSelect = (value: string, onChange: (next: string) => void, label: string) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="field__input" value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {shortZoneName(zone)}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <div className="row">
        <label className="field">
          <span className="field__label">{t('booking.field.kind')}</span>
          <select
            className="field__input"
            value={kind}
            onChange={(event) => setKind(event.target.value as BookingKind)}
          >
            {BOOKING_KINDS.map((option) => (
              <option key={option} value={option}>
                {bookingKindLabel(option)}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--grow">
          <span className="field__label">{t('booking.field.title')}</span>
          <input
            className="field__input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            required
          />
        </label>
      </div>

      <div className="row">
        <label className="field field--grow">
          <span className="field__label">{t('booking.field.start')}</span>
          <input
            className="field__input"
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        {zones.length > 1 && zoneSelect(startTz, setStartTz, t('booking.field.startTz'))}
      </div>

      <div className="row">
        <label className="field field--grow">
          <span className="field__label">{t('booking.field.end')}</span>
          <input
            className="field__input"
            type="datetime-local"
            value={end}
            min={start || undefined}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        {zones.length > 1 && zoneSelect(endTz, setEndTz, t('booking.field.endTz'))}
      </div>

      {isTravel && zones.length > 1 && <p className="hint">{t('booking.hint.differentZones')}</p>}

      {isTravel && (
        <div className="row">
          <label className="field field--grow">
            <span className="field__label">{t('booking.field.origin')}</span>
            <input
              className="field__input"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            />
          </label>
          <label className="field field--grow">
            <span className="field__label">{t('booking.field.destination')}</span>
            <input
              className="field__input"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            />
          </label>
        </div>
      )}

      {isPlace && (
        <label className="field">
          <span className="field__label">{t('booking.field.address')}</span>
          <input
            className="field__input"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
      )}

      <div className="row">
        <label className="field field--grow">
          <span className="field__label">{t('booking.field.provider')}</span>
          <input
            className="field__input"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          />
        </label>
        <label className="field field--grow">
          <span className="field__label">{t('booking.field.code')}</span>
          <input
            className="field__input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
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
        <button className="button" type="submit" disabled={create.isPending || !title.trim()}>
          {create.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}
