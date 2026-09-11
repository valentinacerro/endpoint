import { useState } from 'react'
import { useParams } from 'react-router'

import { useSchedulePlaces, useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { count, t } from '../i18n'
import { formatDayKey, formatDuration, formatTimeInZone } from '../lib/datetime'
import { planTrip, type TripPlan, type Unplaced } from '../lib/planTrip'

/**
 * Organise the whole trip at once.
 *
 * A preview, always. An optimiser that silently rewrites an evening's
 * work is not a feature — and this one is a heuristic over travel times
 * that are themselves estimates, so the last word stays with you.
 *
 * What it could NOT do is shown above what it could, because that is the
 * part you have to act on: a place with no position, a city with no
 * dates, a museum shut all week.
 */
export function PlanTrip() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const apply = useSchedulePlaces(tripId ?? '')

  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const data = bundle.data
  const names = new Map(data.places.map((place) => [place.id, place.name]))
  const stopNames = new Map(data.stops.map((stop) => [stop.id, stop.name]))

  function compute() {
    setFailed(false)
    setDone(null)
    // On a button, never in a render: this walks every place and every
    // day and calls the day planner once per day.
    setPlan(planTrip(data))
  }

  async function applyPlan() {
    if (!plan) return
    setFailed(false)
    try {
      const result = await apply.mutateAsync({
        scheduled: plan.writes.map((write) => ({
          id: write.placeId,
          planned_start_at: write.startAt,
          planned_tz: write.zone,
        })),
      })
      setDone(result.scheduled)
      setPlan(null)
    } catch {
      // Place writes are not queueable, so this is a real failure and the
      // preview stays on screen to be retried.
      setFailed(true)
    }
  }

  function describe(item: Unplaced): string {
    const where = item.stopId ? (stopNames.get(item.stopId) ?? '') : ''
    switch (item.reason) {
      case 'day_trip':
        return t('trip_plan.reason.day_trip', {
          stop: where,
          km: item.km ?? 0,
        })
      case 'far_from_every_stop':
        return t('trip_plan.reason.far', { stop: where, km: item.km ?? 0 })
      case 'closed_on_every_day':
        return t('trip_plan.reason.closed', {
          days: item.daysTried.map((day) => formatDayKey(day)).join(', '),
        })
      case 'no_room':
        return t('trip_plan.reason.no_room', {
          days: item.daysTried.map((day) => formatDayKey(day)).join(', '),
        })
      case 'stop_has_no_days':
        return t('trip_plan.reason.no_days', { stop: where })
      case 'no_located_stop':
        return t('trip_plan.reason.no_located_stop')
      default:
        return t('trip_plan.reason.no_position')
    }
  }

  return (
    <>
      <AppBar
        title={t('trip_plan.title')}
        subtitle={data.trip.title}
        back={`/trips/${tripId}`}
      />
      <main className="page stack">
        {plan === null ? (
          <>
            <p className="muted small">{t('trip_plan.intro')}</p>
            {done !== null && <p className="hint">{count('trip_plan.applied', done)}</p>}
            <button className="button" onClick={compute}>
              {t('trip_plan.compute')}
            </button>
          </>
        ) : (
          <>
            <p className="muted small">
              {count('trip_plan.summary', plan.writes.length, {
                days: plan.days.filter((day) => (day.plan?.visits.length ?? 0) > 0).length,
              })}
            </p>

            {plan.kept.length > 0 && (
              <p className="muted small">{count('trip_plan.kept', plan.kept.length)}</p>
            )}

            {plan.unplaced.length > 0 && (
              <section className="stack stack--tight">
                <h2 className="section__title">
                  {count('trip_plan.notPlaced', plan.unplaced.length)}
                </h2>
                <ul className="docs">
                  {plan.unplaced.map((item) => (
                    <li key={item.placeId} className="doc">
                      <span className="doc__open" style={{ cursor: 'default' }}>
                        <span className="doc__name">{names.get(item.placeId)}</span>
                        <span className="doc__meta">{describe(item)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plan.assumptions.length > 0 && (
              <p className="hint">
                {plan.assumptions
                  .map((assumption) =>
                    t(
                      assumption.what === 'arrival_assumed'
                        ? 'trip_plan.assumedArrival'
                        : 'trip_plan.assumedDeparture',
                      { day: formatDayKey(assumption.day) },
                    ),
                  )
                  .join(' ')}
              </p>
            )}

            <section className="stack stack--tight">
              <h2 className="section__title">{t('trip_plan.preview')}</h2>
              {plan.days.map((day) => (
                <div key={day.key} className="day">
                  <h3 className="day__header">
                    <span className="day__number">{formatDayKey(day.key)}</span>
                    {day.stop && <span className="day__count">{day.stop.name}</span>}
                  </h3>
                  {day.refused ? (
                    <p className="muted small">{t(`trip_plan.day.${day.refused}`)}</p>
                  ) : (day.plan?.visits.length ?? 0) === 0 ? (
                    <p className="muted small">{t('trip_plan.day.empty')}</p>
                  ) : (
                    <ol className="plan">
                      {day.plan?.visits.map((visit) => (
                        <li key={visit.id} className="plan__row">
                          <span className="plan__time">
                            {formatTimeInZone(visit.startAt, day.zone)}
                          </span>
                          <span className="plan__name">
                            {names.get(visit.id)}
                            {visit.hoursUnknown && <span className="plan__flag">?</span>}
                          </span>
                          {visit.travelMinutesBefore > 0 && (
                            <span className="plan__travel">
                              +{formatDuration(visit.travelMinutesBefore)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </section>

            <p className="muted small">
              {t('trip_plan.travel', {
                duration: formatDuration(plan.travelMinutes),
              })}
            </p>
            {plan.hoursUnknown > 0 && (
              <p className="muted small">
                {count('trip_plan.hoursUnknown', plan.hoursUnknown, {
                  total: plan.writes.length,
                })}
              </p>
            )}
            <p className="muted small">{t('plan.estimates')}</p>

            {failed && (
              <p className="field__error" role="alert">
                {t('plan.needsNetwork')}
              </p>
            )}

            <div className="row row--end">
              <button className="button button--quiet" onClick={() => setPlan(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="button"
                disabled={apply.isPending || plan.writes.length === 0}
                onClick={() => void applyPlan()}
              >
                {apply.isPending ? t('common.saving') : t('trip_plan.apply')}
              </button>
            </div>
          </>
        )}
      </main>
    </>
  )
}
