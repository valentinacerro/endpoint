import { Link, useNavigate, useParams } from 'react-router'

import { useDeleteBooking, useTripBundle } from '../api/trips'
import { AttachmentList } from '../components/AttachmentList'
import { t } from '../i18n'
import { BOOKING_KIND_ICON, bookingKindLabel } from '../i18n/labels'
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

export function BookingDetail() {
  const { tripId, bookingId } = useParams<{ tripId: string; bookingId: string }>()
  const bundle = useTripBundle(tripId)
  const remove = useDeleteBooking(tripId ?? '')
  const navigate = useNavigate()

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>

  const booking = bundle.data?.bookings.find((item) => item.id === bookingId)
  if (!bundle.data || !booking) return <main className="page">{t('common.error')}</main>

  const { trip } = bundle.data
  // Two ends in different zones is the case that makes labelling worth it.
  const showZone = booking.start_tz !== booking.end_tz || booking.start_tz !== trip.primary_tz
  const attachments = attachmentsOf(bundle.data, booking.id)

  function onDelete() {
    if (!confirm(t('common.confirmDelete', { name: booking!.title }))) return
    remove.mutate(booking!.id, { onSuccess: () => navigate(`/trips/${tripId}`) })
  }

  return (
    <main className="page stack">
      <Link className="back" to={`/trips/${tripId}`}>
        ← {trip.title}
      </Link>

      <header className="stack stack--tight">
        <span className="muted">
          <span aria-hidden="true">{BOOKING_KIND_ICON[booking.kind]}</span>{' '}
          {bookingKindLabel(booking.kind)}
        </span>
        <h1 className="page__title">{booking.title}</h1>
      </header>

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
              {/* Selectable and monospaced: this is the string you read out
                  at a reception desk or type into a kiosk. */}
              {booking.confirmation_code && <code>{booking.confirmation_code}</code>}
            </>
          )}
        </Row>

        <Row label={t('booking.detail.price')}>
          {booking.price_amount && `${booking.price_amount} ${booking.price_currency ?? ''}`}
        </Row>

        <Row label={t('booking.detail.notes')}>{booking.notes}</Row>
      </dl>

      {tripId && (
        <AttachmentList tripId={tripId} bookingId={booking.id} attachments={attachments} />
      )}

      <button className="button button--quiet button--danger" onClick={onDelete}>
        {t('booking.detail.delete')}
      </button>
    </main>
  )
}
