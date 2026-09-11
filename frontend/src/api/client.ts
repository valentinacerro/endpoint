/**
 * HTTP client for our own backend.
 *
 * Two problems to handle, both consequences of free hosting:
 *  - Render puts the service to sleep after 15 minutes and takes up to a
 *    minute to wake it. A normal timeout would mistake that for a failure.
 *  - The network can be missing entirely (plane, metro, a flaky eSIM).
 */

import { createConnection } from './connection'

/** The service is asleep: Render answers with these while waking it up. */
const GATEWAY_STATUSES = new Set([502, 503, 504])
const WAKE_TIMEOUT_MS = 90_000
const BACKOFF_MS = [1_000, 3_000, 8_000, 20_000, 30_000]

export { type ConnectionState } from './connection'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null

  constructor(status: number, code: string, message: string, field: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

// --- Connection state, observable through useSyncExternalStore ---

/** One attempt to reach the server, used both at start-up and to heal. */
function probe(): Promise<boolean> {
  return fetch('/health', { signal: AbortSignal.timeout(WAKE_TIMEOUT_MS) })
    .then((response) => response.ok)
    .catch(() => false)
}

const connection = createConnection({
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  isVisible: () => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'),
  probe,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
})

export const subscribeConnection = connection.subscribe
export const getConnection = connection.get

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => connection.networkLost())
  window.addEventListener('online', () => connection.networkReturned())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') connection.becameVisible()
  })
}

// --- Requests ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function toApiError(response: Response): Promise<ApiError> {
  let code = 'http_error'
  let message = `Error ${response.status}`
  let field: string | null = null
  try {
    const body = await response.json()
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
      field = body.error.field ?? null
    }
  } catch {
    // Non-JSON response (a proxy error page, say): keep the defaults.
  }
  return new ApiError(response.status, code, message, field)
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options
  const method = (rest.method ?? 'GET').toUpperCase()
  // A file upload must go out as multipart with a boundary the browser
  // generates. Setting Content-Type ourselves would omit the boundary and
  // the server would be unable to parse the request at all.
  const isMultipart = body instanceof FormData
  // A GET can be repeated with no consequences. A POST cannot: if the timeout
  // fires after the server already processed it, repeating would create a
  // duplicate. So we only retry when it is provably safe.
  const isReplayable = method === 'GET' || method === 'HEAD'

  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < BACKOFF_MS.length

    try {
      const response = await fetch(path, {
        ...rest,
        method,
        headers:
          body === undefined || isMultipart
            ? headers
            : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : isMultipart ? body : JSON.stringify(body),
        credentials: 'same-origin',
        signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      })

      // The gateway answered before the application was up, which means the
      // request never reached our code — so retrying is always safe here.
      if (GATEWAY_STATUSES.has(response.status) && canRetry) {
        connection.waking()
        await sleep(BACKOFF_MS[attempt])
        continue
      }

      connection.online()
      if (!response.ok) throw await toApiError(response)
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof ApiError) throw error

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        connection.failed()
        throw new ApiError(0, 'offline', 'No connection')
      }

      if (isReplayable && canRetry) {
        connection.waking()
        await sleep(BACKOFF_MS[attempt])
        continue
      }

      // The network is there and the server did not answer. Named for what
      // it is — and the machine will keep asking on its own from here.
      connection.failed()
      throw new ApiError(0, 'network_error', 'The server is not responding')
    }
  }
}

/**
 * Wake the service without waiting for the answer.
 *
 * Fired at startup, before React even renders: while you read the itinerary
 * already in cache, the server is getting up in the background. This turns
 * most cold starts into a wait nobody notices.
 */
export function warmUp(): void {
  connection.waking()
  void probe().then((answered) => (answered ? connection.online() : connection.failed()))
}
