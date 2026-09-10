/**
 * Keeping travel documents readable without a network.
 *
 * Deliberately explicit rather than implicit. Caching whatever happens to be
 * opened would fail exactly once — at the airport, offline, on the one
 * voucher never opened before leaving. So the app offers a button that
 * downloads them all, and a screen that says which are actually held.
 *
 * The Cache API rather than IndexedDB: it stores `Response` objects natively
 * and hands back a `Blob` in one line. Content is addressed by its sha256,
 * so a cache hit can never be stale.
 */

const CACHE_NAME = 'attachments-v1'

function available(): boolean {
  // Absent in insecure contexts — which is exactly what you get opening the
  // app over a plain LAN address instead of HTTPS.
  return typeof caches !== 'undefined'
}

async function open(): Promise<Cache | null> {
  if (!available()) return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

/** Fetch a document, preferring the local copy. */
export async function fetchDocument(url: string): Promise<Blob> {
  const cache = await open()
  const hit = await cache?.match(url)
  if (hit) return hit.blob()

  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`${response.status}`)
  // Not stored here: opening a document is not the same as choosing to keep
  // it. Pinning is a decision the user makes, and the offline screen has to
  // reflect what was actually decided.
  return response.blob()
}

export async function pin(url: string): Promise<boolean> {
  const cache = await open()
  if (!cache) return false
  try {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) return false
    await cache.put(url, response)
    return true
  } catch {
    return false
  }
}

export async function unpin(url: string): Promise<void> {
  const cache = await open()
  await cache?.delete(url)
}

export async function isPinned(url: string): Promise<boolean> {
  const cache = await open()
  return Boolean(await cache?.match(url))
}

export async function pinnedUrls(): Promise<Set<string>> {
  const cache = await open()
  if (!cache) return new Set()
  const requests = await cache.keys()
  return new Set(requests.map((request) => new URL(request.url).pathname))
}

export interface PinProgress {
  done: number
  total: number
  failed: number
}

/**
 * Download every document of a trip, reporting progress.
 *
 * Sequential on purpose: this runs on hotel wifi the night before leaving,
 * and forty parallel requests to a free instance is a good way to get
 * nothing at all.
 */
export async function pinAll(
  urls: string[],
  onProgress: (progress: PinProgress) => void,
): Promise<PinProgress> {
  let done = 0
  let failed = 0
  for (const url of urls) {
    const ok = await pin(url)
    done += 1
    if (!ok) failed += 1
    onProgress({ done, total: urls.length, failed })
  }
  return { done, total: urls.length, failed }
}

export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const estimate = await navigator.storage.estimate()
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
}
