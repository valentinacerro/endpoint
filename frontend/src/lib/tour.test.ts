import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasSeenTour, rememberTourSeen } from './tour'

/**
 * The first "seen" flag in the codebase, so the thing worth testing is
 * that it fails in the harmless direction: a browser with storage turned
 * off must offer the tour again, never crash the screen it sits on.
 */

describe('remembering the tour', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('has not been seen before it is taken', () => {
    expect(hasSeenTour()).toBe(false)
  })

  it('remembers once it has', () => {
    rememberTourSeen()
    expect(hasSeenTour()).toBe(true)
  })

  it('treats storage being unreadable as not having seen it', () => {
    // Private browsing, or a browser set to block site data. Offering the
    // walk a second time is a far better failure than a blank screen.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
    expect(hasSeenTour()).toBe(false)
  })

  it('does not throw when it cannot write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota')
    })
    expect(() => rememberTourSeen()).not.toThrow()
  })

  it('ignores a value it did not write', () => {
    localStorage.setItem('endpoint.tourSeen', 'perhaps')
    expect(hasSeenTour()).toBe(false)
  })
})
