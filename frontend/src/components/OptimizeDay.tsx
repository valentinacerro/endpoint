import { useMemo, useState } from 'react'

import { useUpdatePlace } from '../api/trips'
import type { Place, TripBundle } from '../api/types'
import { t } from '../i18n'
import { formatDuration, formatTimeInZone } from '../lib/datetime'
import { planDay, type Anchor, type Candidate, type DayPlan } from '../lib/optimizer'
import type { Day } from '../lib/itinerary'

/** Bookings that occupy a slot; a hotel spans days and is not a stop on a route. */
const SPANS_DAYS = new Set(['hotel', 'car_rental'])

function candidatesFor(bundle: TripBundle, day: Day): Place[] {
  const dayKey = day.key
  const stopId = day.stop?.id ?? null

  return bundle.places.filter((place) => {
    if (place.lat === null || place.lon === null) return false
    if (place.planned_start_at && place.planned_tz) {
      // Already on this day: it gets reordered rather than left alone.
      return place.planned_start_at.slice(0, 10) === dayKey || sameLocalDay(place, dayKey)
    }
    // On the wish list, and belonging to the city this day is spent in.
    return stopId !== null && place.stop_id === stopId
  })
}

function sameLocalDay(place: Place, dayKey: string): boolean {
  if (!place.planned_start_at || !place.planned_tz) return false
  return (
    new Intl.DateTimeFormat('en-CA', {
      timeZone: place.planned_tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(place.planned_start_at)) === dayKey
  )
}

interface Props {
  bundle: TripBundle
  day: Day
  tripId: string
}

/**
 * Rearrange one day.
 *
 * Always a preview first. An optimiser that silently rewrites a plan you
 * spent an evening on is not a feature, and the estimates underneath it are
 * approximate enough that the last word has to stay with you.
 */
export function OptimizeDay({ bundle, day, tripId }: Props) {
  const update = useUpdatePlace(tripId)
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [applying, setApplying] = useState(false)

  const zone = day.stop?.tz ?? bundle.trip.primary_tz
  const places = useMemo(() => candidatesFor(bundle, day), [bundle, day])
  const withCoordinates = useMemo(
    () => bundle.places.filter((place) => place.lat !== null && place.lon !== null),
    [bundle.places],
  )
  /** Have coordinates but no city yet, so no day can claim them. */
  const unassigned = useMemo(
    () => withCoordinates.filter((place) => !place.stop_id && !place.planned_start_at).length,
    [withCoordinates],
  )
  const byId = useMemo(() => new Map(places.map((place) => [place.id, place])), [places])

  function compute() {
    const anchors: Anchor[] = day.entries
      .filter(
        (placed) =>
          placed.entry.type === 'booking' && !SPANS_DAYS.has(placed.entry.booking.kind),
      )
      .map((placed) => {
        const booking = placed.entry.type === 'booking' ? placed.entry.booking : null
        return {
          id: booking!.id,
          startAt: booking!.start_at!,
          endAt: booking!.end_at,
          point:
            typeof booking!.lat === 'number' && typeof booking!.lon === 'number'
              ? { lat: booking!.lat, lon: booking!.lon }
              : null,
          label: booking!.title,
        }
      })

    const candidates: Candidate[] = places.map((place) => ({
      id: place.id,
      point: { lat: place.lat!, lon: place.lon! },
      visitMinutes: place.visit_minutes,
      priority: place.priority,
      openingHours: place.opening_hours as Candidate['openingHours'],
      label: place.name,
    }))

    setPlan(planDay(anchors, candidates, { day: day.key, zone }))
  }

  async function apply() {
    if (!plan) return
    setApplying(true)
    for (const visit of plan.visits) {
      await update.mutateAsync({
        id: visit.id,
        planned_start_at: visit.startAt,
        planned_tz: zone,
      })
    }
    // Anything that no longer fits goes back to the wish list rather than
    // staying on a day it cannot happen on.
    for (const item of plan.dropped) {
      if (byId.get(item.id)?.planned_start_at) {
        await update.mutateAsync({ id: item.id, planned_start_at: null, planned_tz: null })
      }
    }
    setApplying(false)
    setPlan(null)
  }

  if (!plan) {
    // Never hidden. A feature that disappears when it cannot run is
    // indistinguishable from one that was never built, and this one needs
    // coordinates and a stop before it can do anything — so it says which
    // of those is missing rather than vanishing.
    const reason =
      places.length > 0
        ? null
        : day.stop === null
          ? t('plan.needStop')
          : withCoordinates.length === 0
            ? t('plan.needPlaces')
            : t('plan.needAssigned', { stop: day.stop.name })

    return (
      <div className="stack stack--tight">
        <button
          className="button button--quiet button--small"
          onClick={compute}
          disabled={places.length === 0}
        >
          ✨ {t('plan.optimise')}
        </button>
        {reason && <p className="muted small">{reason}</p>}
        {unassigned > 0 && places.length === 0 && (
          <p className="muted small">{t('plan.unassigned', { count: unassigned })}</p>
        )}
      </div>
    )
  }

  return (
    <div className="card stack stack--tight">
      <p className="detail__label">{t('plan.preview')}</p>

      <ol className="plan">
        {plan.visits.map((visit) => (
          <li key={visit.id} className="plan__row">
            <span className="plan__time">{formatTimeInZone(visit.startAt, zone)}</span>
            <span className="plan__name">
              {byId.get(visit.id)?.name}
              {visit.hoursUnknown && (
                <span className="plan__flag" title={t('plan.hoursUnknown')}>
                  ?
                </span>
              )}
            </span>
            {visit.travelMinutesBefore > 0 && (
              <span className="plan__travel">
                +{formatDuration(visit.travelMinutesBefore)}
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="muted small">
        {t('plan.travelTotal', { duration: formatDuration(plan.travelMinutes) })}
      </p>

      {plan.dropped.length > 0 && (
        <p className="hint">
          {t('plan.dropped', {
            names: plan.dropped
              .map(
                (item) =>
                  `${byId.get(item.id)?.name}${item.reason === 'closed' ? ` (${t('plan.closed')})` : ''}`,
              )
              .join(', '),
          })}
        </p>
      )}

      {plan.visits.some((visit) => visit.hoursUnknown) && (
        <p className="muted small">{t('plan.hoursUnknown')}</p>
      )}

      <p className="muted small">{t('plan.estimates')}</p>

      <div className="row row--end">
        <button className="button button--quiet button--small" onClick={() => setPlan(null)}>
          {t('common.cancel')}
        </button>
        <button className="button button--small" onClick={() => void apply()} disabled={applying}>
          {applying ? t('common.saving') : t('plan.apply')}
        </button>
      </div>
    </div>
  )
}
