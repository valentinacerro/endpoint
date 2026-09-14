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
  /** Chosen by the caller; a second write to the same key folds into the first. */
  key: string
  /**
   * `POST` is here for exactly two writes, both of which are idempotent
   * despite the method: applying a plan, which names every place it
   * touches and sets absolute times, and uploading a document, which the
   * server stores under the hash of its bytes and hands back the existing
   * one rather than making a second copy. Nothing else may use it.
   */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /**
   * This write is the only reason the row exists on the server.
   *
   * It changes what a later write on the same key means: deleting
   * something the server was never told about is not a deletion, it is
   * a cancellation, and sending it would ask the server to remove a row
   * it has never heard of.
   */
  creates?: boolean
  url: string
  body?: unknown
  /**
   * A file upload, taken apart so it can be stored.
   *
   * `FormData` is not structured-cloneable, so it cannot go into
   * IndexedDB — but a `File` can, and survives the app being closed. The
   * multipart body is rebuilt from these two at the moment of sending.
   */
  form?: { file: File; fields: Record<string, string> }
  queuedAt: number
  attempts: number
  lastError?: string
}

const listeners = new Set<() => void>()

/**
 * How many writes are waiting, readable without awaiting anything.
 *
 * The queue itself lives in IndexedDB, which can only be read with a
 * promise, and `useSyncExternalStore` needs an answer on the spot. Keeping
 * the length here is what lets the banner say "una modifica da inviare"
 * the moment the write is made: reading it asynchronously inside the
 * change notification meant React re-read the *old* number and saw no
 * change, so the count was always one write behind — and the first write
 * queued in a tunnel was announced by nothing at all.
 */
let known = 0

/** The queue length right now. Zero until the first read finishes. */
export function size(): number {
  return known
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(): void {
  listeners.forEach((listener) => listener())
}

async function read(): Promise<QueuedWrite[]> {
  try {
    const queue = (await get<QueuedWrite[]>(KEY)) ?? []
    known = queue.length
    return queue
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
  // Before the announcement, never after: a subscriber reads the count
  // synchronously the instant it is told something changed.
  known = queue.length
  announce()
}

// What was left in the queue by an earlier session, counted once at
// startup so a reopened app says so before anything else happens.
void read().then(announce)

export async function pending(): Promise<QueuedWrite[]> {
  return read()
}

/** What to actually send: a JSON body, or a multipart one put back together. */
export function payloadOf(entry: QueuedWrite): unknown {
  if (!entry.form) return entry.body
  const form = new FormData()
  form.append('file', entry.form.file)
  for (const [name, value] of Object.entries(entry.form.fields)) form.append(name, value)
  return form
}

export async function count(): Promise<number> {
  return (await read()).length
}

type NewWrite = Omit<QueuedWrite, 'queuedAt' | 'attempts'>

/**
 * What one key should hold, given what is already queued for it.
 *
 * Editing the same expense three times offline should send one request,
 * not three. Replacing outright was enough while everything queued was a
 * whole-object PUT; it stopped being enough the moment a *create* could be
 * queued, because the two writes on a key are then telling different halves
 * of one story.
 *
 * Returning null means the key should hold nothing at all.
 */
function fold(queued: QueuedWrite | undefined, next: NewWrite): NewWrite | null {
  if (!queued) return next

  // Adding a place underground and then thinking better of it. The server
  // was never told, so there is nothing to delete: sending the DELETE would
  // be answered "no such place", and the queue would report a failure for a
  // row that correctly does not exist.
  if (next.method === 'DELETE' && queued.creates) return null

  // An edit on top of a queued write is not a replacement for it. Two
  // separate edits — move it to Kyoto, then shorten the visit — used to
  // send only the second, and the first silently came back at the next
  // sync. On top of a create it was worse: the create itself was dropped
  // and the edit arrived at a row the server did not have.
  if (next.method === 'PATCH' && queued.body !== undefined && !queued.form) {
    return {
      ...queued,
      body: { ...(queued.body as object), ...(next.body as object) },
    }
  }

  return next
}

/** Add a write to the queue, folding it into any earlier one with the same key. */
export async function enqueue(entry: NewWrite): Promise<void> {
  const queue = await read()
  const queued = queue.find((item) => item.key === entry.key)
  const without = queue.filter((item) => item.key !== entry.key)

  const folded = fold(queued, entry)
  if (folded === null) {
    await write(without)
    return
  }
  // Keeps its original place in the line: a write that has been waiting
  // since the tunnel should not go to the back of the queue because it was
  // edited, since what follows it may depend on it having landed.
  const merged = { ...folded, queuedAt: queued?.queuedAt ?? Date.now(), attempts: 0 }
  const at = queued ? queue.findIndex((item) => item.key === entry.key) : without.length
  await write([...without.slice(0, at), merged, ...without.slice(at)])
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
