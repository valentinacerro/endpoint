import { useState } from 'react'
import { useParams } from 'react-router'

import { useCreatePlace, useDiscover, useSchedulePlaces, useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { count, t } from '../i18n'
import { placeCategoryLabel } from '../i18n/labels'
import { formatDayKey, formatDuration, formatTimeInZone } from '../lib/datetime'
import { gapsIn, unsearchable } from '../lib/autoPlan'
import { bundleWith, proposeFor, type Proposed } from '../lib/fillGaps'
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

  const discover = useDiscover()
  const addPlace = useCreatePlace(tripId ?? '')

  const [plan, setPlan] = useState<TripPlan | null>(null)
  /** Places this app went and found, shown but not saved until you apply. */
  const [proposed, setProposed] = useState<Proposed[]>([])
  /** Cities whose days are empty and that cannot be looked around. */
  const [blind, setBlind] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const data = bundle.data
  const names = new Map(data.places.map((place) => [place.id, place.name]))
  const stopNames = new Map(data.stops.map((stop) => [stop.id, stop.name]))

  /**
   * Organise the trip, finding things to organise if there are none.
   *
   * One button, because there was never a reason for two. The app could
   * already order places and already find places, and left you to work
   * out which of those you needed and on which of three screens — so a
   * trip with four places and a fortnight of days produced a plan with
   * four visits in it and a list of complaints.
   *
   * It plans first and asks the plan what it lacked. A day in a city you
   * are sleeping in with nothing on it is the only definition of "not
   * enough" that nobody had to invent, and it is the plan's own answer.
   * Then it looks around those cities, adds what it finds to a copy of
   * the trip, and plans again. Nothing is saved either way until you
   * press apply.
   */
  async function compute() {
    setFailed(false)
    setDone(null)
    setProposed([])
    setWorking(true)
    try {
      // On a button, never in a render: this walks every place and every
      // day and calls the day planner once per day.
      const first = planTrip(data)
      const gaps = gapsIn(data, first)
      setBlind(unsearchable(first))

      if (gaps.length === 0) {
        setPlan(first)
        return
      }

      const found: Proposed[] = []
      for (const gap of gaps) {
        // One city at a time. Each is an Overpass query against a service
        // run on donations, and a fortnight is at most a handful of them.
        const around = await discover(gap.centre)
        found.push(
          ...proposeFor(
            tripId!,
            gap,
            around,
            // What is already saved *and* what has been proposed for an
            // earlier city, so two neighbouring cities cannot both offer
            // the same place between them.
            [...data.places, ...found.map((item) => item.place)],
            new Set(),
            () => crypto.randomUUID(),
          ),
        )
      }

      setProposed(found)
      setPlan(planTrip(bundleWith(data, found)))
    } catch {
      // Looking around needs the network; ordering what you already have
      // does not. Fall back to the plan that can be made offline rather
      // than to nothing.
      const offline = planTrip(data)
      setPlan(offline)
      setBlind(unsearchable(offline))
      setFailed(true)
    } finally {
      setWorking(false)
    }
  }

  async function applyPlan() {
    if (!plan) return
    setFailed(false)
    try {
      // The places it proposed have to exist before they can be given a
      // time. Each is a PUT at an id chosen when it was proposed, so this
      // is queueable and safe to replay like every other write.
      for (const item of proposed) {
        await addPlace.mutateAsync({
          id: item.place.id,
          name: item.place.name,
          category: item.place.category,
          priority: item.place.priority,
          visit_minutes: item.place.visit_minutes,
          stop_id: item.place.stop_id,
          lat: item.place.lat,
          lon: item.place.lon,
          url: item.place.url,
        })
      }

      const result = await apply.mutateAsync({
        scheduled: plan.writes.map((write) => ({
          id: write.placeId,
          planned_start_at: write.startAt,
          planned_tz: write.zone,
        })),
      })
      setDone(result.scheduled)
      setPlan(null)
      setProposed([])
    } catch {
      // A plan made with no network is queued rather than lost, so
      // reaching here means the server refused it on its merits. The
      // preview stays on screen to be retried.
      setFailed(true)
    }
  }

  /**
   * Take one of the proposals out, and plan again without it.
   *
   * Re-planned rather than merely hidden: dropping a place changes what
   * fits where, and a list that still shows the old order would be a
   * picture of a plan that is no longer the one you would apply.
   */
  function drop(placeId: string) {
    const kept = proposed.filter((item) => item.place.id !== placeId)
    setProposed(kept)
    setPlan(planTrip(bundleWith(data, kept)))
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
            {failed && (
              <p className="field__error" role="alert">
                {t('trip_plan.lookFailed')}
              </p>
            )}
            <button className="button" onClick={() => void compute()} disabled={working}>
              {working ? t('trip_plan.looking') : t('trip_plan.compute')}
            </button>
          </>
        ) : (
          <>
            <p className="muted small">
              {count('trip_plan.summary', plan.writes.length, {
                days: plan.days.filter((day) => (day.plan?.visits.length ?? 0) > 0).length,
              })}
            </p>

            {proposed.length > 0 && (
              <section className="card stack stack--tight">
                <p className="hint">
                  {count('trip_plan.proposed', proposed.length, {
                    cities: [...new Set(proposed.map((item) => item.stopName))].join(', '),
                  })}
                </p>
                <ul className="docs">
                  {proposed.map((item) => (
                    <li key={item.place.id} className="doc">
                      <span className="doc__open" style={{ cursor: 'default' }}>
                        <span className="doc__name">{item.place.name}</span>
                        <span className="doc__meta">
                          {[placeCategoryLabel(item.place.category), item.stopName].join(' · ')}
                        </span>
                      </span>
                      <div className="doc__actions">
                        <button
                          className="chip chip--danger"
                          onClick={() => drop(item.place.id)}
                          aria-label={t('common.delete')}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="muted small">{t('trip_plan.proposedHint')}</p>
              </section>
            )}

            {blind.length > 0 && (
              <p className="hint">{t('trip_plan.blind', { cities: blind.join(', ') })}</p>
            )}

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
              <button
                className="button button--quiet"
                onClick={() => {
                  setPlan(null)
                  setProposed([])
                }}
              >
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
