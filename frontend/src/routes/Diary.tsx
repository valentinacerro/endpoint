import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { useDeleteDiaryEntry, usePutDiaryEntry, useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { count, t } from '../i18n'
import { formatDayKey } from '../lib/datetime'
import { diaryDays, firstUnwritten, written, type DiaryDay } from '../lib/diary'

/**
 * What you want to remember about each day.
 *
 * Writing happens at the end of a day, in a hotel room, on whatever the
 * wifi is doing — so every write here goes through the offline queue, and
 * the text appears the moment you save it rather than when the server
 * agrees.
 */
export function Diary() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const [editing, setEditing] = useState<string | null>(null)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const days = diaryDays(bundle.data)
  const progress = written(days)
  const next = firstUnwritten(days)

  return (
    <>
      <AppBar
        title={t('diary.title')}
        subtitle={bundle.data.trip.title}
        back={`/trips/${tripId}`}
      />
      <main className="page stack">
        {progress.writable > 0 && (
          <section className="card stack stack--tight">
            <div className="totals">
              <div>
                <span className="detail__label">{t('diary.title')}</span>
                <span className="totals__big">
                  {count('diary.progress', progress.written, {
                    writable: progress.writable,
                  })}
                </span>
              </div>
            </div>
            <div
              className="meter"
              role="progressbar"
              aria-valuenow={Math.round((progress.written / progress.writable) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className="meter__fill"
                style={{ width: `${(progress.written / progress.writable) * 100}%` }}
              />
            </div>
            {progress.written === progress.writable ? (
              <p className="muted small">{t('diary.allWritten')}</p>
            ) : (
              next && (
                <button className="button button--quiet" onClick={() => setEditing(next)}>
                  {t('diary.jump')}
                </button>
              )
            )}
          </section>
        )}

        <p className="muted small">{t('diary.intro')}</p>

        {days.map((day) => (
          <DayBlock
            key={day.key}
            tripId={tripId}
            day={day}
            editing={editing === day.key}
            onEdit={() => setEditing(day.key)}
            onDone={() => setEditing(null)}
          />
        ))}
      </main>
    </>
  )
}

function DayBlock({
  tripId,
  day,
  editing,
  onEdit,
  onDone,
}: {
  tripId: string
  day: DiaryDay
  editing: boolean
  onEdit: () => void
  onDone: () => void
}) {
  const save = usePutDiaryEntry(tripId)
  const remove = useDeleteDiaryEntry(tripId)
  const [text, setText] = useState(day.entry?.text ?? '')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    save.mutate({ day: day.key, text: trimmed }, { onSuccess: onDone })
  }

  return (
    <section className="entry">
      <h2 className="entry__head">
        <span className="entry__day">{formatDayKey(day.key)}</span>
        {day.stopName && <span className="entry__stop">{day.stopName}</span>}
      </h2>

      <p className="entry__happened">
        {day.happened.length === 0
          ? t('diary.nothingPlanned')
          : t('diary.happened', {
              what:
                day.more > 0
                  ? count('diary.happenedMore', day.more, {
                      what: day.happened.join(', '),
                    })
                  : day.happened.join(', '),
            })}
      </p>

      {editing ? (
        <form className="stack stack--tight" onSubmit={onSubmit}>
          <textarea
            className="field__input entry__input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('diary.placeholder')}
            maxLength={20000}
            rows={8}
            autoFocus
          />
          {save.error && (
            <p className="field__error" role="alert">
              {save.error.message || t('common.error')}
            </p>
          )}
          <div className="row row--end">
            {day.entry && (
              <button
                type="button"
                className="chip chip--danger"
                onClick={() =>
                  confirm(t('diary.confirmDelete', { day: formatDayKey(day.key) })) &&
                  remove.mutate(day.key, { onSuccess: onDone })
                }
              >
                {t('common.delete')}
              </button>
            )}
            <button type="button" className="button button--quiet" onClick={onDone}>
              {t('common.cancel')}
            </button>
            <button className="button" type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {day.entry ? (
            <p className="entry__text">{day.entry.text}</p>
          ) : (
            <p className="entry__blank">
              {day.isPast ? t('diary.nothingWritten') : t('diary.notYet')}
            </p>
          )}
          {day.isPast && (
            <button className="button button--small button--quiet" onClick={onEdit}>
              {day.entry ? t('diary.edit') : t('diary.write')}
            </button>
          )}
        </>
      )}
    </section>
  )
}
