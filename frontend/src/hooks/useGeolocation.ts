import { useCallback, useState } from 'react'

import type { Point } from '../lib/geo'

/**
 * Where the phone thinks it is.
 *
 * Asked for on demand and never watched continuously. `watchPosition`
 * would keep the GPS warm and eat a battery you cannot easily charge on a
 * train — and the question this answers ("what is near me?") is one you
 * ask at a moment, not one that needs answering every second.
 *
 * Nothing here is sent anywhere. The coordinates go into a distance
 * calculation in this tab and are gone when the screen closes.
 */
export type Located =
  | { state: 'idle' }
  | { state: 'locating' }
  | { state: 'ready'; point: Point; accuracyM: number; at: number }
  /** The permission was refused, and asking again will not help. */
  | { state: 'denied' }
  /** No geolocation at all: an old browser, or a page not served over https. */
  | { state: 'unavailable' }
  /** It tried and could not — indoors, underground, or it simply timed out. */
  | { state: 'failed' }

/** Long enough for a cold GPS fix indoors, short enough not to feel hung. */
const TIMEOUT_MS = 15_000

/**
 * A fix from the last half minute is good enough and costs nothing.
 * Walking half a minute moves you forty metres, which does not change
 * which temple is nearest.
 */
const ACCEPTABLE_AGE_MS = 30_000

export function useGeolocation() {
  const [located, setLocated] = useState<Located>({ state: 'idle' })

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocated({ state: 'unavailable' })
      return
    }

    setLocated({ state: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setLocated({
          state: 'ready',
          point: { lat: position.coords.latitude, lon: position.coords.longitude },
          accuracyM: position.coords.accuracy,
          at: position.timestamp,
        }),
      (error) =>
        // Refusal is worth telling apart from failure: one is a setting
        // the reader can change, the other is a wall they should step
        // outside of.
        setLocated({ state: error.code === error.PERMISSION_DENIED ? 'denied' : 'failed' }),
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: ACCEPTABLE_AGE_MS },
    )
  }, [])

  return { located, locate }
}
