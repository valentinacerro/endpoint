/**
 * A JPEG with EXIF in it, built byte by byte, for tests.
 *
 * Test-only, but it lives here rather than in a `.test.ts` so more than
 * one test file can use it.
 *
 * Writing the container by hand is the point. The reader is someone
 * else's library, so a file written here and read back there is a genuine
 * cross-check: if the two agreed by sharing a mistake they would have to
 * have made the same mistake independently. A mocked reader would prove
 * nothing at all — least of all the part that actually goes wrong, which
 * is southern and western coordinates coming back positive.
 */

/** EXIF tags, by the numbers the format uses. */
const TAG = {
  EXIF_IFD_POINTER: 0x8769,
  GPS_IFD_POINTER: 0x8825,
  DATE_TIME_ORIGINAL: 0x9003,
  OFFSET_TIME_ORIGINAL: 0x9011,
  GPS_LATITUDE_REF: 0x0001,
  GPS_LATITUDE: 0x0002,
  GPS_LONGITUDE_REF: 0x0003,
  GPS_LONGITUDE: 0x0004,
} as const

const TYPE = { ASCII: 2, LONG: 4, RATIONAL: 5 } as const

interface Entry {
  tag: number
  type: number
  count: number
  /** Four bytes written inline, or an offset into the value block. */
  inline?: number
  bytes?: Uint8Array
}

function ascii(text: string): Uint8Array {
  // NUL-terminated, as the format requires.
  return new TextEncoder().encode(`${text}\0`)
}

/** Degrees as the three rationals EXIF stores: degrees, minutes, seconds. */
function dms(value: number): Uint8Array {
  const absolute = Math.abs(value)
  const degrees = Math.floor(absolute)
  const minutes = Math.floor((absolute - degrees) * 60)
  // Thousandths of a second: enough for a metre, and exact in a rational.
  const seconds = Math.round((absolute - degrees - minutes / 60) * 3600 * 1000)

  const out = new DataView(new ArrayBuffer(24))
  const pairs: [number, number][] = [
    [degrees, 1],
    [minutes, 1],
    [seconds, 1000],
  ]
  pairs.forEach(([numerator, denominator], index) => {
    out.setUint32(index * 8, numerator, true)
    out.setUint32(index * 8 + 4, denominator, true)
  })
  return new Uint8Array(out.buffer)
}

/**
 * One IFD: a count, its entries, a link to the next, then the values too
 * big to sit inside an entry.
 */
