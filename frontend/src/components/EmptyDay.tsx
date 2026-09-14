import { useState } from 'react'

import { DayNoteEditor } from './DayNoteEditor'
import { t } from '../i18n'

/**
 * A day with nothing on it, in one line.
 *
 * The itinerary showed every empty day as a note button, a sentence and a
 * reorder chip — around two hundred pixels each, repeated down a fortnight
 * that is mostly still to plan. Scrolling past three thousand pixels of
 * "nothing planned" to reach the two days that have something on them is
 * not a view of a trip.
 *
 * So it is a line that says so and, if you press it, becomes the note
 * editor it used to be. Nothing is lost; it is just not all shouting at
 * once.
 */
export function EmptyDay({ tripId, day }: { tripId: string; day: string }) {
  const [adding, setAdding] = useState(false)

  if (adding) return <DayNoteEditor tripId={tripId} day={day} note={undefined} startOpen />

  return (
    <button className="day__empty day__empty--add" onClick={() => setAdding(true)}>
      {t('timeline.emptyDay')} <span className="day__add-note">{t('timeline.addNote')}</span>
    </button>
  )
}
