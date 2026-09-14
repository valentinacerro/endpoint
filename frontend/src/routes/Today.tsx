import { useEffect, useState } from 'react'
import { useIsRestoring } from '@tanstack/react-query'
import { Link } from 'react-router'

import { attachmentUrl, useTripBundle, useTrips, useWeather } from '../api/trips'
import type { TripBundle } from '../api/types'
import { Icon } from '../components/Icon'
import { count, t } from '../i18n'
import { BOOKING_KIND_ICON, skyLabel } from '../i18n/labels'
import { formatMoney } from '../lib/budget'
import {
  formatCalendarDateLong,
  formatDayInZone,
  formatTimeInZone,
} from '../lib/datetime'
import { nextBooking } from '../lib/itinerary'
import { chooseMoment, readiness, refine, spentOn, stopToday, type Moment } from '../lib/today'
import { pinnedUrls } from '../offline/attachmentCache'
import { SKY_ICON, skyOf } from '../lib/weather'

/**
 * What the app opens on.
 *
 * Not the list of trips. A list is a filing cabinet — it is the same on
 * the day you book the flight and the morning you wake up in Kyoto, and
 * it asks you to do the work of remembering which of those two it is.
 * This screen answers that before you touch anything: how long until you
 * go, or which day of it you are on, what is next, what it has cost, and
 * what is still not done.
 *
 * Everything here comes out of what the app already fetches. No endpoint
 * was added for it: the trip list is one request the app makes anyway,
 * and the bundle behind the featured trip is the same one its own screens
 * read — asking for it here means it is already warm when you tap in.
 */

/** The set of attachments already on this phone. One IndexedDB read. */
function useSavedDocuments(bundle: TripBundle | undefined) {
  const [saved, setSaved] = useState<ReadonlySet<string> | null>(null)

  useEffect(() => {
    if (!bundle) return
    let live = true
    void pinnedUrls().then((urls) => {
      if (live) setSaved(urls)
    })
    return () => {
      live = false
    }
  }, [bundle])

  return saved
}

function TripLink({ tripId, label }: { tripId: string; label: string }) {
  return (
    <Link className="button" to={`/trips/${tripId}`}>
      {label}
    </Link>
  )
}

/** The one line that says what happens next, wherever it is. */
function Next({ bundle }: { bundle: TripBundle }) {
  const booking = nextBooking(bundle)
  if (!booking || !booking.start_at || !booking.start_tz) return null

  return (
    <Link className="card next" to={`/trips/${bundle.trip.id}/bookings/${booking.id}`}>
      <span className="next__label">{t('timeline.next')}</span>
      <span className="next__title">
        <Icon name={BOOKING_KIND_ICON[booking.kind]} size={17} /> {booking.title}
      </span>
      <span className="entry__meta">
        {formatDayInZone(booking.start_at, booking.start_tz)} ·{' '}
        {formatTimeInZone(booking.start_at, booking.start_tz)}
      </span>
    </Link>
  )
}

function TodayWeather({ tripId, day }: { tripId: string; day: string }) {
  const weather = useWeather(tripId)
  const entry = weather.data?.days.find((row) => row.day === day)
  if (!entry) return null

  const sky = skyOf(entry.weather_code)
  const temps =
    entry.temp_min !== null && entry.temp_max !== null
      ? `${Math.round(entry.temp_min)}° / ${Math.round(entry.temp_max)}°`
      : null

  return (
    <p className="today__line">
      <Icon name={SKY_ICON[sky]} size={16} />
      {skyLabel(sky)}
      {temps && <span className="muted">{temps}</span>}
      {entry.precipitation_mm > 0 && (
        <span className="muted">{t('weather.rain', { mm: entry.precipitation_mm })}</span>
      )}
    </p>
  )
}

