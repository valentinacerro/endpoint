import { describe, expect, it } from 'vitest'

import {
  dayKeyInZone,
  daysUntil,
  eachDay,
  formatCalendarDate,
  formatTimeInZone,
  homeTimeHint,
  instantToZonedInput,
  shiftZonedDays,
  shortZoneName,
  zonedInputToInstant,
} from './datetime'

const TOKYO = 'Asia/Tokyo'
const ROME = 'Europe/Rome'

// 12 April 2026, 15:00 in Tokyo — 06:00 UTC, 08:00 in Rome.
const CHECK_IN = '2026-04-12T06:00:00Z'

describe('reading an instant in the right zone', () => {
  it('shows the wall-clock time of the place, not of the device', () => {
    expect(formatTimeInZone(CHECK_IN, TOKYO)).toBe('15:00')
    expect(formatTimeInZone(CHECK_IN, ROME)).toBe('08:00')
  })

  it('groups by the day it is in that zone', () => {
    // 23:30 in Rome on the 11th is already 06:30 on the 12th in Tokyo.
    const lateEvening = '2026-04-11T21:30:00Z'
    expect(dayKeyInZone(lateEvening, ROME)).toBe('2026-04-11')
    expect(dayKeyInZone(lateEvening, TOKYO)).toBe('2026-04-12')
  })

  it('keeps the day stable across the date line', () => {
    // The failure this guards against is "Day 3" sliding onto "Day 2"
    // mid-flight, which is when a confusing screen is least welcome.
    const beforeMidnightTokyo = '2026-04-12T14:59:00Z' // 23:59 in Tokyo
    const afterMidnightTokyo = '2026-04-12T15:01:00Z' // 00:01 on the 13th
    expect(dayKeyInZone(beforeMidnightTokyo, TOKYO)).toBe('2026-04-12')
    expect(dayKeyInZone(afterMidnightTokyo, TOKYO)).toBe('2026-04-13')
    // Both are still the 12th in Rome.
    expect(dayKeyInZone(beforeMidnightTokyo, ROME)).toBe('2026-04-12')
    expect(dayKeyInZone(afterMidnightTokyo, ROME)).toBe('2026-04-12')
  })
})

describe('calendar dates, which have no zone at all', () => {
  it('does not shift a date-only value', () => {
    // `new Date("2026-04-11")` is midnight UTC, so a naive implementation
    // renders the 10th west of Greenwich. Every trip start date in the app
    // would be a day early.
    const formatted = formatCalendarDate('2026-04-11')
    expect(formatted).toContain('11')
    expect(formatted).not.toContain('10')
  })

  it('holds at the edges of a month', () => {
    expect(formatCalendarDate('2026-03-01')).toContain('1')
    expect(formatCalendarDate('2026-12-31')).toContain('31')
  })
})

describe('listing the days of a trip', () => {
  it('includes both ends', () => {
    expect(eachDay('2026-04-11', '2026-04-14')).toEqual([
      '2026-04-11',
      '2026-04-12',
      '2026-04-13',
      '2026-04-14',
    ])
  })

  it('handles a single day', () => {
    expect(eachDay('2026-04-11', '2026-04-11')).toEqual(['2026-04-11'])
  })

  it('crosses a month boundary', () => {
    expect(eachDay('2026-03-30', '2026-04-02')).toEqual([
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ])
  })

  it('crosses the European clock change without losing or repeating a day', () => {
    // 29 March 2026 is when Italy moves to summer time. Working in UTC
    // rather than local time is what keeps this from producing 23- and
    // 25-hour days that duplicate or skip a date.
    expect(eachDay('2026-03-28', '2026-03-30')).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ])
  })
})

describe('the home-clock hint', () => {
  const soon = new Date('2026-04-12T00:00:00Z') // six hours before check-in

  it('appears for an event that is imminent and in another zone', () => {
    const hint = homeTimeHint(CHECK_IN, TOKYO, { now: soon, deviceZone: ROME })
    expect(hint).toEqual({ time: '08:00', zone: ROME })
  })

  it('stays quiet once the device is in the same zone', () => {
    // Which is the normal case from the moment you land.
    expect(homeTimeHint(CHECK_IN, TOKYO, { now: soon, deviceZone: TOKYO })).toBeNull()
  })

  it('stays quiet for something far in the future', () => {
    // On a trip to Japan every single time differs from the Italian clock,
    // so showing this on every row would be pure noise.
    const longBefore = new Date('2026-04-01T00:00:00Z')
    expect(homeTimeHint(CHECK_IN, TOKYO, { now: longBefore, deviceZone: ROME })).toBeNull()
  })

  it('stays quiet for something already past', () => {
    const after = new Date('2026-04-13T00:00:00Z')
    expect(homeTimeHint(CHECK_IN, TOKYO, { now: after, deviceZone: ROME })).toBeNull()
  })

  it('stays quiet when both clocks happen to read the same', () => {
    // Lisbon and London differ as zones but not, usually, on the clock.
    const hint = homeTimeHint(CHECK_IN, 'Europe/Lisbon', {
      now: soon,
      deviceZone: 'Europe/London',
    })
    expect(hint).toBeNull()
  })
})

