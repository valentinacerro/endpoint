import { useState } from 'react'

import { t } from '../i18n'
import { hasSeenTour, rememberTourSeen, runTour } from '../lib/tour'

/**
 * The offer of a guided walk, made once.
 *
 * An offer rather than a tour that starts on its own: an overlay that
 * appears unasked over an app you have just opened is the thing people
 * dismiss without reading. Declining counts as having seen it, so this
 * never asks twice — Settings has a row to take the walk later.
 */
export function TourOffer() {
  // Read once, at mount: re-reading on every render would make the row
  // vanish mid-animation when the tour writes the flag.
  const [show, setShow] = useState(() => !hasSeenTour())

  if (!show) return null

  function dismiss() {
    rememberTourSeen()
    setShow(false)
  }

  return (
    <div className="card prompt prompt--offer">
      <span className="prompt__body">
        <span className="prompt__hint">{t('tour.offer')}</span>
      </span>
      <button className="chip" onClick={dismiss}>
        {t('tour.dismiss')}
      </button>
      <button
        className="chip chip--on"
        onClick={() => {
          setShow(false)
          void runTour()
        }}
      >
        {t('tour.start')}
      </button>
    </div>
  )
}
