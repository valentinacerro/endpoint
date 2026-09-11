import { describe, expect, it } from 'vitest'

import { travelMinutes } from './geo'
import {
  opennessOn,
  planDay,
  twoOpt,
  type Anchor,
  type Candidate,
  type OpeningHours,
} from './optimizer'

const ZONE = 'Asia/Tokyo'
const DAY = '2026-04-13' // a Monday

// Real Tokyo places, so a wrong order is recognisable as wrong on a map.
const ASAKUSA = { lat: 35.7148, lon: 139.7967 }
const SKYTREE = { lat: 35.7101, lon: 139.8107 }
const UENO = { lat: 35.7141, lon: 139.7774 }
const SHIBUYA = { lat: 35.6595, lon: 139.7005 }

function place(over: Partial<Candidate> & { id: string; point: Candidate['point'] }): Candidate {
  return {
    visitMinutes: 60,
    priority: 'normal',
    openingHours: {},
    label: over.id,
    ...over,
  }
}

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  // 09:00 in Tokyo is 00:00 UTC.
  return new Date(Date.UTC(2026, 3, 13, h - 9, m)).toISOString()
}

describe('knowing whether somewhere is open', () => {
  const hours: OpeningHours = {
    mon: [['09:00', '17:00']],
    tue: [],
    wed: [
      ['09:00', '12:00'],
      ['13:00', '17:00'],
    ],
  }

  it('reads the hours for the right weekday', () => {
    expect(opennessOn(hours, '2026-04-13')).toEqual({
      kind: 'open',
      windows: [[540, 1020]],
    })
  })

  it('treats an empty list as shut', () => {
    expect(opennessOn(hours, '2026-04-14').kind).toBe('closed')
  })

  it('treats a missing day as unknown, not as shut', () => {
    // Almost nothing imported from Maps has opening hours. Reading silence
    // as "closed" would empty the itinerary; reading it as "open" without
    // saying so would be worse. Unknown is its own answer.
    expect(opennessOn(hours, '2026-04-16').kind).toBe('unknown')
    expect(opennessOn({}, '2026-04-13').kind).toBe('unknown')
  })

  it('keeps a lunch break as two windows', () => {
    const wednesday = opennessOn(hours, '2026-04-15')
    expect(wednesday).toEqual({ kind: 'open', windows: [[540, 720], [780, 1020]] })
  })
})

describe('untangling a route', () => {
  it('removes a crossing that nearest-neighbour would leave', () => {
    const items = [
      place({ id: 'shibuya', point: SHIBUYA }),
      place({ id: 'asakusa', point: ASAKUSA }),
      place({ id: 'skytree', point: SKYTREE }),
      place({ id: 'ueno', point: UENO }),
    ]
    const ordered = twoOpt(items, ASAKUSA)
    const cost = (list: Candidate[]) => {
      let total = travelMinutes(ASAKUSA, list[0].point)
      for (let i = 1; i < list.length; i += 1) {
        total += travelMinutes(list[i - 1].point, list[i].point)
      }
      return total
    }
    expect(cost(ordered)).toBeLessThanOrEqual(cost(items))
    // Shibuya is far from the other three, so it must not sit in the middle.
    expect(ordered.findIndex((item) => item.id === 'shibuya')).toBe(ordered.length - 1)
  })

  it('leaves one or two stops alone', () => {
    const one = [place({ id: 'a', point: ASAKUSA })]
    expect(twoOpt(one, null)).toEqual(one)
  })
})

