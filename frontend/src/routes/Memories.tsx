import { lazy, Suspense, useState, type ChangeEvent } from 'react'
import { useParams } from 'react-router'

import { useDeleteMemory, usePutMemory, useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { count, t } from '../i18n'
import { formatDayKey, formatTimeInZone } from '../lib/datetime'
import { readPhoto } from '../lib/exif'
import { byDay, place, sample, spanKm } from '../lib/memories'

const TripMap = lazy(() =>
  import('../components/TripMap').then((module) => ({ default: module.TripMap })),
)

/** As many pins as read as a route rather than a smudge. */
const PINS = 60

interface Skipped {
  no_position: number
  no_time: number
  unreadable: number
}

/**
 * Where you actually went, drawn from your own photographs.
 *
 * The pictures never leave the device. The browser reads the coordinates
 * and the timestamp out of each file and sends only those — about a
 * hundred bytes a photo against several megabytes — which is what makes
 * this possible at all on half a gigabyte of free database, and means a
 * holiday's photographs are not sitting on someone else's server.
 */
export function Memories() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const save = usePutMemory(tripId ?? '')
  const remove = useDeleteMemory(tripId ?? '')

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [added, setAdded] = useState<number | null>(null)
  const [skipped, setSkipped] = useState<Skipped | null>(null)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const { trip, stops, memories } = bundle.data
  const days = byDay(memories)

  async function importPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    // The picker keeps its selection otherwise, so choosing the same
    // folder twice would do nothing the second time.
    event.target.value = ''
    if (files.length === 0) return

    const missed: Skipped = { no_position: 0, no_time: 0, unreadable: 0 }
    let written = 0
    setProgress({ done: 0, total: files.length })
    setAdded(null)
    setSkipped(null)

    for (const [index, file] of files.entries()) {
      const reading = await readPhoto(file)
      if (!reading.ok) {
        missed[reading.reason] += 1
      } else {
        const point = await place(reading.photo, stops, trip.primary_tz)
        try {
          await save.mutateAsync({
            id: point.id,
            lat: point.lat,
            lon: point.lon,
            taken_at: point.takenAt,
            taken_tz: point.takenTz,
            time_source: point.timeSource,
            filename: point.filename,
          })
          written += 1
        } catch {
          // One rejected point should not abandon the other three hundred.
          missed.unreadable += 1
        }
      }
      setProgress({ done: index + 1, total: files.length })
    }

    setProgress(null)
    setAdded(written)
    setSkipped(missed)
  }

  const shown = sample(memories, PINS)
  const pins = shown.map((memory, index) => ({
    id: memory.id,
    order: index + 1,
    lat: memory.lat,
    lon: memory.lon,
    label: memory.filename ?? formatDayKey(memory.taken_at.slice(0, 10)),
    kind: 'other' as const,
  }))

  return (
    <>
      <AppBar title={t('memories.title')} subtitle={trip.title} back={`/trips/${tripId}`} />
      <main className="page stack">
        <p className="muted small">{t('memories.privacy')}</p>

        {progress ? (
          <p className="hint">
            {t('memories.reading', { done: progress.done, total: progress.total })}
          </p>
        ) : (
          <label className="button button--file">
            {t('memories.import')}
            <input
              type="file"
              accept="image/jpeg,image/heic,image/heif"
              multiple
              className="visually-hidden"
              onChange={(event) => void importPhotos(event)}
            />
          </label>
        )}

        {added !== null && <p className="muted small">{count('memories.added', added)}</p>}

        {skipped && skipped.no_position > 0 && (
          <p className="muted small">{count('memories.noPosition', skipped.no_position)}</p>
        )}
        {skipped && skipped.no_time > 0 && (
          <p className="muted small">{count('memories.noTime', skipped.no_time)}</p>
        )}
        {skipped && skipped.unreadable > 0 && (
          <p className="muted small">{count('memories.unreadable', skipped.unreadable)}</p>
        )}

        {memories.length === 0 ? (
          <p className="empty">{t('memories.none')}</p>
        ) : (
          <>
            <p className="muted small">
              {t('memories.summary', {
                count: memories.length,
                days: days.length,
                km: Math.round(spanKm(memories)),
              })}
            </p>

            <Suspense fallback={<p className="muted small">{t('common.loading')}</p>}>
              <TripMap pins={pins} />
            </Suspense>

            {shown.length < memories.length && (
              <p className="muted small">
                {t('memories.sampled', { shown: shown.length, total: memories.length })}
              </p>
            )}

            {days.map((day) => (
              <section key={day.key} className="day">
                <h2 className="day__header">
                  <span className="day__number">{formatDayKey(day.key)}</span>
                  <span className="day__count">
                    {count('memories.thatDay', day.memories.length)}
                  </span>
                </h2>
                <ul className="docs">
                  {day.memories.map((memory) => (
                    <li key={memory.id} className="doc">
                      <span className="doc__open" style={{ cursor: 'default' }}>
                        <span className="doc__name">
                          {memory.filename ?? t('memories.unnamed')}
                        </span>
                        <span className="doc__meta">
                          {formatTimeInZone(memory.taken_at, memory.taken_tz)}
                          {memory.time_source === 'assumed' && ` · ${t('memories.timeAssumed')}`}
                        </span>
                      </span>
                      <button
                        className="chip chip--danger"
                        onClick={() => remove.mutate(memory.id)}
                        aria-label={t('common.delete')}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </main>
    </>
  )
}
