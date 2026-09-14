import { useClearDayNote, useSetDayNote } from '../api/trips'
import type { DayNote, DayTheme as Theme } from '../api/types'
import { t } from '../i18n'
import { dayThemeLabel } from '../i18n/labels'
import { DAY_THEMES } from '../lib/themes'

/**
 * What kind of day you want this one to be.
 *
 * "Magari mi va di farmi la strada dei negozi, o una giornata musei."
 * Without it the planner has one idea of a good day — the nearest
 * well-known things, whatever they are — so a fortnight comes out as
 * fourteen days of the same shape.
 *
 * A row of chips rather than a menu: there are five, they are the whole
 * list, and a menu would hide four of them behind a tap to save a line.
 * Pressing the one already on takes it off again, because "no theme" is a
 * real answer and needs somewhere to be said.
 */
export function DayThemePicker({
  tripId,
  day,
  note,
}: {
  tripId: string
  day: string
  note: DayNote | undefined
}) {
  const save = useSetDayNote(tripId)
  const clear = useClearDayNote(tripId)
  const current = note?.theme ?? null

  function choose(theme: Theme) {
    const wanted = current === theme ? null : theme
    const words = note?.note ?? ''

    // Taking the theme off a day that says nothing else leaves a row with
    // nothing in it, which the server refuses — and rightly: a blank row
    // renders as a mysterious gap in the day, and clearing is a DELETE.
    if (wanted === null && !words.trim()) {
      clear.mutate(day)
      return
    }

    // Otherwise the note goes with it: the server holds one row per day,
    // so sending the theme alone would wipe a sentence written earlier.
    save.mutate({ day, note: words, theme: wanted })
  }

  return (
    <div className="themes" role="group" aria-label={t('theme.legend')}>
      {DAY_THEMES.map((theme) => (
        <button
          key={theme}
          className={`chip ${current === theme ? 'chip--on' : ''}`}
          aria-pressed={current === theme}
          onClick={() => choose(theme)}
          disabled={save.isPending || clear.isPending}
        >
          {dayThemeLabel(theme)}
        </button>
      ))}
    </div>
  )
}
