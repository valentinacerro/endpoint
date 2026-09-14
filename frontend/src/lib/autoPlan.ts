/**
 * What the planner would need in order to have anything to plan.
 *
 * The app could already do all three halves of this job and joined none
 * of them: find places, order places, fill a day. A trip with four places
 * and a fortnight of days produced a plan with four visits in it and a
 * list of refusals, and the thing that would actually have helped —
 * "there is nothing here, shall I look?" — was a separate button on a
 * separate screen, per city, which you had to know to press.
 *
 * This is the join. It reads a plan that has already been computed and
 * says which cities came out short and by how much, so the planner can go
 * and look before showing you an empty fortnight.
 *
 * The test for "short" is not a number anybody invented: it is a day in a
 * city you are staying in with nothing on it at all. The plan's own
 * output says which those are.
 */

import type { Stop, TripBundle } from '../api/types'

import type { CalendarDate } from './datetime'
import type { TripPlan } from './planTrip'
import { stopCentres } from './stops'

/**
 * How many places to go looking for, per day that came out empty.
 *
 * Measured, on a week in Tokyo with sixty candidates scattered over the
 * twelve kilometres of the centre: the planner fits nine sixty-minute
 * visits into a day, six at ninety minutes, five at two hours. Nine is
 * what the clock allows and not what a person walks, so this asks for
 * four — a full day with room to drop one — and lets the planner leave
 * over what does not fit rather than marching you through it.
 */
const PER_EMPTY_DAY = 4

export interface Gap {
  stopId: string
  stopName: string
  /** Where to look. A stop with no position cannot be looked around. */
  centre: { lat: number; lon: number }
  /** Days spent here that the plan left with nothing on them. */
  emptyDays: CalendarDate[]
  /** Roughly how many places it would take to fill them. */
  wanted: number
}

/**
 * The cities whose days came out empty, and how much each needs.
 *
 * Three states, not two, and the middle one is the whole reason this
 * exists. A day can be **refused** — no dates, arrival unknown, already
 * past — which is a problem only you can fix, and quietly proposing
 * museums for it would bury it. It can be **planned and full**. Or it can
 * come back with `plan` and `refused` both null, which is what the
 * planner returns when it had nothing whatever to work with: the case of
 * a trip that has cities and no places, and the one a person actually
 * hits on their first evening.
 */
export function gapsIn(bundle: TripBundle, plan: TripPlan): Gap[] {
  const centres = stopCentres(bundle)
  const byStop = new Map<string, { stop: Stop; emptyDays: CalendarDate[] }>()

  for (const day of plan.days) {
    if (!day.stop) continue
    if (day.refused !== null) continue
    if ((day.plan?.visits.length ?? 0) > 0) continue

    const entry = byStop.get(day.stop.id) ?? { stop: day.stop, emptyDays: [] }
    entry.emptyDays.push(day.key)
    byStop.set(day.stop.id, entry)
  }

  const gaps: Gap[] = []
  for (const [stopId, { stop, emptyDays }] of byStop) {
    const centre = centres.get(stopId)
    // Cannot happen: the planner refuses an unplaceable city's days as
    // `stop_not_located` before they ever get here, and sabotaging this
    // line changed nothing. It stays because the types cannot say so, and
    // because skipping is the right answer if it ever does happen —
    // searching around a city we cannot place would search the Atlantic.
    if (!centre) continue
    gaps.push({
      stopId,
      stopName: stop.name,
      centre: { lat: centre.lat, lon: centre.lon },
      emptyDays,
      wanted: emptyDays.length * PER_EMPTY_DAY,
    })
  }

  // Biggest hole first: if the search only manages one city, it should be
  // the one with the most empty days in it.
  return gaps.sort((a, b) => b.emptyDays.length - a.emptyDays.length)
}

/**
 * Cities that cannot be searched at all, because nothing places them.
 *
 * Read off the planner's own refusal rather than worked out again here.
 * It already asks the question and answers it by name, and two pieces of
 * code deciding separately what "located" means is how they come to
 * disagree.
 */
export function unsearchable(plan: TripPlan): string[] {
  const names = new Set<string>()
  for (const day of plan.days) {
    if (day.stop && day.refused === 'stop_not_located') names.add(day.stop.name)
  }
  return [...names]
}
