import { useState } from 'react'

import { useUpdatePlace } from '../api/trips'
import type { Place } from '../api/types'
import { t } from '../i18n'
import { placeCategoryLabel, priorityLabel } from '../i18n/labels'
import { formatDuration, shortZoneName, zonedInputToInstant } from '../lib/datetime'

interface Props {
  tripId: string
  place: Place
  defaultZone: string
  /** Where to start the picker: the first day of the trip is the usual guess. */
  defaultDay: string | null
}

/**
 * A wish-list place, with a way to drop it onto a day.
 *
 * The picker defaults to a morning on the first day of the trip rather than
 * to "now": you are planning April from February, and a default of today
 * would put every visit in the past.
 */
export function SchedulePlace({ tripId, place, defaultZone, defaultDay }: Props) {
  const update = useUpdatePlace(tripId)
  const [open, setOpen] = useState(false)
  const [when, setWhen] = useState(defaultDay ? `${defaultDay}T09:00` : '')
  const [zone, setZone] = useState(place.planned_tz ?? defaultZone)

  function schedule() {
    if (!when) return
    update.mutate(
      {
        id: place.id,
        planned_start_at: zonedInputToInstant(when, zone),
        planned_tz: zone,
      },
      { onSuccess: () => setOpen(false) },
    )
  }

  return (
    <li className="doc doc--stack">
      <div className="doc__row">
        <span className="doc__open" style={{ cursor: 'default' }}>
          <span className="doc__name">
            <span aria-hidden="true">📍</span> {place.name}
          </span>
          <span className="doc__meta">
            {placeCategoryLabel(place.category)} · {formatDuration(place.visit_minutes)}
            {place.priority === 'must_see' && ` · ${priorityLabel(place.priority)}`}
          </span>
        </span>
        <button className="chip" onClick={() => setOpen((value) => !value)}>
          {t('timeline.schedule')}
        </button>
      </div>

      {open && (
        <div className="row">
          <label className="field field--grow">
            <span className="field__label">{t('timeline.scheduleOn')}</span>
            <input
              className="field__input"
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('stops.tz')}</span>
            <select
              className="field__input"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
            >
              {[...new Set([zone, defaultZone])].map((option) => (
                <option key={option} value={option}>
                  {shortZoneName(option)}
                </option>
              ))}
            </select>
          </label>
          <button className="button button--small" onClick={schedule} disabled={!when || update.isPending}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      )}
    </li>
  )
}
