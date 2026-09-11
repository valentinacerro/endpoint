import { Link } from 'react-router'

import type { Booking, Place } from '../api/types'
import { Icon, type IconName } from './Icon'
import { t } from '../i18n'
import { BOOKING_KIND_ICON, bookingKindLabel, placeCategoryLabel } from '../i18n/labels'
import {
  formatDuration,
  formatTimeInZone,
  homeTimeHint,
  shortZoneName,
} from '../lib/datetime'
import type { PlacedEntry } from '../lib/itinerary'

const PLACE_ICON: IconName = 'pin'

function StatusPill({ status }: { status: Booking['status'] }) {
  if (status === 'confirmed') return null
  return (
    <span className={`pill pill--${status}`}>
      {status === 'pending' ? t('booking.status.pending') : t('booking.status.cancelled')}
    </span>
  )
}

interface Props {
  placed: PlacedEntry
  showZone: boolean
  tripId: string
  documents: number
  onMoveDays?: (place: Place, days: number) => void
}

export function TimelineEntry({ placed, showZone, tripId, documents, onMoveDays }: Props) {
  const { entry, gapMinutes, overlaps } = placed
  const hint = homeTimeHint(entry.startAt, entry.zone)

  const isBooking = entry.type === 'booking'
  const kind = isBooking ? entry.booking.kind : 'other'
  const icon = isBooking ? BOOKING_KIND_ICON[entry.booking.kind] : PLACE_ICON

  const meta = isBooking
    ? [bookingKindLabel(entry.booking.kind), entry.booking.provider, entry.booking.confirmation_code]
        .filter(Boolean)
        .join(' · ')
    : [
        placeCategoryLabel(entry.place.category),
        t('timeline.visit', { duration: formatDuration(entry.place.visit_minutes) }),
      ].join(' · ')

  const body = (
    <>
      <span className="entry__title">
        {isBooking ? entry.booking.title : entry.place.name}
        {isBooking && <StatusPill status={entry.booking.status} />}
        {documents > 0 && (
          <span className="entry__docs">
            <Icon name="paperclip" size={13} title={t('timeline.hasDocuments')} />
          </span>
        )}
      </span>
      {isBooking && (entry.booking.origin_label || entry.booking.destination_label) && (
        <span className="entry__route">
          {entry.booking.origin_label} → {entry.booking.destination_label}
        </span>
      )}
      <span className="entry__meta">{meta}</span>
    </>
  )

  return (
    <>
      {/* Free time is shown as its own row rather than as a note on the next
          item: an empty afternoon is a thing you can plan into, and it
          should look like a slot. */}
      {gapMinutes !== null && (
        <li className="gap" aria-hidden="true">
          <span className="gap__line" />
          <span className="gap__label">
            {t('timeline.gap', { duration: formatDuration(gapMinutes) })}
          </span>
        </li>
      )}

      <li className={`entry ${overlaps ? 'entry--clash' : ''}`} data-kind={kind}>
        <div className="entry__time">
          <span>{formatTimeInZone(entry.startAt, entry.zone)}</span>
          {showZone && <span className="entry__zone">{shortZoneName(entry.zone)}</span>}
          {hint && <span className="entry__hint">{t('timeline.inYourZone', hint)}</span>}
        </div>

        <div className="entry__marker">
          <span className="entry__dot" aria-hidden="true">
            {icon}
          </span>
        </div>

        {isBooking ? (
          <Link
            className="entry__content"
            to={`/trips/${tripId}/bookings/${entry.booking.id}`}
          >
            {body}
          </Link>
        ) : (
          <div className="entry__content">
            {body}
            {/* Shuffling a plan is cheap; a booking is a fact and has to be
                edited deliberately on its own screen. */}
            <span className="entry__move">
              <button
                className="chip"
                onClick={() => onMoveDays?.(entry.place, -1)}
                aria-label={t('timeline.movePrevDay')}
              >
                ‹
              </button>
              <button
                className="chip"
                onClick={() => onMoveDays?.(entry.place, 1)}
                aria-label={t('timeline.moveNextDay')}
              >
                ›
              </button>
            </span>
          </div>
        )}

        {overlaps && <span className="entry__clash">{t('timeline.overlap')}</span>}
      </li>
    </>
  )
}
