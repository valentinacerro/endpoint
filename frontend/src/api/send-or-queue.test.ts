import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clear, pending } from '../offline/outbox'

import { sendOrQueue } from './trips'

/**
 * The seam between a write and the queue.
 *
 * Every write in the app that survives a tunnel goes through this one
 * function, and what it has to get right is a three-way split: send it,
 * keep it, or give up on it. Getting the third confused with the second is
 * how a queue wedges; getting the second confused with the third is how a
 * place typed underground disappears.
 *
 * Driven against a fake server rather than a mocked `apiFetch`, so the
 * rule being tested is the one that runs in the app — including which
 * failures `apiFetch` reports as network failures in the first place.
 */

function server(answer: Response | Error) {
  const calls: Array<{ url: string; method: string; body: string | null }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: (init?.method ?? 'GET').toUpperCase(),
        body: (init?.body as string) ?? null,
      })
      if (answer instanceof Error) throw answer
      return answer.clone()
    }),
  )
  return calls
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const put = { key: 'place:1', method: 'PUT', url: '/api/trips/t/places/1', body: { name: 'Kyoto' } } as const

beforeEach(async () => {
  await clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sending a write, or keeping it', () => {
  it('sends it and queues nothing when the server answers', async () => {
    const calls = server(ok({ id: '1', name: 'Kyoto' }))

    const result = await sendOrQueue<{ name: string }>(put, () => {
      throw new Error('the guess must not be used when the server answered')
    })

    expect(result.name).toBe('Kyoto')
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toContain('/api/trips/t/places/1')
    expect(await pending()).toEqual([])
  })

  it('queues it and hands back the guess when there is no network', async () => {
    server(new TypeError('Failed to fetch'))

    const result = await sendOrQueue<{ name: string }>({ ...put, creates: true }, () => ({
      name: 'Kyoto',
    }))

    // The screen carries on as though it had landed, because it will.
    expect(result.name).toBe('Kyoto')
    const queue = await pending()
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      key: 'place:1',
      method: 'PUT',
      url: '/api/trips/t/places/1',
      body: { name: 'Kyoto' },
      creates: true,
    })
  })

  it('carries `creates` through, so a later deletion can cancel it', async () => {
    // The flag is the whole difference between "remove this place" and
    // "never mind" — and it is set here, at the only place that knows.
    server(new TypeError('Failed to fetch'))
    await sendOrQueue({ ...put, creates: true }, () => null)
    expect((await pending())[0].creates).toBe(true)

    await clear()
    await sendOrQueue(put, () => null)
    expect((await pending())[0].creates).toBeFalsy()
  })

  it('throws and queues nothing when the server refused it on the merits', async () => {
    // A 422 replayed forever would sit at the head of the queue and block
    // everything behind it. The caller sees the failure instead.
    server(
      new Response(JSON.stringify({ error: { code: 'invalid', message: 'no' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(sendOrQueue(put, () => null)).rejects.toThrow()
    expect(await pending()).toEqual([])
  })

  it('queues it when the session lapsed, which is not the write being wrong', async () => {
    // Losing a coffee you recorded because a token expired would be
    // losing real data over a formality.
    server(
      new Response(JSON.stringify({ error: { code: 'unauthenticated', message: '' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await sendOrQueue(put, () => null)
    expect(await pending()).toHaveLength(1)
  })

  // The waking-server case — Render's gateway answering 502 for up to a
  // minute and a half — is not here on purpose: `apiFetch` retries it with
  // a real backoff, so proving it needs the fake clock that
  // `client.test.ts` already drives it with.
})
