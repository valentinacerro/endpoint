/**
 * Reading where and when a photograph was taken — in the browser.
 *
 * The file is never uploaded. Only what comes out of here is: two
 * coordinates and a timestamp, about a hundred bytes against several
 * megabytes, and a holiday's photographs stay on the device they were
 * taken with.
 *
 * `exifr`, not a parser of our own. The fiddly part of EXIF is not the
 * container, it is the conventions — coordinates arrive as three
 * rationals plus a separate letter saying which hemisphere, and getting
 * that wrong puts a photograph in the South Atlantic rather than making
 * it fail. The lite build is 12 KB gzipped, reads JPEG and HEIC, and is
 * loaded only when this screen is opened.
 */

/** What the file actually says, before anything is inferred from it. */
export interface PhotoReading {
  filename: string
  lat: number
  lon: number
  /**
   * The wall clock written in the file, as "YYYY-MM-DDTHH:mm".
   *
   * Deliberately a string and not a Date. EXIF records the time on the
   * camera's clock with no indication of the zone, so there is no instant
   * here yet — only "the little hand was on two".
   */
  localTime: string
  /**
   * The offset the file records, like "+09:00", when it records one.
   *
   * Standardised in 2016 and written by a minority of cameras, so this is
   * usually null and the instant has to be inferred.
   */
  offset: string | null
}

export type Reading =
  | { ok: true; photo: PhotoReading }
  | { ok: false; filename: string; reason: 'no_position' | 'no_time' | 'unreadable' }

/** How much of a file has to be read to find its metadata. */
const HEADER_BYTES = 128 * 1024

interface ExifrLite {
  parse(
    input: File | Uint8Array,
    options: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined>
}

let loading: Promise<ExifrLite> | null = null

/** Loaded once, on demand: nothing else in the app needs it. */
function exifr(): Promise<ExifrLite> {
  loading ??= import('exifr/dist/lite.esm.mjs').then(
    (module) => (module.default ?? module) as ExifrLite,
  )
  return loading
}

/** "2026:04:13 14:20:00" — the format EXIF uses — into "2026-04-13T14:20". */
export function parseExifDate(value: string): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  // A camera with a flat battery writes zeroes; that is not a date.
  if (year === '0000' || month === '00' || day === '00') return null
  return `${year}-${month}-${day}T${hour}:${minute}`
}

export async function readPhoto(file: File): Promise<Reading> {
  let data: Record<string, unknown> | undefined

  try {
    data = await (
      await exifr()
    ).parse(file, {
      // Without this, exifr turns the timestamp into a `Date` by reading
      // the camera's wall clock as *this device's* local time. A photo
      // taken at 14:20 in Tokyo, opened on a laptop in Italy, becomes
      // 12:20 UTC instead of 05:20 — seven hours out, and a day out for
      // anything taken in the evening. The raw string is the truth; the
      // instant is worked out later, from where the photo was taken.
      reviveValues: false,
      gps: true,
      tiff: true,
      firstChunkSize: HEADER_BYTES,
    })
  } catch {
    return { ok: false, filename: file.name, reason: 'unreadable' }
  }

  if (!data) return { ok: false, filename: file.name, reason: 'unreadable' }

  const lat = data.latitude
  const lon = data.longitude
  if (typeof lat !== 'number' || typeof lon !== 'number' || !inTheWorld(lat, lon)) {
    // Much the commonest outcome: location tagging is off by default on
    // most phones, and stripped by most messaging apps.
    return { ok: false, filename: file.name, reason: 'no_position' }
  }

  const raw = data.DateTimeOriginal
  const localTime = typeof raw === 'string' ? parseExifDate(raw) : null
  if (!localTime) return { ok: false, filename: file.name, reason: 'no_time' }

  const offset = typeof data.OffsetTimeOriginal === 'string' ? data.OffsetTimeOriginal : null

  return { ok: true, photo: { filename: file.name, lat, lon, localTime, offset } }
}

function inTheWorld(lat: number, lon: number): boolean {
  // 0,0 is in the Gulf of Guinea and is what a broken GPS chip writes.
  if (lat === 0 && lon === 0) return false
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}