describe('reading a form field as wall-clock time in a chosen zone', () => {
  it('interprets the typed time in the event zone, not the device one', () => {
    // Typing "15:00" for a Tokyo check-in must mean 15:00 in Tokyo, whoever
    // is typing and wherever they are.
    const instant = zonedInputToInstant('2026-04-12T15:00', TOKYO)
    expect(new Date(instant).toISOString()).toBe('2026-04-12T06:00:00.000Z')
  })

  it('returns UTC, not the zone offset', () => {
    // Instants are compared as plain strings in places, so one spelling
    // of a moment is not optional: "…T15:00:00.000+09:00" and
    // "…T06:00:00.000Z" are the same instant and sort differently.
    expect(zonedInputToInstant('2026-04-12T15:00', TOKYO)).toBe('2026-04-12T06:00:00.000Z')
  })

  it('applies summer time for the zone, not for the device', () => {
    // 12 April is summer time in Italy: 15:00 Rome is 13:00 UTC, not 14:00.
    const instant = zonedInputToInstant('2026-04-12T15:00', ROME)
    expect(new Date(instant).toISOString()).toBe('2026-04-12T13:00:00.000Z')
  })

  it('applies winter time for a date before the change', () => {
    // 1 February is winter time: 15:00 Rome is 14:00 UTC.
    const instant = zonedInputToInstant('2026-02-01T15:00', ROME)
    expect(new Date(instant).toISOString()).toBe('2026-02-01T14:00:00.000Z')
  })

  it('round-trips through the form and back', () => {
    for (const [local, zone] of [
      ['2026-04-12T15:00', TOKYO],
      ['2026-04-12T00:00', TOKYO],
      ['2026-12-31T23:59', ROME],
      ['2026-02-01T09:30', ROME],
    ] as const) {
      expect(instantToZonedInput(zonedInputToInstant(local, zone), zone)).toBe(local)
    }
  })

  it('renders midnight as 00:00, never 24:00', () => {
    // Some ICU versions emit "24:00" for midnight, which no date input
    // will accept — it would silently blank the field.
    const midnight = zonedInputToInstant('2026-04-12T00:00', TOKYO)
    expect(instantToZonedInput(midnight, TOKYO)).toBe('2026-04-12T00:00')
  })
})

describe('moving something by a day', () => {
  it('keeps the same time on the local clock', () => {
    const at10 = zonedInputToInstant('2026-04-13T10:00', TOKYO)
    const nextDay = shiftZonedDays(at10, 'Asia/Tokyo', 1)
    expect(instantToZonedInput(nextDay, 'Asia/Tokyo')).toBe('2026-04-14T10:00')
  })

  it('goes backwards too', () => {
    const at10 = zonedInputToInstant('2026-04-13T10:00', TOKYO)
    expect(instantToZonedInput(shiftZonedDays(at10, 'Asia/Tokyo', -1), 'Asia/Tokyo')).toBe(
      '2026-04-12T10:00',
    )
  })

  it('survives the night the clocks change', () => {
    // Italy moves to summer time on 29 March 2026, so that day is 23 hours
    // long. Adding a flat 24 hours would drag a 09:00 visit to 10:00.
    const beforeChange = zonedInputToInstant('2026-03-28T09:00', ROME)
    const after = shiftZonedDays(beforeChange, 'Europe/Rome', 1)
    expect(instantToZonedInput(after, 'Europe/Rome')).toBe('2026-03-29T09:00')
    // And the underlying instant really did move by 23 hours, not 24.
    const hours = (new Date(after).getTime() - new Date(beforeChange).getTime()) / 3_600_000
    expect(hours).toBe(23)
  })

  it('crosses a month boundary', () => {
    const lastOfMonth = zonedInputToInstant('2026-04-30T18:00', TOKYO)
    expect(instantToZonedInput(shiftZonedDays(lastOfMonth, 'Asia/Tokyo', 1), 'Asia/Tokyo')).toBe(
      '2026-05-01T18:00',
    )
  })
})

describe('counting down to departure', () => {
  // Midday UTC on purpose: this function answers "what day is it *here*",
  // so a reference instant near midnight would land on different dates in
  // Rome and in Tokyo and make the test disagree with itself depending on
  // the machine running it.
  const today = new Date('2026-04-09T12:00:00Z')

  it('counts whole days, not hours', () => {
    expect(daysUntil('2026-04-09', today)).toBe(0)
    expect(daysUntil('2026-04-11', today)).toBe(2)
    expect(daysUntil('2026-04-07', today)).toBe(-2)
  })

  it('does not drift across a month boundary', () => {
    expect(daysUntil('2026-05-01', new Date('2026-04-29T12:00:00Z'))).toBe(2)
  })

  it('uses the day it is where you are', () => {
    // Intentional, not a bug: at 23:00 UTC it is already tomorrow in both
    // Rome and Tokyo, so a departure on the 1st is one sleep away, not two.
    // A countdown that argued with the phone's own calendar would be worse.
    expect(daysUntil('2026-05-01', new Date('2026-04-29T23:00:00Z'))).toBe(1)
  })
})

describe('zone labels', () => {
  it('keeps the city', () => {
    expect(shortZoneName('Asia/Tokyo')).toBe('Tokyo')
    expect(shortZoneName('America/New_York')).toBe('New York')
    expect(shortZoneName('UTC')).toBe('UTC')
  })
})