describe('planning a day', () => {
  it('orders visits so the day does not zig-zag', () => {
    const plan = planDay(
      [],
      [
        place({ id: 'shibuya', point: SHIBUYA }),
        place({ id: 'asakusa', point: ASAKUSA }),
        place({ id: 'skytree', point: SKYTREE }),
      ],
      { day: DAY, zone: ZONE },
    )
    const order = plan.visits.map((visit) => visit.id)
    // The two neighbours belong next to each other, whichever end they
    // start from; Shibuya is the outlier and belongs at one end.
    expect(Math.abs(order.indexOf('asakusa') - order.indexOf('skytree'))).toBe(1)
    expect([0, 2]).toContain(order.indexOf('shibuya'))
  })

  it('works around something that cannot move', () => {
    const lunch: Anchor = {
      id: 'tour',
      startAt: at('12:00'),
      endAt: at('14:00'),
      point: UENO,
      label: 'tour prenotato',
    }
    const plan = planDay(
      [lunch],
      [place({ id: 'a', point: ASAKUSA, visitMinutes: 60 })],
      { day: DAY, zone: ZONE },
    )
    const visit = plan.visits[0]
    // It has to end before the tour starts, travel included.
    expect(new Date(visit.startAt).getTime()).toBeLessThan(new Date(at('12:00')).getTime())
  })

  it('does not schedule anywhere shut that day', () => {
    const plan = planDay(
      [],
      [place({ id: 'chiuso', point: ASAKUSA, openingHours: { mon: [] } })],
      { day: DAY, zone: ZONE },
    )
    expect(plan.visits).toHaveLength(0)
    expect(plan.dropped).toEqual([{ id: 'chiuso', reason: 'closed' }])
  })

  it('waits for opening time rather than arriving to a locked door', () => {
    const plan = planDay(
      [],
      [place({ id: 'tardi', point: ASAKUSA, openingHours: { mon: [['14:00', '18:00']] } })],
      { day: DAY, zone: ZONE, dayStart: '09:00' },
    )
    const start = new Date(plan.visits[0].startAt).getTime()
    expect(start).toBeGreaterThanOrEqual(new Date(at('14:00')).getTime())
  })

  it('flags a visit it scheduled without knowing the hours', () => {
    const plan = planDay([], [place({ id: 'boh', point: ASAKUSA })], { day: DAY, zone: ZONE })
    expect(plan.visits[0].hoursUnknown).toBe(true)
  })

  it('drops the optional things first when the day overflows', () => {
    // Six four-hour visits cannot fit between 09:00 and 21:00, so the
    // choice of what falls off is the whole point.
    const many = [
      place({ id: 'must', point: ASAKUSA, visitMinutes: 240, priority: 'must_see' }),
      place({ id: 'high', point: SKYTREE, visitMinutes: 240, priority: 'high' }),
      place({ id: 'low1', point: UENO, visitMinutes: 240, priority: 'low' }),
      place({ id: 'low2', point: SHIBUYA, visitMinutes: 240, priority: 'low' }),
    ]
    const plan = planDay([], many, { day: DAY, zone: ZONE })

    const kept = plan.visits.map((visit) => visit.id)
    expect(kept).toContain('must')
    expect(plan.dropped.map((item) => item.id)).toContain('low2')
    expect(plan.dropped.every((item) => item.reason === 'no_room')).toBe(true)
  })

  it('reports the travel it expects', () => {
    const plan = planDay(
      [],
      [place({ id: 'a', point: ASAKUSA }), place({ id: 'b', point: SKYTREE })],
      { day: DAY, zone: ZONE },
    )
    expect(plan.travelMinutes).toBeGreaterThan(0)
  })

  it('leaves an empty day empty', () => {
    const plan = planDay([], [], { day: DAY, zone: ZONE })
    expect(plan).toEqual({ visits: [], dropped: [], travelMinutes: 0 })
  })

  it('never schedules two visits over each other', () => {
    const plan = planDay(
      [],
      [
        place({ id: 'a', point: ASAKUSA, visitMinutes: 90 }),
        place({ id: 'b', point: SKYTREE, visitMinutes: 90 }),
        place({ id: 'c', point: UENO, visitMinutes: 90 }),
      ],
      { day: DAY, zone: ZONE },
    )
    const times = plan.visits.map((visit) => new Date(visit.startAt).getTime())
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1])
    }
  })
})

/**
 * The defects a multi-day pass multiplies.
 *
 * Every one of these produced a plan that was wrong rather than merely
 * suboptimal, and none of the fixtures above could reach them: they all
 * use Asia/Tokyo, which has no summer time, and no anchor in them starts
 * before the day does.
 */
