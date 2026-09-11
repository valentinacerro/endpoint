import { describe, expect, it } from 'vitest'

import { jpegFile, jpegWithExif } from './exifFixture'
import { parseExifDate, readPhoto } from './exif'

/** Senso-ji, Tokyo. */
const SENSOJI = { lat: 35.7148, lon: 139.7967 }

describe('parseExifDate', () => {
  it('reads the colon-separated date EXIF uses', () => {
    expect(parseExifDate('2026:04:13 14:20:00')).toBe('2026-04-13T14:20')
  })

  it('accepts a T where some cameras write one', () => {
    expect(parseExifDate('2026:04:13T14:20:00')).toBe('2026-04-13T14:20')
  })

  it('refuses the zeroes a flat battery writes', () => {
    // A camera that has lost its clock writes 0000:00:00, which is not a
    // date and must not become one.
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull()
  })

  it('refuses anything else', () => {
    expect(parseExifDate('')).toBeNull()
    expect(parseExifDate('yesterday afternoon')).toBeNull()
  })
})

describe('readPhoto', () => {
  it('reads position and wall clock out of a real file', async () => {
    const file = jpegFile('IMG_0001.jpg', {
      ...SENSOJI,
      dateTimeOriginal: '2026:04:13 14:20:00',
      offsetTimeOriginal: '+09:00',
    })

    const reading = await readPhoto(file)

    expect(reading.ok).toBe(true)
    if (!reading.ok) return
    expect(reading.photo.lat).toBeCloseTo(35.7148, 4)
    expect(reading.photo.lon).toBeCloseTo(139.7967, 4)
    expect(reading.photo.localTime).toBe('2026-04-13T14:20')
    expect(reading.photo.offset).toBe('+09:00')
    expect(reading.photo.filename).toBe('IMG_0001.jpg')
  })

  it('keeps the wall clock rather than an instant', async () => {
    // The trap this whole design is built around. EXIF records what the
    // camera's clock said and nothing about the zone, so a library that
    // helpfully returns a Date has read 14:20 as *this machine's* local
    // time — seven hours out for a photo taken in Japan and opened in
    // Italy, and a day out for anything taken in the evening.
    const file = jpegFile('IMG_0002.jpg', {
      ...SENSOJI,
      dateTimeOriginal: '2026:04:13 22:40:00',
    })

    const reading = await readPhoto(file)

    expect(reading.ok).toBe(true)
    if (!reading.ok) return
    expect(reading.photo.localTime).toBe('2026-04-13T22:40')
    expect(reading.photo.offset).toBeNull()
  })

  it('gets the hemisphere right south and west of zero', async () => {
    // The single most likely thing to be silently wrong: coordinates are
    // stored as unsigned degrees plus a separate letter, and dropping
    // the letter puts Ushuaia in Siberia.
    const file = jpegFile('patagonia.jpg', {
      lat: -54.8019,
      lon: -68.303,
      dateTimeOriginal: '2026:04:13 14:20:00',
    })

    const reading = await readPhoto(file)

    expect(reading.ok).toBe(true)
    if (!reading.ok) return
    expect(reading.photo.lat).toBeCloseTo(-54.8019, 3)
    expect(reading.photo.lon).toBeCloseTo(-68.303, 3)
  })

  it('says so when there is no position', async () => {
    // The commonest case by far: location tagging is off by default on
    // most phones and stripped by most messaging apps.
    const file = jpegFile('screenshot.jpg', { dateTimeOriginal: '2026:04:13 14:20:00' })
    expect(await readPhoto(file)).toEqual({
      ok: false,
      filename: 'screenshot.jpg',
      reason: 'no_position',
    })
  })

  it('says so when there is no time', async () => {
    const file = jpegFile('scan.jpg', SENSOJI)
    expect(await readPhoto(file)).toEqual({ ok: false, filename: 'scan.jpg', reason: 'no_time' })
  })

  it('treats the null island as no position at all', async () => {
    // 0,0 is in the Gulf of Guinea and is what a confused GPS chip
    // writes. Plotting it would put a pin off the coast of Africa in the
    // middle of a trip to Japan.
    const file = jpegFile('broken.jpg', {
      lat: 0,
      lon: 0,
      dateTimeOriginal: '2026:04:13 14:20:00',
    })
    const reading = await readPhoto(file)
    expect(reading.ok).toBe(false)
    if (reading.ok) return
    expect(reading.reason).toBe('no_position')
  })

  it('does not throw on a file that is not a photograph', async () => {
    const notAPhoto = new File([new Uint8Array([1, 2, 3, 4]) as BlobPart], 'notes.txt', {
      type: 'text/plain',
    })
    const reading = await readPhoto(notAPhoto)
    expect(reading.ok).toBe(false)
  })

  it('builds a fixture a parser actually accepts', () => {
    // Guards the guard: if the builder emitted nonsense, every test above
    // would pass by agreeing that nothing could be read.
    const bytes = jpegWithExif({ ...SENSOJI, dateTimeOriginal: '2026:04:13 14:20:00' })
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
    expect(bytes.length).toBeGreaterThan(100)
  })
})
