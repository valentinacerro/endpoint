import 'fake-indexeddb/auto'

import { set } from 'idb-keyval'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clear, count, enqueue, flush, pending, size, subscribe } from './outbox'

const entry = (key: string, url = `/api/x/${key}`) =>
  ({ key, method: 'PUT', url, body: { a: 1 } }) as const

class Offline extends Error {}
const isNetworkFailure = (error: unknown) => error instanceof Offline

beforeEach(async () => {
  await clear()
})

describe('queueing a write', () => {
  it('keeps them in the order they were made', async () => {
    await enqueue(entry('a'))
    await enqueue(entry('b'))
    expect((await pending()).map((item) => item.key)).toEqual(['a', 'b'])
  })

  it('replaces an earlier write to the same thing', async () => {
    // Editing one expense three times offline should send one request, and
    // the last version is the one that matters.
    await enqueue(entry('a', '/api/x/first'))
    await enqueue(entry('a', '/api/x/second'))
    const queue = await pending()
    expect(queue).toHaveLength(1)
    expect(queue[0].url).toBe('/api/x/second')
  })

  it('leaves a re-written entry where it was in the line', async () => {
    // It used to go to the back, which was harmless while every queued
    // write stood alone. It stopped being harmless once a city could be
    // created offline: add Kyoto, add a temple in it, then rename Kyoto,
    // and sending the temple first would be sending it to a city the
    // server has never heard of. The temple would be refused on its
    // merits and dropped.
    await enqueue(entry('a'))
    await enqueue(entry('b'))
    await enqueue(entry('a', '/api/x/again'))
    expect((await pending()).map((item) => item.key)).toEqual(['a', 'b'])
    expect((await pending())[0].url).toBe('/api/x/again')
  })

  it('keeps the time the first version was queued', async () => {
    // What the banner reports as "waiting since". Correcting a typo does
    // not make a write that has been stuck for an hour a new write.
    // Only the clock: faking the timers as well stalls the IndexedDB
    // shim, which waits on them.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-04-13T09:00:00Z'))
      await enqueue(entry('a'))
      vi.setSystemTime(new Date('2026-04-13T10:00:00Z'))
      await enqueue(entry('a', '/api/x/again'))
      expect((await pending())[0].queuedAt).toBe(Date.parse('2026-04-13T09:00:00Z'))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a write landing on one already queued', () => {
  const create = (key: string) =>
    ({ key, method: 'PUT', url: `/api/x/${key}`, body: { name: 'Kyoto' }, creates: true }) as const

  it('folds an edit into the create rather than replacing it', async () => {
    // Add a place in a tunnel, then shorten the visit before surfacing.
    // Replacing would send a PATCH to a row the server was never told
    // about, and the place would be lost with the queue reporting success
    // for everything it did send.
    await enqueue(create('place:1'))
    await enqueue({ key: 'place:1', method: 'PATCH', url: '/api/x/place:1', body: { visit_minutes: 30 } })

    const queue = await pending()
    expect(queue).toHaveLength(1)
    expect(queue[0].method).toBe('PUT')
    expect(queue[0].creates).toBe(true)
    expect(queue[0].body).toEqual({ name: 'Kyoto', visit_minutes: 30 })
  })

  it('folds two edits together instead of keeping only the last', async () => {
    // Move a place to another city, then shorten its visit. These are two
    // calls with two different field sets: keeping only the second used to
    // throw the first away, and the city silently came back at the next sync.
    const url = '/api/x/place:1'
    await enqueue({ key: 'place:1', method: 'PATCH', url, body: { stop_id: 'kyoto' } })
    await enqueue({ key: 'place:1', method: 'PATCH', url, body: { visit_minutes: 30 } })

    const queue = await pending()
    expect(queue).toHaveLength(1)
    expect(queue[0].body).toEqual({ stop_id: 'kyoto', visit_minutes: 30 })
  })

  it('cancels a queued create rather than deleting what was never created', async () => {
    await enqueue(create('place:1'))
    await enqueue({ key: 'place:1', method: 'DELETE', url: '/api/x/place:1' })
    expect(await pending()).toEqual([])
  })

  it('still queues a deletion of something the server does have', async () => {
    await enqueue({ key: 'place:1', method: 'PATCH', url: '/api/x/place:1', body: { name: 'x' } })
    await enqueue({ key: 'place:1', method: 'DELETE', url: '/api/x/place:1' })

    const queue = await pending()
    expect(queue).toHaveLength(1)
    expect(queue[0].method).toBe('DELETE')
  })

  it('tells anyone watching, with the new count already readable', async () => {
    // The order is the point. `useSyncExternalStore` reads the count the
    // instant it is told something changed, so a count updated after the
    // announcement is a count React never sees: the banner stayed silent
    // about the first write queued in a tunnel, then reported it one
    // write late.
    const seen = vi.fn(() => expect(size()).toBe(1))
    const stop = subscribe(seen)
    await enqueue(entry('a'))
    expect(seen).toHaveBeenCalled()
    expect(size()).toBe(1)
    stop()
  })

  it('counts what an earlier session left behind', async () => {
    // The app reopened after a flight. Nothing has been enqueued in this
    // session, so the count can only come from reading the store — and
    // until it does, the banner says everything has been sent when three
    // days of expenses have not.
    await set('outbox-v1', [entry('a'), entry('b')])
    expect(await pending()).toHaveLength(2)
    expect(size()).toBe(2)
  })

  it('counts back down as the queue drains', async () => {
    await enqueue(entry('a'))
    await enqueue(entry('b'))
    expect(size()).toBe(2)
    await flush(async () => {}, isNetworkFailure)
    expect(size()).toBe(0)
    expect(await count()).toBe(0)
  })
})

describe('draining the queue', () => {
  it('sends everything and empties itself', async () => {
    await enqueue(entry('a'))
    await enqueue(entry('b'))

    const sent: string[] = []
    const result = await flush(async (item) => {
      sent.push(item.key)
    }, isNetworkFailure)

    expect(sent).toEqual(['a', 'b'])
    expect(result).toEqual({ sent: 2, failed: 0, remaining: 0 })
    expect(await count()).toBe(0)
  })

  it('stops at the first network failure and keeps the rest', async () => {
    // If one request failed for want of a network the next twenty will
    // too, and hammering a sleeping server helps nobody.
    await enqueue(entry('a'))
    await enqueue(entry('b'))
    await enqueue(entry('c'))

    let calls = 0
    const result = await flush(async () => {
      calls += 1
      if (calls === 2) throw new Offline()
    }, isNetworkFailure)

    expect(result.sent).toBe(1)
    expect(result.remaining).toBe(2)
    expect((await pending()).map((item) => item.key)).toEqual(['b', 'c'])
  })

  it('drops a write the server refuses, rather than blocking behind it', async () => {
    // Replaying a rejected write forever would wedge the queue behind
    // something that can never succeed.
    await enqueue(entry('bad'))
    await enqueue(entry('good'))

    const sent: string[] = []
    const result = await flush(async (item) => {
      if (item.key === 'bad') throw new Error('422')
      sent.push(item.key)
    }, isNetworkFailure)

    expect(result).toEqual({ sent: 1, failed: 1, remaining: 0 })
    expect(sent).toEqual(['good'])
    expect(await count()).toBe(0)
  })

  it('sends in order, because a later write can depend on an earlier one', async () => {
    await enqueue(entry('create'))
    await enqueue(entry('edit'))
    const order: string[] = []
    await flush(async (item) => {
      order.push(item.key)
    }, isNetworkFailure)
    expect(order).toEqual(['create', 'edit'])
  })

  it('does nothing gracefully when there is nothing queued', async () => {
    const result = await flush(async () => {}, isNetworkFailure)
    expect(result).toEqual({ sent: 0, failed: 0, remaining: 0 })
  })

  it('survives being drained twice at once', async () => {
    await enqueue(entry('a'))
    const [first, second] = await Promise.all([
      flush(async () => {}, isNetworkFailure),
      flush(async () => {}, isNetworkFailure),
    ])
    // Between them the write goes out; what matters is the queue ends empty
    // and neither call throws.
    expect(first.sent + second.sent).toBeGreaterThanOrEqual(1)
    expect(await count()).toBe(0)
  })
})
