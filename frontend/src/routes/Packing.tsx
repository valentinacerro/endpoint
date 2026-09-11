import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { useDeleteChecklistItem, usePutChecklistItem, useTripBundle } from '../api/trips'
import {
  CHECKLIST_CATEGORIES,
  type ChecklistCategory,
  type ChecklistItem,
  type Stop,
  type Trip,
} from '../api/types'
import { AppBar } from '../components/AppBar'
import { Fab } from '../components/Fab'
import { t } from '../i18n'
import { checklistCategoryLabel } from '../i18n/labels'
import { group, nextPosition, progress, suggestions, type Suggestion } from '../lib/packing'
import { Icon } from '../components/Icon'

/**
 * The packing list.
 *
 * Built to be used with one thumb while holding something in the other
 * hand: whole rows are the tap target, and nothing here needs a network.
 */
export function Packing() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const save = usePutChecklistItem(tripId ?? '')
  const remove = useDeleteChecklistItem(tripId ?? '')

  const [adding, setAdding] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const { trip, stops, checklist } = bundle.data
  const done = progress(checklist)
  const groups = group(checklist)

  function toggle(item: ChecklistItem) {
    save.mutate({
      id: item.id,
      text: item.text,
      category: item.category,
      position: item.position,
      is_done: !item.is_done,
    })
  }

  return (
    <>
      <AppBar title={t('packing.title')} subtitle={trip.title} back={`/trips/${tripId}`} />
      <main className="page stack">
        {checklist.length > 0 && (
          <section className="card stack stack--tight">
            <div className="totals">
              <div>
                <span className="detail__label">{t('packing.title')}</span>
                <span className="totals__big">
                  {t('packing.progress', { done: done.done, total: done.total })}
                </span>
              </div>
            </div>
            <div
              className="meter"
              role="progressbar"
              aria-valuenow={Math.round(done.fraction * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className="meter__fill" style={{ width: `${done.fraction * 100}%` }} />
            </div>
            {done.done === done.total && <p className="muted small">{t('packing.allDone')}</p>}
          </section>
        )}

        {adding && (
          <AddItem
            tripId={tripId}
            position={nextPosition(checklist)}
            onDone={() => setAdding(false)}
          />
        )}

        {checklist.length === 0 && !adding && !showSuggestions && (
          <div className="stack stack--tight">
            <p className="empty">{t('packing.none')}</p>
            <button className="button" onClick={() => setShowSuggestions(true)}>
              {t('packing.suggestOpen')}
            </button>
          </div>
        )}

        {showSuggestions && (
          <Suggestions
            tripId={tripId}
            trip={trip}
            stops={stops}
            checklist={checklist}
            onClose={() => setShowSuggestions(false)}
          />
        )}

        {groups.map((section) => (
          <section key={section.category} className="day">
            <h2 className="day__header">
              <span className="day__number">{checklistCategoryLabel(section.category)}</span>
              <span className="day__count">
                {t('packing.progress', { done: section.done, total: section.items.length })}
              </span>
            </h2>
            <ul className="pack">
              {section.items.map((item) => (
                <li key={item.id} className="pack__item">
                  <button
                    className="pack__tick"
                    onClick={() => toggle(item)}
                    aria-pressed={item.is_done}
                  >
                    <span className={`pack__box ${item.is_done ? 'pack__box--on' : ''}`}>
                      {item.is_done && <Icon name="check" size={14} />}
                    </span>
                    <span className={`pack__text ${item.is_done ? 'pack__text--on' : ''}`}>
                      {item.text}
                    </span>
                  </button>
                  <button
                    className="chip chip--danger"
                    onClick={() => remove.mutate(item.id)}
                    aria-label={t('common.delete')}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {checklist.length > 0 && (
          <div className="stack stack--tight">
            {!showSuggestions && (
              <button className="button button--quiet" onClick={() => setShowSuggestions(true)}>
                {t('packing.suggestOpen')}
              </button>
            )}
            <p className="muted small">{t('packing.offlineNote')}</p>
          </div>
        )}
      </main>
      {!adding && <Fab onClick={() => setAdding(true)} label={t('packing.add')} />}
    </>
  )
}

function AddItem({
  tripId,
  position,
  onDone,
}: {
  tripId: string
  position: number
  onDone: () => void
}) {
  const save = usePutChecklistItem(tripId)
  const [text, setText] = useState('')
  const [category, setCategory] = useState<ChecklistCategory>('other')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    save.mutate(
      // Minted here, like an expense: a replayed write must leave one line.
      { id: crypto.randomUUID(), text: text.trim(), category, position, is_done: false },
      { onSuccess: onDone },
    )
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">{t('packing.field.text')}</span>
        <input
          className="field__input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={200}
          autoFocus
          required
        />
      </label>
      <label className="field">
        <span className="field__label">{t('packing.field.category')}</span>
        <select
          className="field__input"
          value={category}
          onChange={(event) => setCategory(event.target.value as ChecklistCategory)}
        >
          {CHECKLIST_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {checklistCategoryLabel(option)}
            </option>
          ))}
        </select>
      </label>

      {save.error && (
        <p className="field__error" role="alert">
          {save.error.message || t('common.error')}
        </p>
      )}

      <div className="row row--end">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

/**
 * The starter list.
 *
 * Suggestions, not a list imposed on you: each one is added only when
 * tapped, and becomes an ordinary line you can rename or delete. What is
 * already on the list is not offered again.
 */
function Suggestions({
  tripId,
  trip,
  stops,
  checklist,
  onClose,
}: {
  tripId: string
  trip: Trip
  stops: readonly Stop[]
  checklist: readonly ChecklistItem[]
  onClose: () => void
}) {
  const save = usePutChecklistItem(tripId)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)

  const offered = suggestions(
    {
      startDate: trip.start_date,
      endDate: trip.end_date,
      currency: trip.primary_currency,
      countryCodes: stops
        .map((stop) => stop.country_code)
        .filter((code): code is string => Boolean(code)),
    },
    checklist,
  )

  function add(suggestion: Suggestion, position: number) {
    return save.mutateAsync({
      id: crypto.randomUUID(),
      text: suggestion.text,
      category: suggestion.category,
      position,
      is_done: false,
    })
  }

  async function addAll() {
    setBusy({ done: 0, total: offered.length })
    let position = nextPosition(checklist)
    for (const [index, suggestion] of offered.entries()) {
      try {
        await add(suggestion, position)
        position += 1
      } catch {
        // One rejected line should not stop the other twenty.
      }
      setBusy({ done: index + 1, total: offered.length })
    }
    setBusy(null)
    onClose()
  }

  return (
    <section className="card stack stack--tight">
      <div className="row">
        <strong className="field__label">{t('packing.suggestTitle')}</strong>
      </div>

      {offered.length === 0 ? (
        <p className="muted small">{t('packing.suggestNone')}</p>
      ) : (
        <>
          <p className="muted small">{t('packing.suggestHint')}</p>
          <ul className="chips">
            {offered.map((suggestion) => (
              <li key={`${suggestion.category}:${suggestion.text}`}>
                <button
                  className="chip"
                  disabled={busy !== null}
                  onClick={() => void add(suggestion, nextPosition(checklist))}
                >
                  + {suggestion.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="row row--end">
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t('common.close')}
        </button>
        {offered.length > 0 && (
          <button className="button" disabled={busy !== null} onClick={() => void addAll()}>
            {busy
              ? t('packing.suggestAdding', { done: busy.done, total: busy.total })
              : t('packing.suggestAddAll', { count: offered.length })}
          </button>
        )}
      </div>
    </section>
  )
}
