/**
 * Persists the TanStack Query cache to IndexedDB.
 *
 * This is what lets the app open already full of data in airplane mode: the UI
 * always reads from here, and the network is only a background refresh.
 */

import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'

export const persister = createAsyncStoragePersister({
  key: 'trips-query-cache',
  throttleTime: 1_000,
  storage: {
    getItem: (key) => get<string>(key).then((value) => value ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
})

/**
 * Ask the browser not to evict our data under storage pressure.
 *
 * Chrome grants this more readily to an installed PWA, so we call it after the
 * first successful sign-in rather than on first launch.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
