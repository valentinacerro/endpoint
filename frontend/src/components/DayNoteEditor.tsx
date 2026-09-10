import { useState } from 'react'

import { useClearDayNote, useSetDayNote } from '../api/trips'
import type { DayNote } from '../api/types'
import { t } from '../i18n'

interface Props {
  tripId: string
  day: string
  note: DayNote | undefined
}

/**
 * A note belonging to a day rather than to anything on it.
 *
 * "Giornata libera", "chiuso il lunedì", "comprare il JR Pass" — things that
 * would otherwise end up buried in the notes field of an unrelated hotel,
 * where you will not find them on the morning they matter.
 */
export function DayNoteEditor({ tripId, day, note }: Props) {
  const save = useSetDayNote(tripId)
  const clear = useClearDayNote(tripId)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note?.note ?? '')

  function open() {
    setText(note?.note ?? '')
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    if (!trimmed) {
      // Emptying the box means removing the note, not storing a blank one
      // that would render as a mysterious gap in the day.
      if (note) clear.mutate(day, { onSuccess: () => setEditing(false) })
      else setEditing(false)
      return
    }
    save.mutate({ day, note: trimmed }, { onSuccess: () => setEditing(false) })
  }

  if (editing) {
    return (
      <div className="daynote daynote--editing">
        <textarea
          className="field__input"
          rows={2}
          value={text}
          autoFocus
          placeholder={t('daynote.placeholder')}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="row row--end">
          <button className="button button--small button--quiet" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="button button--small"
            onClick={commit}
            disabled={save.isPending || clear.isPending}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    )
  }

  if (!note) {
    return (
      <button className="daynote daynote--add" onClick={open}>
        + {t('daynote.add')}
      </button>
    )
  }

  return (
    <button className="daynote" onClick={open}>
      {note.note}
    </button>
  )
}
