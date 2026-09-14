import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiFetch, getConnection, warmUp } from './client'

/**
 * The request loop, driven against a server that behaves like the real
 * one.
 *
 * This existed nowhere, and it is the half that was actually reported as
 * broken: `connection.test.ts` proves the state machine is right when it
 * is told the truth, and says nothing about whether `apiFetch` tells it
 * the truth. The distinction matters because the bug — a phone on wifi
 * being told it was offline — lived in exactly that seam.
 *
 * Render's free tier is what these cases are drawn from: the instance
 * sleeps after fifteen minutes and its gateway answers 502/503 for up to
 * a minute and a half while it gets up.
 */

/** A fetch that answers from a script, one entry per call. */
function server(...answers: Array<Response | Error | 'hang'>) {
  const calls: Array<{ url: string; method: string }> = []
  let at = 0
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase() })
    const answer = answers[Math.min(at, answers.length - 1)]
    at += 1
    if (answer === 'hang') return await new Promise<Response>(() => {})
    if (answer instanceof Error) throw answer
    return answer
  })
  vi.stubGlobal('fetch', fake)
  return calls
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const gateway = (status: number) => new Response('', { status })

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  setOnline(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a server that is only waking up', () => {
  it('is called waking, not offline, and the request still succeeds', async () => {
    // The whole reason apiFetch retries at all. Two gateway errors then
    // the real answer — a perfectly ordinary cold start.
    server(gateway(503), gateway(502), ok({ authenticated: true }))

    const request = apiFetch<{ authenticated: boolean }>('/api/auth/me')
    await vi.advanceTimersByTimeAsync(0)
    expect(getConnection()).toBe('waking')

    await vi.advanceTimersByTimeAsync(5_000)
    await expect(request).resolves.toEqual({ authenticated: true })
    expect(getConnection()).toBe('online')
  })

  it('backs off between attempts instead of hammering', async () => {
    const calls = server(gateway(503), gateway(503), ok({}))
    const request = apiFetch('/api/auth/me')

    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    // First backoff is a second; nothing may go out before it elapses.
    await vi.advanceTimersByTimeAsync(900)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(5_000)
    await request
  })
})

describe('a phone with no network', () => {
  it('says offline, and says it as an error the app can branch on', async () => {
    setOnline(false)
    server(new TypeError('Failed to fetch'))

    // The handler is attached before the clock moves: this one rejects
    // on the first attempt, and a promise left bare for even a tick is an
    // unhandled rejection rather than a test.
    const caught = apiFetch('/api/auth/me').catch((error: ApiError) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect((await caught).code).toBe('offline')
    expect(getConnection()).toBe('offline')
  })

  it('does not retry, because there is nothing to retry against', async () => {
    setOnline(false)
    const calls = server(new TypeError('Failed to fetch'))
    await expect(apiFetch('/api/auth/me')).rejects.toBeInstanceOf(ApiError)
    expect(calls).toHaveLength(1)
  })
})

describe('a phone on wifi and a server that will not answer', () => {
  it('is called unreachable, never offline — the bug as reported', async () => {
    // A write, so there are no retries and no backoff to time around:
    // the state is read at the instant the request gives up.
    //
    // This is not fastidiousness. Written with a GET and two minutes on
    // the clock, this test passed even with the failure reported as
    // `networkLost()` — because the self-healing probe corrects the wrong
    // state within twenty seconds, so the assertion was reading the
    // patient after the recovery. Sabotage found it; the fix is to look
    // at the moment that was wrong.
    setOnline(true)
    server(new TypeError('Failed to fetch'))

    const caught = apiFetch('/api/trips', { method: 'POST', body: {} }).catch(
      (error: ApiError) => error,
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(getConnection()).toBe('unreachable')
    expect((await caught).code).toBe('network_error')
  })

  it('is still unreachable after a read has exhausted its retries', async () => {
    setOnline(true)
    server(new TypeError('Failed to fetch'))

    const caught = apiFetch('/api/auth/me').catch((error: ApiError) => error)
    // Exactly the sum of the backoffs — 1 + 3 + 8 + 20 + 30 seconds — so
    // the clock stops before the twenty-second healing probe can fire and
    // paper over what the request loop actually said.
    await vi.advanceTimersByTimeAsync(62_000)

    expect(getConnection()).toBe('unreachable')
    expect((await caught).code).toBe('network_error')
  })

  it('recovers on its own once the server comes back', async () => {
    setOnline(true)
    server(new TypeError('Failed to fetch'))
    const failing = apiFetch('/api/auth/me').catch(() => null)
    await vi.advanceTimersByTimeAsync(120_000)
    await failing
    expect(getConnection()).toBe('unreachable')

    // The next thing that gets through is enough; nothing has to be
    // tapped, and the banner clears itself.
    server(ok({}))
    await apiFetch('/api/auth/me')
    expect(getConnection()).toBe('online')
  })
})

describe('what may and may not be repeated', () => {
  it('never repeats a write, because the first one may have landed', async () => {
    const calls = server(new TypeError('Failed to fetch'))
    const request = apiFetch('/api/trips', { method: 'POST', body: { title: 'Giappone' } })
    const caught = request.catch(() => null)
    await vi.advanceTimersByTimeAsync(120_000)
    await caught
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('sends a body as JSON, and lets the browser own a file upload', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init ?? {})
        return ok({})
      }),
    )
    await apiFetch('/api/trips', { method: 'POST', body: { title: 'x' } })
    expect((seen[0].headers as Record<string, string>)['Content-Type']).toBe('application/json')

    const form = new FormData()
    await apiFetch('/api/upload', { method: 'POST', body: form })
    // Setting it ourselves would omit the boundary and the server could
    // not parse the request at all.
    expect(seen[1].headers).toBeUndefined()
  })
})

describe('the warm-up ping', () => {
  it('reports waking immediately and online once the server answers', async () => {
    server(ok({ status: 'ok' }))
    warmUp()
    expect(getConnection()).toBe('waking')
    await vi.advanceTimersByTimeAsync(0)
    expect(getConnection()).toBe('online')
  })

  it('asks /health, which the service worker must not intercept', async () => {
    const calls = server(ok({ status: 'ok' }))
    warmUp()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls[0].url).toBe('/health')
  })
})
