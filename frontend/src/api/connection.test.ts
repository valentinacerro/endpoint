import { describe, expect, it, vi } from 'vitest'

import { createConnection, type ConnectionDeps } from './connection'

/**
 * The bug this guards against was reported in one sentence: "it says
 * offline even though my phone is on wifi". The machine below is driven
 * with a fake clock and a fake server, so every path that used to leave
 * that word on screen can be walked and watched.
 */

function harness(over: Partial<ConnectionDeps> = {}) {
  vi.useFakeTimers()
  const server = { up: false, asked: 0 }
  const deps: ConnectionDeps = {
    isOnline: () => true,
    isVisible: () => true,
    probe: async () => {
      server.asked += 1
      return server.up
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    probeEveryMs: 20_000,
    ...over,
  }
  const connection = createConnection(deps)
  const seen: string[] = []
  connection.subscribe(() => seen.push(connection.get()))
  return { connection, server, seen }
}

/** Let the probe's promise settle. */
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('naming the failure', () => {
  it('says offline only when the browser says there is no network', () => {
    const { connection } = harness({ isOnline: () => false })
    connection.failed()
    expect(connection.get()).toBe('offline')
  })

  it('says unreachable when the network is there and the server is not', () => {
    // The wifi case. This used to read "offline".
    const { connection } = harness({ isOnline: () => true })
    connection.failed()
    expect(connection.get()).toBe('unreachable')
  })

  it('does not tell listeners about a state that has not changed', () => {
    const { connection, seen } = harness()
    connection.online()
    connection.online()
    expect(seen).toEqual(['online'])
  })
})

describe('healing on its own', () => {
  it('asks the server again after the interval, and recovers when it answers', async () => {
    const { connection, server } = harness()
    connection.failed()
    expect(connection.get()).toBe('unreachable')

    server.up = true
    await vi.advanceTimersByTimeAsync(20_000)
    expect(server.asked).toBe(1)
    expect(connection.get()).toBe('online')
  })

  it('keeps asking while the server stays down, once per interval', async () => {
    const { connection, server } = harness()
    connection.failed()

    await vi.advanceTimersByTimeAsync(20_000)
    await vi.advanceTimersByTimeAsync(20_000)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(server.asked).toBe(3)
    expect(connection.get()).toBe('unreachable')
  })

  it('stops asking once it is online', async () => {
    const { connection, server } = harness()
    connection.failed()
    server.up = true
    await vi.advanceTimersByTimeAsync(20_000)
    expect(connection.get()).toBe('online')

    await vi.advanceTimersByTimeAsync(120_000)
    expect(server.asked).toBe(1)
  })

  it('cancels the pending probe when an ordinary request gets through first', async () => {
    // Degraded, timer armed — then the user taps something and that
    // request succeeds. The scheduled probe must not fire afterwards.
    const { connection, server } = harness()
    connection.failed()
    await vi.advanceTimersByTimeAsync(5_000)

    connection.online()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(server.asked).toBe(0)
  })

  it('does not probe from a tab nobody is looking at, but resumes when they do', async () => {
    let visible = false
    const { connection, server } = harness({ isVisible: () => visible })
    connection.failed()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(server.asked).toBe(0)

    visible = true
    server.up = true
    connection.becameVisible()
    await settle()
    expect(server.asked).toBe(1)
    expect(connection.get()).toBe('online')
  })

  it('asks at once when the network comes back', async () => {
    let online = false
    const { connection, server } = harness({ isOnline: () => online })
    connection.failed()
    expect(connection.get()).toBe('offline')

    online = true
    server.up = true
    connection.networkReturned()
    await settle()
    expect(server.asked).toBe(1)
    expect(connection.get()).toBe('online')
  })

  it('moves from offline to unreachable when the network is back but the server is not', async () => {
    let online = false
    const { connection, server } = harness({ isOnline: () => online })
    connection.failed()

    online = true
    connection.networkReturned()
    await settle()
    expect(server.asked).toBe(1)
    expect(connection.get()).toBe('unreachable')
  })

  it('does not stack probes when asked twice at once', async () => {
    const { connection, server } = harness({
      // A probe that takes a while, so two can overlap.
      probe: async () => {
        server.asked += 1
        await new Promise((resolve) => setTimeout(resolve, 5_000))
        return false
      },
    })
    connection.failed()
    connection.becameVisible()
    connection.becameVisible()
    connection.becameVisible()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(server.asked).toBe(1)
  })

  it('a probe that throws counts as a failure, not a crash', async () => {
    const { connection } = harness({
      probe: async () => {
        throw new Error('boom')
      },
    })
    connection.failed()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(connection.get()).toBe('unreachable')
  })
})