function buildIfd(entries: Entry[], ifdOffset: number): Uint8Array {
  const headerSize = 2 + entries.length * 12 + 4
  const blocks: Uint8Array[] = []
  let valueOffset = ifdOffset + headerSize

  const out = new DataView(new ArrayBuffer(headerSize))
  out.setUint16(0, entries.length, true)

  entries.forEach((entry, index) => {
    const at = 2 + index * 12
    out.setUint16(at, entry.tag, true)
    out.setUint16(at + 2, entry.type, true)
    out.setUint32(at + 4, entry.count, true)

    if (entry.bytes && entry.bytes.length > 4) {
      out.setUint32(at + 8, valueOffset, true)
      blocks.push(entry.bytes)
      // Values are word-aligned; an odd length gets a padding byte.
      valueOffset += entry.bytes.length + (entry.bytes.length % 2)
      if (entry.bytes.length % 2) blocks.push(new Uint8Array(1))
    } else if (entry.bytes) {
      const padded = new Uint8Array(4)
      padded.set(entry.bytes)
      new Uint8Array(out.buffer, at + 8, 4).set(padded)
    } else {
      out.setUint32(at + 8, entry.inline ?? 0, true)
    }
  })

  out.setUint32(headerSize - 4, 0, true) // no next IFD

  return concat([new Uint8Array(out.buffer), ...blocks])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export interface FixtureOptions {
  lat?: number
  lon?: number
  /** Exactly as EXIF writes it: "2026:04:13 14:20:00". */
  dateTimeOriginal?: string
  /** "+09:00". Absent on most cameras, which is the interesting case. */
  offsetTimeOriginal?: string
}

/**
 * A minimal but valid JPEG carrying the EXIF fields this app reads.
 *
 * The image data is a single grey pixel — nothing here cares what the
 * picture is of.
 */
export function jpegWithExif(options: FixtureOptions = {}): Uint8Array {
  const { lat, lon, dateTimeOriginal, offsetTimeOriginal } = options

  // The TIFF block starts after "Exif\0\0"; every offset inside it is
  // measured from there.
  const tiffHeader = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])

  const exifEntries: Entry[] = []
  if (dateTimeOriginal) {
    exifEntries.push({
      tag: TAG.DATE_TIME_ORIGINAL,
      type: TYPE.ASCII,
      count: dateTimeOriginal.length + 1,
      bytes: ascii(dateTimeOriginal),
    })
  }
  if (offsetTimeOriginal) {
    exifEntries.push({
      tag: TAG.OFFSET_TIME_ORIGINAL,
      type: TYPE.ASCII,
      count: offsetTimeOriginal.length + 1,
      bytes: ascii(offsetTimeOriginal),
    })
  }

  const gpsEntries: Entry[] = []
  if (lat !== undefined && lon !== undefined) {
    gpsEntries.push(
      {
        tag: TAG.GPS_LATITUDE_REF,
        type: TYPE.ASCII,
        count: 2,
        bytes: ascii(lat >= 0 ? 'N' : 'S'),
      },
      { tag: TAG.GPS_LATITUDE, type: TYPE.RATIONAL, count: 3, bytes: dms(lat) },
      {
        tag: TAG.GPS_LONGITUDE_REF,
        type: TYPE.ASCII,
        count: 2,
        bytes: ascii(lon >= 0 ? 'E' : 'W'),
      },
      { tag: TAG.GPS_LONGITUDE, type: TYPE.RATIONAL, count: 3, bytes: dms(lon) },
    )
  }

  // IFD0 holds only the pointers. Its size is known up front, which is
  // what lets the sub-directories be laid out after it.
  const pointerCount = (exifEntries.length ? 1 : 0) + (gpsEntries.length ? 1 : 0)
  const ifd0Size = 2 + pointerCount * 12 + 4
  const ifd0Offset = 8

  const exifOffset = ifd0Offset + ifd0Size
  const exifBlock = exifEntries.length ? buildIfd(exifEntries, exifOffset) : new Uint8Array(0)
  const gpsOffset = exifOffset + exifBlock.length
  const gpsBlock = gpsEntries.length ? buildIfd(gpsEntries, gpsOffset) : new Uint8Array(0)

  const pointers: Entry[] = []
  if (exifEntries.length) {
    pointers.push({
      tag: TAG.EXIF_IFD_POINTER,
      type: TYPE.LONG,
      count: 1,
      inline: exifOffset,
    })
  }
  if (gpsEntries.length) {
    pointers.push({ tag: TAG.GPS_IFD_POINTER, type: TYPE.LONG, count: 1, inline: gpsOffset })
  }

  const tiff = concat([tiffHeader, buildIfd(pointers, ifd0Offset), exifBlock, gpsBlock])
  const payload = concat([new TextEncoder().encode('Exif\0\0'), tiff])

  const app1Header = new Uint8Array(4)
  const view = new DataView(app1Header.buffer)
  view.setUint16(0, 0xffe1) // APP1 marker
  view.setUint16(2, payload.length + 2) // big-endian, unlike the TIFF inside

  return concat([
    new Uint8Array([0xff, 0xd8]), // SOI
    app1Header,
    payload,
    new Uint8Array([0xff, 0xd9]), // EOI
  ])
}

/** The same thing as a `File`, which is what the picker hands over. */
export function jpegFile(name: string, options: FixtureOptions = {}): File {
  return new File([jpegWithExif(options) as BlobPart], name, { type: 'image/jpeg' })
}
