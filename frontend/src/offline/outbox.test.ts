import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clear, count, enqueue, flush, pending, subscribe } from './outbox'

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

  it('moves a replaced write to the back', async () => {
    await enqueue(entry('a'))
    await enqueue(entry('b'))
    await enqueue(entry('a'))
    expect((await pending()).map((item) => item.key)).toEqual(['b', 'a'])
  })

  it('tells anyone watching', async () => {
    const seen = vi.fn()
    const stop = subscribe(seen)
    await enqueue(entry('a'))
    expect(seen).toHaveBeenCalled()
    stop()
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
