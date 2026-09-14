import { useState } from 'react'

import { useSetTravelTime } from '../api/trips'
import type { Point } from '../lib/geo'
import { formatDuration } from '../lib/datetime'
import { t } from '../i18n'

/**
 * The estimated travel time, and a way to say what it really is.
 *
 * The distances this app computes are within a few per cent of real
 * routing. The times are not, and cannot be: no straight line knows
 * whether a railway joins two points, so Senso-ji to Shibuya comes out
 * fifty-four minutes against a real thirty-five. There is no free way to
 * fix that for Japan — the timetable data is open, running a router on it
 * is not.
 *
 * What there is instead is you, once, with a timetable open. The number
 * you type is kept against the two coordinates, so it survives renaming
 * the place, deleting it, or saving the same spot twice from two links —
 * and every later plan uses it to decide the order, not merely to label
 * it.
 */
export function CorrectLeg({
  tripId,
  from,
  to,
  minutes,
  corrected,
}: {
  tripId: string
  from: Point | null
  to: Point | null
  minutes: number
  /** True when this number is already one you gave. */
  corrected: boolean
}) {
  const save = useSetTravelTime(tripId)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(minutes))

  // Nothing to correct a leg against if we do not know both ends.
  if (!from || !to) return <span className="plan__travel">+{formatDuration(minutes)}</span>

  if (!editing) {
    return (
      <button
        className={`plan__travel plan__travel--editable ${corrected ? 'plan__travel--known' : ''}`}
        onClick={() => {
          setValue(String(minutes))
          setEditing(true)
        }}
        title={corrected ? t('leg.known') : t('leg.estimated')}
      >
        +{formatDuration(minutes)}
        {corrected && <span aria-hidden="true"> ✓</span>}
      </button>
    )
  }

  return (
    <span className="plan__travel">
      <input
        className="field__input field__input--compact"
        type="number"
        min={0}
        max={1440}
        inputMode="numeric"
        value={value}
        autoFocus
        aria-label={t('leg.realMinutes')}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        className="chip"
        disabled={save.isPending}
        onClick={() => {
          const asked = Number(value)
          if (Number.isFinite(asked) && asked >= 0 && asked <= 1440) {
            save.mutate({ from, to, minutes: Math.round(asked) })
          }
          setEditing(false)
        }}
      >
        {t('common.save')}
      </button>
    </span>
  )
}