describe('the day as it really is', () => {
  const ROME = 'Europe/Rome'
  /** The Sunday the clocks go back in Italy. */
  const FALL_BACK = '2026-10-25'
  const PANTHEON = { lat: 41.8986, lon: 12.4769 }

  it('reads an anchor by the clock on the wall, not by minutes elapsed', () => {
    // The clocks go back that night, so local midnight is 26 hours before
    // the end of the day. Counting elapsed minutes puts this 14:30 tour
    // at 930 when the clock says 870 — and dayStart and every opening
    // hour speak the clock. The morning is really 09:00–14:30, which is
    // 330 minutes; the bug makes it look like 390.
    //
    // So a 360-minute visit fits only in the hour that does not exist.
    const tour: Anchor = {
      id: 'tour',
      startAt: '2026-10-25T13:30:00.000Z',
      endAt: '2026-10-25T15:30:00.000Z',
      point: null,
      label: 'tour prenotato',
    }
    const plan = planDay(
      [tour],
      [place({ id: 'lungo', point: PANTHEON, visitMinutes: 360 })],
      { day: FALL_BACK, zone: ROME, dayStart: '09:00', dayEnd: '21:00' },
    )

    expect(plan.visits).toEqual([])
    expect(plan.dropped).toEqual([{ id: 'lungo', reason: 'no_room' }])
  })

  it('keeps the origin of each window aligned with the anchors', () => {
    // An anchor that starts before the day does pushes no window, so the
    // next window's origin used to be read from the wrong anchor — and an
    // anchor with no coordinates reset it to null, making the next leg
    // look free.
    const overnight: Anchor = {
      id: 'checkout',
      startAt: at('07:00'),
      endAt: at('08:00'),
      point: null,
      label: 'check-out',
    }
    const tour: Anchor = {
      id: 'tour',
      startAt: at('15:00'),
      endAt: at('16:00'),
      point: SHIBUYA,
      label: 'tour',
    }
    const plan = planDay(
      [overnight, tour],
      [place({ id: 'far', point: SHIBUYA, visitMinutes: 60 })],
      { day: DAY, zone: ZONE, startPoint: ASAKUSA },
    )

    // Starting from Asakusa, reaching Shibuya is not free.
    expect(plan.visits[0].travelMinutesBefore).toBeGreaterThan(0)
  })

  it('does not schedule past the end of the day', () => {
    // A 23:00 flight used to open the window [19:30, 23:00] on a day
    // declared to end at 21:00. First-fit hides that until something
    // forces a late start — here, a place that does not open until
    // 21:30. With the window unclamped it was scheduled then, an hour
    // and a half after the day was over.
    const flight: Anchor = {
      id: 'volo',
      startAt: at('23:00'),
      endAt: null,
      point: null,
      label: 'volo',
    }
    const plan = planDay(
      [flight],
      [
        place({
          id: 'tardi',
          point: ASAKUSA,
          visitMinutes: 60,
          openingHours: { mon: [['21:30', '23:00']] },
        }),
      ],
      { day: DAY, zone: ZONE, dayStart: '19:30', dayEnd: '21:00' },
    )

    expect(plan.visits).toEqual([])
    expect(plan.dropped).toEqual([{ id: 'tardi', reason: 'no_room' }])
  })

  it('leaves room to reach the thing that closes the window', () => {
    // Shibuya to Asakusa is 54 minutes each way. The morning window is
    // 180 minutes, so a 100-minute visit fits going out (54 + 100 = 154)
    // and cannot fit coming back (54 + 100 + 54 = 208). Before the fix
    // it was placed anyway, ending at 11:34 for a tour that starts at
    // 12:00 on the other side of the city.
    const tour: Anchor = {
      id: 'tour',
      startAt: at('12:00'),
      endAt: at('13:00'),
      point: SHIBUYA,
      label: 'tour a Shibuya',
    }
    const plan = planDay(
      [tour],
      [place({ id: 'asakusa', point: ASAKUSA, visitMinutes: 100 })],
      { day: DAY, zone: ZONE },
    )

    // It belongs after the tour, or nowhere — never in that morning.
    for (const visit of plan.visits) {
      expect(new Date(visit.startAt).getTime()).toBeGreaterThanOrEqual(
        new Date(at('13:00')).getTime(),
      )
    }
  })

  it('reserves the time an anchor needs around itself', () => {
    // A booking with no end time occupies zero minutes, so before this
    // a temple could be scheduled to finish at 19:00 exactly — arriving
    // at a table booked for 19:00 from wherever you happened to be, and
    // a second one could start at 19:00, on top of the dinner itself.
    //
    // The span a dinner really costs is the half hour to get there and
    // the hour and a half at the table, and only the caller knows that,
    // so it is stated rather than guessed.
    const dinner: Anchor = {
      id: 'cena',
      startAt: at('19:00'),
      endAt: null,
      point: SHIBUYA,
      label: 'cena prenotata',
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 90,
    }
    // Opens at 18:00, so it cannot simply be moved earlier out of the way.
    const plan = planDay(
      [dinner],
      [
        place({
          id: 'prima',
          point: SHIBUYA,
          visitMinutes: 60,
          openingHours: { mon: [['18:00', '22:00']] },
        }),
      ],
      { day: DAY, zone: ZONE, dayStart: '17:00', dayEnd: '21:00' },
    )

    expect(plan.visits).toEqual([])
    expect(plan.dropped).toEqual([{ id: 'prima', reason: 'no_room' }])
  })

  it('still leaves an empty day empty', () => {
    // The shape of DayPlan is pinned: nothing above may add a field.
    expect(planDay([], [], { day: DAY, zone: ZONE })).toEqual({
      visits: [],
      dropped: [],
      travelMinutes: 0,
    })
  })
})
