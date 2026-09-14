import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import type { DayTheme } from '../api/types'

import { useDiscover, useSchedulePlaces, useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { ModelDay } from '../components/ModelDay'
import { PlaceCard } from '../components/PlaceCard'
import { count, t } from '../i18n'
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
  const navigate = useNavigate()
  const bundle = useTripBundle(tripId)
  const apply = useSchedulePlaces(tripId ?? '')

  const discover = useDiscover()

  const [plan, setPlan] = useState<TripPlan | null>(null)
  /** Places this app went and found, shown but not saved until you apply. */
  const [proposed, setProposed] = useState<Proposed[]>([])
  /** Cities whose days are empty and that cannot be looked around. */
  const [blind, setBlind] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  /**
   * What the model made of each place, kept per kind of day.
   *
   * Per theme and not one map for the trip: the model is asked about a
   * kind of day, so its answer about a day of shopping says nothing
   * about the museums day — and using it there was what this did.
   */
  const [prefer, setPrefer] = useState<ReadonlyMap<DayTheme, ReadonlyMap<string, number>>>(
    new Map(),
  )
  /** The cities being asked about, so the wait has a name on it. */
  const [looking, setLooking] = useState<string[]>([])
  /** Cities we asked about and got nothing back for. */
  const [emptyHanded, setEmptyHanded] = useState<string[]>([])
  const [failed, setFailed] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const data = bundle.data

  /**
   * Every kind of day this trip has, once each, with a city to name.
   *
   * One question per kind, not one for the trip: a shopping day and a
   * museums day are two different questions, and asking only the first
   * was giving the second an answer to something it had not asked.
   */
  const themesAsked = [
    ...new Map(
      data.day_notes
        .filter((note) => note.theme)
        .map((note) => [
          note.theme!,
          {
            theme: note.theme!,
            city:
              data.stops.find(
                (stop) =>
                  stop.arrive_date &&
                  stop.arrive_date <= note.day &&
                  (stop.depart_date ?? stop.arrive_date) >= note.day,
              )?.name ?? null,
          },
        ]),
    ).values(),
  ]
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
    setProposed([])
    setEmptyHanded([])
    setLooking([])
    setWorking(true)
    try {
      // On a button, never in a render: this walks every place and every
      // day and calls the day planner once per day.
      const first = planTrip(data, { prefer })
      const gaps = gapsIn(data, first)
      setBlind(unsearchable(first))

      if (gaps.length === 0) {
        setPlan(first)
        return
      }

      setLooking(gaps.map((gap) => gap.stopName))

      /**
       * All the cities at once, not one after another.
       *
       * They were sequential, which is the worst possible shape against
       * Overpass: it queues consecutive queries from one caller, so the
       * second city waited behind the first and sometimes was refused for
       * being too soon. Measured, a fortnight in two cities could sit on
       * "cerco cosa vedere…" for over a minute. Two or three at once is
       * one city's wait, and is not a load worth apologising for.
       *
       * `allSettled`, because a city Overpass will not answer for must not
       * take the others down with it: what came back is still a better
       * plan than none, and the screen says which cities came back empty.
       */
      const answers = await Promise.allSettled(gaps.map((gap) => discover(gap.centre)))

      const found: Proposed[] = []
      const silent: string[] = []
      gaps.forEach((gap, index) => {
        const answer = answers[index]
        const around = answer.status === 'fulfilled' ? answer.value : []
        if (around.length === 0) {
          silent.push(gap.stopName)
          return
        }
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
      })

      setEmptyHanded(silent)
      setProposed(found)
      setPlan(planTrip(bundleWith(data, found), { prefer }))
    } catch {
      // Looking around needs the network; ordering what you already have
      // does not. Fall back to the plan that can be made offline rather
      // than to nothing.
      const offline = planTrip(data, { prefer })
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
      // In the same request as the times, not in twenty of their own.
      //
      // They were twenty sequential PUTs, and that was wrong twice over:
      // twenty round trips against a service that takes a minute to wake,
      // and — if you closed the app in the middle — some places saved and
      // nothing scheduled. Applying a plan is one act, and the server
      // refuses all of it or keeps all of it.
      const result = await apply.mutateAsync({
        created: proposed.map((item) => ({
          id: item.place.id,
          name: item.place.name,
          category: item.place.category,
          priority: item.place.priority,
          visit_minutes: item.place.visit_minutes,
          stop_id: item.place.stop_id,
          lat: item.place.lat,
          lon: item.place.lon,
          url: item.place.url,
          description: item.place.description,
          image_url: item.place.image_url,
        })),
        scheduled: plan.writes.map((write) => ({
          id: write.placeId,
          planned_start_at: write.startAt,
          planned_tz: write.zone,
        })),
      })
      // Straight to the itinerary, because that is where the answer is.
      //
      // It used to stay here: the preview vanished, a small line appeared
      // saying how many visits had been applied, and you were left on a
      // screen with a button on it. The app had done the whole job and
      // shown you none of it — "quando clicco applica non succede
      // niente" is exactly what that looks like, and it was right.
      setProposed([])
      setPlan(null)
      navigate(`/trips/${tripId}`, { state: { applied: result.scheduled } })
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
    setPlan(planTrip(bundleWith(data, kept), { prefer }))
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
            {failed && (
              <p className="field__error" role="alert">
                {t('trip_plan.lookFailed')}
              </p>
            )}
            {/* Only where the day has been given a character: without one
                there is nothing to ask the model to prefer, and a button
                that does nothing in particular is worse than no button. */}
            {themesAsked.length > 0 && <p className="muted small">{t('model.intro')}</p>}
            {themesAsked.map((asked) => (
              <ModelDay
                key={asked.theme}
                places={data.places}
                theme={asked.theme}
                city={asked.city}
                onScores={(scores) =>
                  setPrefer((before) => new Map(before).set(asked.theme, scores))
                }
              />
            ))}

            <button className="button" onClick={() => void compute()} disabled={working}>
              {working ? t('trip_plan.looking') : t('trip_plan.compute')}
            </button>
            {/* Named, and honest about the wait. Overpass is a free service
                run on donations and can take the better part of half a
                minute; a button that says nothing for that long reads as
                broken rather than busy. */}
            {looking.length > 0 && (
              <p className="hint">
                {t('trip_plan.lookingIn', { cities: looking.join(', ') })}
              </p>
            )}
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
                        <PlaceCard
                          name={item.place.name}
                          category={item.place.category}
                          description={item.description}
                          image={item.image}
                          fame={item.fame}
                          extra={item.stopName}
                        />
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

            {emptyHanded.length > 0 && (
              <p className="hint">
                {t('trip_plan.foundNothing', { cities: emptyHanded.join(', ') })}
              </p>
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