/** The trip that has not started: how long, and what is still open. */
function BeforeTrip({ moment }: { moment: Extract<Moment, { phase: 'before' }> }) {
  const bundle = useTripBundle(moment.trip.id)
  const saved = useSavedDocuments(bundle.data)
  const state = bundle.data
    ? readiness(bundle.data, (attachment) =>
        (saved ?? new Set<string>()).has(attachmentUrl(moment.trip.id, attachment.id)),
      )
    : null

  return (
    <>
      <header className="today__head">
        <p className="today__label">{t('today.leavingIn')}</p>
        <h2 className="today__count">{count('today.days', moment.daysAway)}</h2>
        <p className="today__where">{moment.trip.destination_label ?? moment.trip.title}</p>
      </header>

      {state && !state.ready && (
        <section className="stack stack--tight">
          <h3 className="section__title">{t('today.stillToDo')}</h3>
          <ul className="rows">
            {state.pending.length > 0 && (
              <li>
                <Link className="rows__item" to={`/trips/${moment.trip.id}`}>
                  <Icon name="ticket" size={18} />
                  <span className="rows__body">
                    <span className="rows__title">
                      {count('today.pending', state.pending.length)}
                    </span>
                    <span className="rows__hint">{t('today.pendingHint')}</span>
                  </span>
                </Link>
              </li>
            )}
            {state.packing.total > state.packing.done && (
              <li>
                <Link className="rows__item" to={`/trips/${moment.trip.id}/packing`}>
                  <Icon name="check" size={18} />
                  <span className="rows__body">
                    <span className="rows__title">
                      {t('today.packing', {
                        done: state.packing.done,
                        total: state.packing.total,
                      })}
                    </span>
                    <span className="rows__hint">{t('today.packingHint')}</span>
                  </span>
                </Link>
              </li>
            )}
            {saved !== null && state.documents.saved < state.documents.total && (
              <li>
                <Link className="rows__item" to={`/trips/${moment.trip.id}/offline`}>
                  <Icon name="paperclip" size={18} />
                  <span className="rows__body">
                    <span className="rows__title">
                      {count(
                        'today.documents',
                        state.documents.total - state.documents.saved,
                      )}
                    </span>
                    <span className="rows__hint">{t('today.documentsHint')}</span>
                  </span>
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      {state?.ready && <p className="hint">{t('today.ready')}</p>}
      {bundle.data && <Next bundle={bundle.data} />}
      <TripLink tripId={moment.trip.id} label={t('today.open')} />
    </>
  )
}

/** The trip you are on. */
function DuringTrip({ moment: chosen }: { moment: Extract<Moment, { phase: 'during' }> }) {
  const bundle = useTripBundle(chosen.trip.id)
  // The day number is counted against the home clock until the bundle
  // arrives and says which city you are in. Seven hours matter: in Tokyo
  // it is tomorrow for most of a Roman evening.
  const firstGuess = bundle.data ? stopToday(bundle.data, chosen.today) : null
  const moment = refine(chosen, firstGuess?.tz ?? null) as typeof chosen
  const stop = bundle.data ? stopToday(bundle.data, moment.today) : null
  const spent = bundle.data ? spentOn(bundle.data, moment.today) : 0

  return (
    <>
      <header className="today__head">
        <p className="today__label">
          {t('today.dayOf', { day: moment.day, total: moment.total })}
        </p>
        <h2 className="today__count">{stop?.name ?? moment.trip.title}</h2>
        <p className="today__where">{formatCalendarDateLong(moment.today)}</p>
      </header>

      <TodayWeather tripId={moment.trip.id} day={moment.today} />
      {bundle.data && <Next bundle={bundle.data} />}

      {spent > 0 && (
        <Link className="card today__spent" to={`/trips/${moment.trip.id}/expenses`}>
          <span className="detail__label">{t('today.spentToday')}</span>
          <span className="totals__big">
            {formatMoney(spent, moment.trip.primary_currency)}
          </span>
        </Link>
      )}

      <TripLink tripId={moment.trip.id} label={t('today.openDay')} />
    </>
  )
}

/** The trip that is over. It is here to be read, not worked on. */
function AfterTrip({ moment }: { moment: Extract<Moment, { phase: 'after' }> }) {
  return (
    <>
      <header className="today__head">
        <p className="today__label">{t('today.wereBack')}</p>
        <h2 className="today__count">{count('today.daysAgo', moment.daysSince)}</h2>
        <p className="today__where">{moment.trip.destination_label ?? moment.trip.title}</p>
      </header>

      <ul className="rows">
        <li>
          <Link className="rows__item" to={`/trips/${moment.trip.id}/diary`}>
            <Icon name="list" size={18} />
            <span className="rows__body">
              <span className="rows__title">{t('diary.title')}</span>
              <span className="rows__hint">{t('today.diaryHint')}</span>
            </span>
          </Link>
        </li>
        <li>
          <Link className="rows__item" to={`/trips/${moment.trip.id}/memories`}>
            <Icon name="view" size={18} />
            <span className="rows__body">
              <span className="rows__title">{t('memories.title')}</span>
              <span className="rows__hint">{t('today.memoriesHint')}</span>
            </span>
          </Link>
        </li>
      </ul>

      <Link className="button button--quiet" to="/trips">
        {t('today.allTrips')}
      </Link>
    </>
  )
}

export function Today() {
  // The cache is rehydrated from IndexedDB asynchronously, so the first
  // paint can land before the data does. Without this the screen would
  // say "no trips yet" for a frame and then replace itself, which on a
  // cold start reads as the app having lost everything.
  const restoring = useIsRestoring()
  const trips = useTrips()

  const body = () => {
    if (restoring || (trips.isPending && !trips.data)) {
      return <p className="muted">{t('common.loading')}</p>
    }

    const moment = chooseMoment(trips.data ?? [])

    switch (moment.phase) {
      case 'during':
        return <DuringTrip moment={moment} />
      case 'before':
        return <BeforeTrip moment={moment} />
      case 'after':
        return <AfterTrip moment={moment} />
      case 'undated':
        return (
          <>
            <header className="today__head">
              <h2 className="today__count">{moment.trip.title}</h2>
              <p className="today__where">{t('today.noDates')}</p>
            </header>
            <TripLink tripId={moment.trip.id} label={t('today.open')} />
          </>
        )
      default:
        return (
          <>
            <p className="empty">{t('today.nothing')}</p>
            <Link className="button" to="/trips">
              {t('trips.new')}
            </Link>
          </>
        )
    }
  }

  return (
    <>
      <header className="appbar">
        <div className="appbar__titles">
          <h1 className="appbar__title">{t('app.name')}</h1>
        </div>
        <div className="appbar__action">
          <Link className="appbar__button" to="/settings">
            {t('settings.title')}
          </Link>
        </div>
      </header>
      <main className="page stack">
        {body()}
        <Link className="today__all" to="/trips">
          {t('today.allTrips')}
        </Link>
      </main>
    </>
  )
}
