import { Link } from 'react-router'

import type { TripBundle } from '../api/types'
import { t } from '../i18n'
import { Icon } from './Icon'

/**
 * What to do first, on a trip that has nothing on it yet.
 *
 * Asked directly: "suppose the user has nothing to import from Maps —
 * what happens then?" What happened was a screen reading "no bookings"
 * and a button to add one, while everything that actually starts a trip
 * sat behind a tab called More.
 *
 * The order is not arbitrary and is not a preference. A stop with a
 * position is what the weather, the suggestions, the map and the planner
 * all measure from, so it genuinely has to come first; there is nothing
 * to organise until there are places; and organising is the last step
 * because it consumes the other two.
 *
 * It disappears when all three are done, like every other banner in this
 * app: it is derived from the trip, not from a record of having been
 * seen.
 */
/**
 * Whether the trip is still being set up.
 *
 * Exported because the itinerary needs the same answer: while these steps
 * are on screen, "no bookings yet — add one" is the wrong next action and
 * contradicts the list right above it.
 */
export function startingOut(bundle: TripBundle): boolean {
  // Two conditions, not three. "Has collected places" was in here as
  // well, and sabotaging it changed nothing — because a place with a day
  // is a place, so the third clause already implied it. A condition that
  // cannot change the answer is a condition a reader has to work out is
  // dead.
  return !(
    bundle.stops.some((stop) => stop.lat !== null && stop.lon !== null) &&
    bundle.places.some((place) => place.planned_start_at !== null)
  )
}

export function FirstSteps({ bundle, tripId }: { bundle: TripBundle; tripId: string }) {
  const located = bundle.stops.some((stop) => stop.lat !== null && stop.lon !== null)
  const collected = bundle.places.length > 0
  const organised = bundle.places.some((place) => place.planned_start_at !== null)

  if (!startingOut(bundle)) return null

  const steps = [
    {
      done: located,
      to: `/trips/${tripId}/stops`,
      title: t('start.stops'),
      hint: t('start.stopsHint'),
    },
    {
      done: collected,
      to: `/trips/${tripId}/places`,
      title: t('start.places'),
      hint: located ? t('start.placesHint') : t('start.placesLocked'),
    },
    {
      done: organised,
      to: `/trips/${tripId}/plan`,
      title: t('start.plan'),
      hint: collected ? t('start.planHint') : t('start.planLocked'),
    },
  ]

  // The first unfinished one is the only one worth pressing; the rest are
  // there so the shape of the job is visible, not to be started out of
  // order.
  const next = steps.findIndex((step) => !step.done)

  return (
    <section className="stack stack--tight">
      <h2 className="section__title">{t('start.title')}</h2>
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.to} className={`step ${step.done ? 'step--done' : ''}`}>
            <span className="step__mark" aria-hidden="true">
              {step.done ? <Icon name="check" size={14} /> : index + 1}
            </span>
            {index === next ? (
              <Link className="step__body" to={step.to}>
                <span className="step__title">{step.title}</span>
                <span className="step__hint">{step.hint}</span>
              </Link>
            ) : (
              <span className="step__body">
                <span className="step__title">{step.title}</span>
                <span className="step__hint">{step.hint}</span>
              </span>
            )}
            {index === next && <Icon name="forward" size={18} />}
          </li>
        ))}
      </ol>
    </section>
  )
}
