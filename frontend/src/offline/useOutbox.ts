import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { ApiError, apiFetch } from '../api/client'
import { count, flush, subscribe, type QueuedWrite } from './outbox'

/**
 * Is this worth keeping the write for?
 *
 * True for anything that might succeed later: no network, a server still
 * waking, a 5xx — and a 401, which means the session lapsed rather than
 * that the write was wrong. Dropping a queued expense because a token
 * expired would lose real data over a formality.
 *
 * False for a rejection on the merits, which will be rejected again
 * forever and would otherwise wedge the whole queue behind it.
 */
export function shouldKeep(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.code === 'offline' || error.code === 'network_error') return true
  return error.status === 401 || error.status === 429 || error.status >= 500
}

async function sendOne(entry: QueuedWrite): Promise<void> {
  await apiFetch(entry.url, { method: entry.method, body: entry.body })
}

/** A snapshot of the queue length that React can subscribe to. */
let cached = 0
void count().then((value) => {
  cached = value
})
subscribe(() => {
  void count().then((value) => {
    cached = value
  })
})

function snapshot(): number {
  return cached
}

/**
 * The pending queue, and a way to drain it.
 *
 * Draining happens on its own when the browser reports it is back online
 * and once at startup, because the interesting case is the app being
 * reopened after a flight rather than someone remembering to press a
 * button.
 */
export function useOutbox() {
  const queryClient = useQueryClient()
  const pending = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [flushing, setFlushing] = useState(false)

  const drain = useCallback(async () => {
    if (flushing) return
    setFlushing(true)
    const result = await flush(sendOne, shouldKeep)
    setFlushing(false)
    if (result.sent > 0 || result.failed > 0) {
      // Reconcile against what the server actually stored.
      await queryClient.invalidateQueries()
    }
  }, [flushing, queryClient])

  useEffect(() => {
    void drain()
    const onOnline = () => void drain()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
    // Deliberately once: re-running on every `drain` identity change would
    // reattach the listener on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { pending, flushing, drain }
}
