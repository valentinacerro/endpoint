import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { useDeleteBooking, useTripBundle } from '../api/trips'
import type { Booking, Trip } from '../api/types'
import { AttachmentList } from '../components/AttachmentList'
import { BookingForm } from '../components/BookingForm'
import { MapsLink } from '../components/MapsLink'
import { AppBar } from '../components/AppBar'
import { t } from '../i18n'
import { bookingKindLabel } from '../i18n/labels'
import { formatDayKey, formatTimeInZone, shortZoneName } from '../lib/datetime'
import { attachmentsOf } from '../lib/itinerary'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null
  return (
    <div className="detail">
      <dt className="detail__label">{label}</dt>
      <dd className="detail__value">{children}</dd>
    </div>
  )
}

/** "sab 11 apr, 14:05 Rome" */
function moment(instant: string, zone: string, showZone: boolean): string {
  const day = formatDayKey(instant.slice(0, 10))
  const time = formatTimeInZone(instant, zone)
  return showZone ? `${day}, ${time} ${shortZoneName(zone)}` : `${day}, ${time}`
}

function Details({
  booking,
  trip,
  showZone,
}: {
  booking: Booking
  trip: Trip
  showZone: boolean
}) {
  return (
    <dl className="details card">
      <Row label={t('booking.detail.when')}>
        {booking.start_at && (
          <>
            {moment(booking.start_at, booking.start_tz ?? trip.primary_tz, showZone)}
            {booking.end_at && (
              <>
                {' → '}
                {moment(booking.end_at, booking.end_tz ?? trip.primary_tz, showZone)}
              </>
            )}
          </>
        )}
      </Row>

      <Row label={t('booking.detail.route')}>
        {(booking.origin_label || booking.destination_label) &&
          `${booking.origin_label ?? '?'} → ${booking.destination_label ?? '?'}`}
      </Row>

      <Row label={t('booking.detail.where')}>{booking.address}</Row>

      <Row label={t('booking.detail.reference')}>
        {(booking.provider || booking.confirmation_code) && (
          <>
            {booking.provider}
            {booking.provider && booking.confirmation_code && ' · '}
            {/* Selectable and set apart: this is the string you read out at
                a reception desk or type into a kiosk. */}
            {booking.confirmation_code && <code>{booking.confirmation_code}</code>}
          </>
        )}
      </Row>

      <Row label={t('booking.detail.price')}>
        {booking.price_amount && `${booking.price_amount} ${booking.price_currency ?? ''}`}
      </Row>

      <Row label={t('booking.detail.notes')}>{booking.notes}</Row>
    </dl>
  )
}

export function BookingDetail() {
  const { tripId, bookingId } = useParams<{ tripId: string; bookingId: string }>()
  const bundle = useTripBundle(tripId)
  const remove = useDeleteBooking(tripId ?? '')
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>

  const booking = bundle.data?.bookings.find((item) => item.id === bookingId)
  if (!bundle.data || !booking || !tripId) return <main className="page">{t('common.error')}</main>

  const { trip } = bundle.data
  // Two ends in different zones is the case that makes labelling worth it.
  const showZone = booking.start_tz !== booking.end_tz || booking.start_tz !== trip.primary_tz
  const attachments = attachmentsOf(bundle.data, booking.id)

  function onDelete() {
    if (!confirm(t('common.confirmDelete', { name: booking!.title }))) return
    remove.mutate(booking!.id, { onSuccess: () => navigate(`/trips/${tripId}`) })
  }

  return (
    <>
      <AppBar
        title={booking.title}
        subtitle={bookingKindLabel(booking.kind)}
        back={`/trips/${tripId}`}
      />
      <main className="page stack">

      {editing ? (
        <BookingForm
          tripId={tripId}
          defaultZone={trip.primary_tz}
          stops={bundle.data.stops}
          booking={booking}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          <Details booking={booking} trip={trip} showZone={showZone} />
          <MapsLink
            place={{
              lat: booking.lat,
              lon: booking.lon,
              address: booking.address,
              // The destination beats the title for anything that moves:
              // "HND Haneda" finds an airport, "Roma FCO -> Tokyo HND" does not.
              name: booking.destination_label ?? booking.title,
            }}
          />
          <button className="button button--quiet" onClick={() => setEditing(true)}>
            {t('common.edit')}
          </button>
        </>
      )}

      <AttachmentList tripId={tripId} bookingId={booking.id} attachments={attachments} />

      <button className="button button--quiet button--danger" onClick={onDelete}>
        {t('booking.detail.delete')}
      </button>
      </main>
    </>
  )
}
