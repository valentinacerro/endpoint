/**
 * What the app believes about the network, and how it changes its mind.
 *
 * There used to be one word, "offline", for two different situations:
 * the phone having no network, and the server not answering. They call
 * for different reactions — one is yours to fix, the other is not — and
 * conflating them produced the app's most confusing moment: a bar saying
 * "offline" on a phone plainly connected to wifi, because a write had
 * timed out while the free server was still waking up.
 *
 * Worse, that state was sticky. Nothing changed it except the next
 * request, and reading an itinerary already in cache makes none. So the
 * lie stood for as long as you looked at the screen.
 *
 * Two changes. The failure is named for what it is — `offline` only when
 * the browser itself says there is no network, `unreachable` otherwise —
 * and a degraded state heals on its own: while the app is on screen it
 * asks the server every twenty seconds whether it is back, and asks at
 * once when the network returns or the app comes to the foreground.
 *
 * Built as a factory so the whole machine can be driven by a test with a
 * fake clock and a fake server. `client.ts` builds the one real instance.
 */

export type ConnectionState =
  /** Nothing has been tried yet, or the network just came back. */
  | 'unknown'
  | 'online'
  /** The gateway answered for a server that is still starting. */
  | 'waking'
  /** The network is there; the server is not answering on it. */
  | 'unreachable'
  /** The browser reports no network at all. */
  | 'offline'

export interface ConnectionDeps {
  /** `navigator.onLine`, or a stand-in. */
  isOnline: () => boolean
  /** Is the app on screen? A probe from a background tab is wasted. */
  isVisible: () => boolean
  /** One attempt to reach the server. Resolves to whether it answered. */
  probe: () => Promise<boolean>
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  /** How long to wait between probes while degraded. */
  probeEveryMs?: number
}

export interface Connection {
  get(): ConnectionState
  subscribe(listener: () => void): () => void
  /** A response arrived, whatever its status. */
  online(): void
  /** The gateway said the application behind it is not up yet. */
  waking(): void
  /** A request failed without any response. Decides which failure. */
  failed(): void
  /** The browser's `online` event: the network is back, so ask. */
  networkReturned(): void
  /** The browser's `offline` event. */
  networkLost(): void
  /** The tab became visible; a degraded state gets checked at once. */
  becameVisible(): void
}

const DEFAULT_PROBE_MS = 20_000

export function createConnection(deps: ConnectionDeps): Connection {
  const every = deps.probeEveryMs ?? DEFAULT_PROBE_MS
  let state: ConnectionState = 'unknown'
  const listeners = new Set<() => void>()
  let timer: unknown = null
  let probing = false

  function set(next: ConnectionState): void {
    if (next === state) return
    state = next
    listeners.forEach((listener) => listener())
    if (next === 'unreachable' || next === 'offline') arm()
    else disarm()
  }

  function disarm(): void {
    if (timer !== null) deps.clearTimeout(timer)
    timer = null
  }

  /** Try again later — but only while there is a reason to. */
  function arm(): void {
    disarm()
    timer = deps.setTimeout(() => {
      timer = null
      void probeNow()
    }, every)
  }

  async function probeNow(): Promise<void> {
    if (probing) return
    if (!deps.isVisible()) {
      // Not looking: come back when something changes, do not burn the
      // battery asking on nobody's behalf.
      arm()
      return
    }
    probing = true
    try {
      const answered = await deps.probe()
      if (answered) set('online')
      else failed()
    } catch {
      failed()
    } finally {
      probing = false
    }
  }

  function failed(): void {
    if (!deps.isOnline()) {
      set('offline')
      return
    }
    // Already degraded and still degraded: `set` would not notify, and
    // the timer would not be re-armed. Do it by hand.
    if (state === 'unreachable') arm()
    else set('unreachable')
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    online: () => set('online'),
    waking: () => set('waking'),
    failed,
    networkReturned() {
      // "unknown" rather than "online": the network is back but the
      // server has not been heard from yet — and asked, right now.
      set('unknown')
      void probeNow()
    },
    networkLost: () => set('offline'),
    becameVisible() {
      if (state === 'unreachable' || state === 'offline') void probeNow()
    },
  }
}
