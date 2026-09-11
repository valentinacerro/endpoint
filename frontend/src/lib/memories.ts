/**
 * Turning what a photograph says into a point on the trip.
 *
 * Two inferences happen here and both are recorded rather than hidden.
 * Which zone the camera's clock was in has to be guessed from where the
 * photo was taken, unless the file says; and the identity of a photo has
 * to be derived from its contents, so that importing the same folder
 * twice does not double your holiday.
 */

import type { Memory, Stop } from '../api/types'

import { dayKeyInZone, zonedInputToInstant, type CalendarDate } from './datetime'
import type { PhotoReading } from './exif'
import { haversineKm, type Point } from './geo'

export type TimeSource = 'exif' | 'assumed'

export interface Placed {
  id: string
  lat: number
  lon: number
  takenAt: string
  takenTz: string
  timeSource: TimeSource
  filename: string
}

/**
 * The zone a photograph's clock was probably set to.
 *
 * The nearest stop's, because that is where you were — and every stop
 * carries a real IANA zone, entered when it was created. A photo taken
 * between cities lands on whichever end is closer, which is right far
 * more often than the trip's default would be.
 *
 * Stops with no coordinates cannot help and are skipped rather than
 * guessed at.
 */
export function zoneFor(point: Point, stops: readonly Stop[], fallback: string): string {
  let best: { zone: string; km: number } | null = null

  for (const stop of stops) {
    if (stop.lat === null || stop.lon === null) continue
    const km = haversineKm(point, { lat: stop.lat, lon: stop.lon })
    if (best === null || km < best.km) best = { zone: stop.tz, km }
  }

  return best?.zone ?? fallback
}

/**
 * The instant a photo was taken, and how sure we are of it.
 *
 * With an offset in the file the answer is exact. Without one — the
 * common case — the wall clock is read in the zone we believe you were
 * standing in. That is a good guess and not a fact, which is why the
 * difference is carried all the way to the screen.
 */
export function instantOf(
  localTime: string,
  offset: string | null,
  zone: string,
): { instant: string; source: TimeSource } {
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    return { instant: new Date(`${localTime}:00${offset}`).toISOString(), source: 'exif' }
  }
  return { instant: zonedInputToInstant(localTime, zone), source: 'assumed' }
}

/**
 * A stable id for a photograph, derived from the photograph.
 *
 * So that importing the same folder a second time — or the same folder
 * on a second device — writes the same rows again instead of a duplicate
 * set. Filename alone is not enough (`IMG_0001.jpg` recurs), and
 * coordinates alone are not either (a dozen shots of the same temple),
 * but together with the timestamp they identify a picture.
 *
 * SHA-256, cut to sixteen bytes and stamped with the version and variant
 * bits so that what comes out is a well-formed UUID and not merely
 * something the server will accept.
 */
export async function memoryId(photo: PhotoReading): Promise<string> {
  const seed = [photo.filename, photo.localTime, photo.lat.toFixed(6), photo.lon.toFixed(6)].join(
    '|',
  )
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)),
  ).slice(0, 16)

  digest[6] = (digest[6] & 0x0f) | 0x50 // version 5: derived from a name
  digest[8] = (digest[8] & 0x3f) | 0x80 // RFC 4122 variant

  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

export async function place(
  photo: PhotoReading,
  stops: readonly Stop[],
  fallbackZone: string,
): Promise<Placed> {
  const zone = zoneFor({ lat: photo.lat, lon: photo.lon }, stops, fallbackZone)
  const { instant, source } = instantOf(photo.localTime, photo.offset, zone)

  return {
    id: await memoryId(photo),
    lat: photo.lat,
    lon: photo.lon,
    takenAt: instant,
    takenTz: zone,
    timeSource: source,
    filename: photo.filename,
  }
}

export interface MemoryDay {
  key: CalendarDate
  memories: Memory[]
}

/**
 * Points grouped by the day they were taken, in each one's own zone.
 *
 * By the local day, not the UTC one: a photograph taken at nine in the
 * evening in Japan is noon UTC, and filing it under the wrong day would
 * be visible at a glance on a screen whose whole purpose is remembering
 * which day was which.
 */
export function byDay(memories: readonly Memory[]): MemoryDay[] {
  const days = new Map<CalendarDate, Memory[]>()

  for (const memory of memories) {
    const key = dayKeyInZone(memory.taken_at, memory.taken_tz)
    days.set(key, [...(days.get(key) ?? []), memory])
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => ({
      key,
      memories: [...entries].sort((a, b) => a.taken_at.localeCompare(b.taken_at)),
    }))
}

/**
 * At most `max` points, spread evenly through the list.
 *
 * A fortnight of photographs is hundreds of points, and hundreds of
 * numbered pins on a phone-sized map is a blue smudge. Taking every nth
 * one keeps the shape of where you went — which is what the map is for —
 * where taking the first hundred would draw only the first three days,
 * and one pin per day would put five pins on Tokyo and show nothing of
 * crossing it.
 *
 * The first and last are always kept: the ends of a trace are the part
 * you look at.
 */
export function sample<T>(items: readonly T[], max: number): T[] {
  if (max < 2 || items.length <= max) return [...items]

  const step = (items.length - 1) / (max - 1)
  const picked: T[] = []
  for (let index = 0; index < max; index += 1) {
    picked.push(items[Math.round(index * step)])
  }
  return picked
}

/** How far the trace wanders, as a rough sense of how much ground it covers. */
export function spanKm(memories: readonly Memory[]): number {
  if (memories.length < 2) return 0
  let total = 0
  for (let index = 1; index < memories.length; index += 1) {
    total += haversineKm(
      { lat: memories[index - 1].lat, lon: memories[index - 1].lon },
      { lat: memories[index].lat, lon: memories[index].lon },
    )
  }
  return total
}
