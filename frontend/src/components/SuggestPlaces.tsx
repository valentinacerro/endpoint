import { useState } from 'react'

import { useCreatePlace, useSuggestions } from '../api/trips'
import type { Place } from '../api/types'
import { count, t } from '../i18n'
import { placeCategoryLabel } from '../i18n/labels'
import { onlyNew } from '../lib/suggest'
import { Icon } from './Icon'

/**
 * Places to see, for a trip that arrived with none.
 *
 * Collecting somewhere to go is the step the whole app depends on and the
 * one nothing helped with: without a list from Google Maps there was
 * nothing to plan, and the planner's answer to an empty trip was an empty
 * trip. This asks OpenStreetMap what is around where you are sleeping and
 * offers it, best known first.
 *
 * Everything is a proposal. Nothing is saved until you tick it and press
 * the button — the ranking is by how much has been written about a place,
 * which is a decent guess at famous and no guess at all about whether you
 * would like it.
 */

/** Ticked when the panel opens: enough to fill a few days, few enough to read. */
const PRESELECTED = 8

export function SuggestPlaces({
  tripId,
  stop,
  places,
  onDone,
}: {
  tripId: string
  /** Where to look: a stop with a position of its own. */
  stop: { id: string; name: string; lat: number; lon: number }
  /** What is already saved, so nothing is offered twice. */
  places: readonly Place[]
  onDone: () => void
}) {
  const found = useSuggestions({ lat: stop.lat, lon: stop.lon })
  const create = useCreatePlace(tripId)

  const [chosen, setChosen] = useState<Set<string> | null>(null)
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)
  const [failed, setFailed] = useState(false)

  const fresh = onlyNew(found.data ?? [], places)
  // Ticked on first sight, then left alone: re-deriving this on every
  // render would undo every tap.
  const ticked = chosen ?? new Set(fresh.slice(0, PRESELECTED).map((item) => item.osm_id))

  function toggle(osmId: string) {
    const next = new Set(ticked)
    if (!next.delete(osmId)) next.add(osmId)
    setChosen(next)
  }

  async function save() {
    const picked = fresh.filter((item) => ticked.has(item.osm_id))
    setFailed(false)
    setSaving({ done: 0, total: picked.length })
    try {
      for (const [index, item] of picked.entries()) {
        await create.mutateAsync({
          name: item.name,
          category: item.category,
          priority: 'normal',
          visit_minutes: 60,
          lat: item.lat,
          lon: item.lon,
          stop_id: stop.id,
        })
        setSaving({ done: index + 1, total: picked.length })
      }
      onDone()
    } catch {
      // Places are not queueable, so this is a real failure. What was
      // already saved stays saved, and the list redraws without it.
      setFailed(true)
    } finally {
      setSaving(null)
    }
  }

  if (found.isPending) {
    return (
      <div className="card stack stack--tight">
        <p className="muted">{t('suggest.looking', { stop: stop.name })}</p>
        <p className="muted small">{t('suggest.slow')}</p>
      </div>
    )
  }

  if (fresh.length === 0) {
    return (
      <div className="card stack stack--tight">
        <p className="muted">{t(found.data ? 'suggest.nothingNew' : 'suggest.nothing')}</p>
        <div className="row row--end">
          <button className="button button--quiet button--small" onClick={onDone}>
            {t('common.close')}
          </button>
        </div>
      </div>
    )
  }

  const picked = fresh.filter((item) => ticked.has(item.osm_id)).length

  return (
    <div className="card stack stack--tight">
      <p className="detail__label">{t('suggest.title', { stop: stop.name })}</p>
      <p className="muted small">{t('suggest.explain')}</p>

      <ul className="pack">
        {fresh.map((item) => {
          const on = ticked.has(item.osm_id)
          return (
            <li key={item.osm_id} className="pack__item">
              <button
                className="pack__tick"
                onClick={() => toggle(item.osm_id)}
                aria-pressed={on}
                disabled={saving !== null}
              >
                <span className={`pack__box ${on ? 'pack__box--on' : ''}`}>
                  {on && <Icon name="check" size={14} />}
                </span>
                <span className="rows__body">
                  <span className="pack__text">{item.name}</span>
                  <span className="rows__hint">
                    {placeCategoryLabel(item.category)}
                    {item.fame > 0 && ` · ${t('suggest.fame', { n: item.fame })}`}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {failed && (
        <p className="field__error" role="alert">
          {t('plan.needsNetwork')}
        </p>
      )}

      <div className="row row--end">
        <button
          className="button button--quiet button--small"
          onClick={onDone}
          disabled={saving !== null}
        >
          {t('common.cancel')}
        </button>
        <button
          className="button button--small"
          onClick={() => void save()}
          disabled={saving !== null || picked === 0}
        >
          {saving
            ? t('suggest.saving', { done: saving.done, total: saving.total })
            : count('suggest.add', picked)}
        </button>
      </div>
    </div>
  )
}
