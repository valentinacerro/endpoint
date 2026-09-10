import { useState } from 'react'
import { useParams } from 'react-router'

import { useTripBundle, useUpdatePlace, useWeather } from '../api/trips'
import type { DayWeather } from '../api/types'
import { AppBar } from '../components/AppBar'
import { t } from '../i18n'
import { skyLabel } from '../i18n/labels'
import { formatCalendarDate, formatDayKey, formatSyncTime } from '../lib/datetime'
import { buildTimeline } from '../lib/itinerary'
import {
  indexForecast,
  rebalance,
  skyOf,
  wetness,
  SKY_ICON,
  type Scheduled,
  type Swap,
} from '../lib/weather'

/**
 * The forecast, and the offer to move things around it.
 *
 * The screen is mostly about what it does *not* know. A forecast reaches a
 * fortnight; a trip being planned is usually further off than that. Saying
 * so plainly is the whole job — an empty list here would be indissociable
 * from a broken screen.
 */
export function Weather() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const forecast = useWeather(tripId)
  const updatePlace = useUpdatePlace(tripId ?? '')

  const [applying, setApplying] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const timeline = buildTimeline(bundle.data)
  const weather = forecast.data
  const byslot = indexForecast(weather?.days ?? [])

  // flatMap rather than filter-then-map: it narrows the entry type on the
  // way through, so the place is known to be there without an assertion.
  const scheduled: Scheduled[] = timeline.days.flatMap((day) =>
    day.entries.flatMap((placed) =>
      placed.entry.type === 'place'
        ? [{ place: placed.entry.place, day: day.key, stopId: day.stop?.id ?? null }]
        : [],
    ),
  )

  const plan = rebalance(scheduled, weather?.days ?? [])

  /**
   * Trade two visits by exchanging the slots they sit in.
   *
   * Exchanging the whole instant rather than only the date keeps each slot
   * at the hour it was chosen for, so the rest of the day still fits
   * around the trains and the check-in.
   */
  async function apply(swap: Swap) {
    setApplying(swap.outdoor.place.id)
    setFailed(false)
    try {
      const first = swap.outdoor.place
      const second = swap.indoor.place
      await updatePlace.mutateAsync({
        id: first.id,
        planned_start_at: second.planned_start_at,
        planned_tz: second.planned_tz,
      })
      await updatePlace.mutateAsync({
        id: second.id,
        planned_start_at: first.planned_start_at,
        planned_tz: first.planned_tz,
      })
    } catch {
      // Writes to places are not queueable, so a failure here is a
      // failure: say so rather than leaving a button that did nothing.
      setFailed(true)
    } finally {
      setApplying(null)
    }
  }

  const nothingReaches = (weather?.days.length ?? 0) === 0

  return (
    <>
      <AppBar
        title={t('weather.title')}
        subtitle={bundle.data.trip.title}
        back={`/trips/${tripId}`}
      />
      <main className="page stack">
        {forecast.isPending && <p className="muted small">{t('common.loading')}</p>}

        {weather && (
          <p className="muted small">
            {forecast.isStale
              ? t('weather.stale', { when: formatSyncTime(Date.parse(weather.fetched_at)) })
              : t('weather.updated', { when: formatSyncTime(Date.parse(weather.fetched_at)) })}
          </p>
        )}

        {weather && nothingReaches && (
          <p className="hint">
            {t('weather.tooFar', { horizon: formatCalendarDate(weather.horizon) })}
          </p>
        )}

        {weather && !nothingReaches && weather.beyond_forecast.length > 0 && (
          <p className="muted small">
            {t('weather.someDaysMissing', { count: weather.beyond_forecast.length })}
          </p>
        )}

        {weather && weather.unlocated_stops.length > 0 && (
          <p className="hint">{t('weather.unlocated', { count: weather.unlocated_stops.length })}</p>
        )}

        {weather && weather.unavailable_stops.length > 0 && (
          <p className="hint">
            {t('weather.unavailable', { count: weather.unavailable_stops.length })}
          </p>
        )}

        {weather && bundle.data.stops.length === 0 && <p className="hint">{t('weather.noStops')}</p>}

        {!nothingReaches && (
          <ul className="forecast">
            {timeline.days.map((day) => {
              const entry = day.stop ? byslot.get(`${day.stop.id}|${day.key}`) : undefined
              return <ForecastRow key={day.key} day={day.key} entry={entry} />
            })}
          </ul>
        )}

        {plan.swaps.length > 0 && (
          <section className="stack stack--tight">
            <h2 className="section__title">{t('weather.rebalance')}</h2>
            {failed && (
              <p className="field__error" role="alert">
                {t('weather.needsNetwork')}
              </p>
            )}
            {plan.swaps.map((swap) => (
              <article key={swap.outdoor.place.id} className="card stack stack--tight">
                <p className="swap__line">
                  {t('weather.swapLine', {
                    outdoor: swap.outdoor.place.name,
                    toDay: formatDayKey(swap.indoor.day),
                    indoor: swap.indoor.place.name,
                    fromDay: formatDayKey(swap.outdoor.day),
                  })}
                </p>
                <p className="muted small">{t('weather.swapRain', { mm: swap.rainAvoidedMm })}</p>
                {swap.hoursUnknown && (
                  <p className="muted small">{t('weather.swapHoursUnknown')}</p>
                )}
                <div className="row row--end">
                  <button
                    className="button button--small"
                    disabled={applying !== null}
                    onClick={() => void apply(swap)}
                  >
                    {applying === swap.outdoor.place.id ? t('weather.applying') : t('weather.apply')}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        {!nothingReaches && plan.swaps.length === 0 && plan.stuck.length === 0 && (
          <p className="muted small">{t('weather.noSwaps')}</p>
        )}

        {plan.stuck.length > 0 && (
          <section className="stack stack--tight">
            <h2 className="section__title">{t('weather.stuckTitle')}</h2>
            <ul className="docs">
              {plan.stuck.map((item) => (
                <li key={item.day} className="doc">
                  <span className="doc__open" style={{ cursor: 'default' }}>
                    <span className="doc__name">{formatDayKey(item.day)}</span>
                    <span className="doc__meta">{t(`weather.stuck.${item.reason}`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  )
}

function ForecastRow({ day, entry }: { day: string; entry: DayWeather | undefined }) {
  const isWet = wetness(entry) === 'wet'
  const sky = entry ? skyOf(entry.weather_code) : null

  return (
    <li className={`forecast__row ${isWet ? 'forecast__row--wet' : ''}`}>
      <span className="forecast__day">{formatDayKey(day)}</span>
      <span className="forecast__icon" aria-hidden="true">
        {sky ? SKY_ICON[sky] : '·'}
      </span>
      <span className="forecast__sky">{sky ? skyLabel(sky) : t('weather.dayUnknown')}</span>
      {entry && (
        <>
          <span className="forecast__rain">
            {entry.precipitation_mm > 0 ? t('weather.rain', { mm: entry.precipitation_mm }) : ''}
          </span>
          <span className="forecast__temp">
            {entry.temp_max !== null && entry.temp_min !== null
              ? `${Math.round(entry.temp_min)}° / ${Math.round(entry.temp_max)}°`
              : ''}
          </span>
        </>
      )}
    </li>
  )
}
