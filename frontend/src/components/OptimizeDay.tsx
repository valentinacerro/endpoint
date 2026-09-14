import { useState } from 'react'

import { useSchedulePlaces } from '../api/trips'
import type { TripBundle } from '../api/types'
import { count, t } from '../i18n'
import { formatDuration, formatTimeInZone } from '../lib/datetime'
import type { Day } from '../lib/itinerary'
import { planTrip, type TripPlan } from '../lib/planTrip'
import { knownLegs, legKey } from '../lib/geo'
import { CorrectLeg } from './CorrectLeg'

interface Props {
  bundle: TripBundle
  day: Day
  tripId: string
}

/**
 * Rearrange one day.
 *
 * It used to have an algorithm of its own, and a rule that counted a
 * place as a candidate only if you had assigned it to this day's city by
 * hand. Nothing in the app has ever done that automatically, so the pile
 * of places you actually collect was invisible to it.
 *
 * It now asks the trip planner for one day. That is not merely tidier:
 * teaching the old rule about inferred cities would have handed the
 * whole of Tokyo to whichever day you happened to tap first. Going
 * through the planner means this day gets its neighbourhood's share,
 * worked out exactly as in a whole-trip run.
 *
 * Always a preview. An optimiser that silently rewrites an evening's
 * work is not a feature, and the estimates underneath it are
 * approximate enough that the last word has to stay with you.
 */
export function OptimizeDay({ bundle, day, tripId }: Props) {
  const apply = useSchedulePlaces(tripId)
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [applying, setApplying] = useState(false)
  const [failed, setFailed] = useState(false)

  const zone = day.stop?.tz ?? bundle.trip.primary_tz
  const names = new Map(bundle.places.map((place) => [place.id, place.name]))
  const known = knownLegs(bundle.travel_times)

  function compute() {
    setFailed(false)
    // `replan: 'day'` returns this day's own visits to the pool, which is
    // what this button has always done. Elsewhere they stay put.
    setPlan(planTrip(bundle, { onlyDays: [day.key], replan: 'day' }))
  }

  const today = plan?.days[0] ?? null
  const visits = today?.plan?.visits ?? []

  async function applyPlan() {
    if (!plan) return
    setApplying(true)
    setFailed(false)
    try {
      await apply.mutateAsync({
        scheduled: plan.writes.map((write) => ({
          id: write.placeId,
          planned_start_at: write.startAt,
          planned_tz: write.zone,
        })),
        // Anything that no longer fits goes back to the wish list rather
        // than staying on a day it cannot happen on.
        cleared: plan.unplaced
          .filter(
            (item) =>
              bundle.places.find((place) => place.id === item.placeId)?.planned_start_at,
          )
          .map((item) => item.placeId),
      })
      setPlan(null)
    } catch {
      // Writes to places are not queueable, so this is a real failure and
      // the preview stays put to be retried.
      setFailed(true)
    } finally {
      setApplying(false)
    }
  }

  if (!plan) {
    // A chip in the day's heading rather than a button under it. Still
    // never hidden — a feature that disappears when it cannot run is
    // indistinguishable from one that was never built — but a full-width
    // button repeated once per day was fourteen of them down a fortnight,
    // which is its own kind of hidden.
    return (
      <button className="chip day__optimise" onClick={compute}>
        {t('plan.optimise')}
      </button>
    )
  }

  const refusedDay = today?.refused ?? null
  /** Refused for a reason that belongs to this day, not to the place. */
  const blocked = plan.unplaced.filter((item) => item.reason !== 'no_room')

  return (
    <div className="card stack stack--tight">
      <p className="detail__label">{t('plan.preview')}</p>

      {refusedDay && <p className="hint">{t(`trip_plan.day.${refusedDay}`)}</p>}

      {!refusedDay && visits.length === 0 && (
        <p className="muted small">{t('trip_plan.day.empty')}</p>
      )}

      {visits.length > 0 && (
        <ol className="plan">
          {visits.map((visit) => (
            <li key={visit.id} className="plan__row">
              <span className="plan__time">{formatTimeInZone(visit.startAt, zone)}</span>
              <span className="plan__name">
                {names.get(visit.id)}
                {visit.hoursUnknown && (
                  <span className="plan__flag" title={t('plan.hoursUnknown')}>
                    ?
                  </span>
                )}
              </span>
              {visit.travelMinutesBefore > 0 && (
                <CorrectLeg
                  tripId={tripId}
                  from={visit.legFrom}
                  to={visit.legTo}
                  minutes={visit.travelMinutesBefore}
                  corrected={known.has(legKey(visit.legFrom!, visit.legTo!))}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      {visits.length > 0 && (
        <p className="muted small">
          {t('plan.travelTotal', { duration: formatDuration(plan.travelMinutes) })}
        </p>
      )}

      {plan.unplaced.length > 0 && (
        <p className="hint">
          {count('plan.notToday', plan.unplaced.length, {
            names: plan.unplaced
              .slice(0, 3)
              .map((item) => names.get(item.placeId))
              .join(', '),
          })}{' '}
          {blocked.length > 0 && t('plan.seeWhy')}
        </p>
      )}

      {plan.hoursUnknown > 0 && <p className="muted small">{t('plan.hoursUnknown')}</p>}

      <p className="muted small">{t('plan.estimates')}</p>

      {failed && (
        <p className="field__error" role="alert">
          {t('plan.needsNetwork')}
        </p>
      )}

      <div className="row row--end">
        <button className="button button--quiet button--small" onClick={() => setPlan(null)}>
          {t('common.cancel')}
        </button>
        <button
          className="button button--small"
          onClick={() => void applyPlan()}
          disabled={applying || plan.writes.length === 0}
        >
          {applying ? t('common.saving') : t('plan.apply')}
        </button>
      </div>
    </div>
  )
}
