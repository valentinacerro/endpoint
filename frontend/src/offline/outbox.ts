/**
 * Writes that could not be sent yet.
 *
 * You record a coffee in a station with no signal. The write goes here, the
 * app carries on as though it succeeded, and the queue drains when there is
 * a network again.
 *
 * Only idempotent writes are allowed in. A queued request may be replayed
 * after its response was lost in a tunnel, so it has to be safe to send
 * twice — which is exactly why expenses and day notes are addressed by an
 * id the client chose and written with PUT rather than POST.
 */

import { get, set } from 'idb-keyval'

const KEY = 'outbox-v1'

export interface QueuedWrite {
  /** Chosen by the caller; a second write to the same key replaces the first. */
  key: string
  method: 'PUT' | 'PATCH' | 'DELETE'
  url: string
  body?: unknown
  queuedAt: number
  attempts: number
  lastError?: string
}

const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(): void {
  listeners.forEach((listener) => listener())
}

async function read(): Promise<QueuedWrite[]> {
  try {
    return (await get<QueuedWrite[]>(KEY)) ?? []
  } catch {
    // A browser with storage blocked should degrade to "online only", not
    // to a crash on every write.
    return []
  }
}

async function write(queue: QueuedWrite[]): Promise<void> {
  try {
    await set(KEY, queue)
  } catch {
    // Nothing useful to do: the write is already lost, and throwing here
    // would lose the user's typing as well.
  }
  announce()
}

export async function pending(): Promise<QueuedWrite[]> {
  return read()
}

export async function count(): Promise<number> {
  return (await read()).length
}

/**
 * Add a write to the queue, replacing any earlier one with the same key.
 *
 * Editing the same expense three times offline should send one request,
 * not three — and the last version is the one that matters.
 */
export async function enqueue(
  entry: Omit<QueuedWrite, 'queuedAt' | 'attempts'>,
): Promise<void> {
  const queue = await read()
  const without = queue.filter((item) => item.key !== entry.key)
  await write([...without, { ...entry, queuedAt: Date.now(), attempts: 0 }])
}

export async function clear(): Promise<void> {
  await write([])
}

export interface FlushResult {
  sent: number
  failed: number
  remaining: number
}

export type Sender = (entry: QueuedWrite) => Promise<void>

/**
 * Send everything, oldest first, and stop at the first network failure.
 *
 * In order because a later write may depend on an earlier one — editing an
 * expense that has not been created yet would 404. Stopping rather than
 * carrying on because if one request failed for want of a network, the
 * next twenty will too, and hammering a sleeping server helps nobody.
 *
 * A write the server actively rejects is a different matter: replaying it
 * forever would block the queue behind something that can never succeed,
 * so it is dropped and reported.
 */
export async function flush(
  send: Sender,
  isNetworkFailure: (error: unknown) => boolean,
): Promise<FlushResult> {
  let queue = await read()
  let sent = 0
  let failed = 0

  while (queue.length > 0) {
    const [next, ...rest] = queue
    try {
      await send(next)
      sent += 1
      queue = rest
      await write(queue)
    } catch (error) {
      if (isNetworkFailure(error)) break
      // Rejected on its merits: drop it rather than block everything behind it.
      failed += 1
      queue = rest
      await write(queue)
    }
  }

  return { sent, failed, remaining: queue.length }
}
