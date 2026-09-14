import { describe, expect, it } from 'vitest'

import { ApiError } from './client'
import { shouldKeep } from '../offline/useOutbox'

/**
 * Which failures are worth keeping a write for.
 *
 * This is the rule the whole offline promise rests on, and it has two
 * ways to be wrong in opposite directions. Too strict and a place moved
 * underground is lost. Too loose and a write the server has genuinely
 * rejected sits at the head of the queue forever, blocking everything
 * behind it — the failure that is much harder to notice, because nothing
 * appears broken until a day's worth of expenses have piled up behind a
 * malformed one.
 */

describe('keeping a write that could not be sent', () => {
  const failure = (code: string, status = 0) => new ApiError(status, code, code)

  it('keeps it when there is no network', () => {
    expect(shouldKeep(failure('offline'))).toBe(true)
    expect(shouldKeep(failure('network_error'))).toBe(true)
  })

  it('keeps it while the free server is waking or busy', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(shouldKeep(new ApiError(status, 'server_error', '')), String(status)).toBe(true)
    }
    expect(shouldKeep(new ApiError(429, 'rate_limited', ''))).toBe(true)
  })

  it('keeps it when the session lapsed, which is not the write being wrong', () => {
    // Dropping a queued expense because a token expired would lose real
    // data over a formality.
    expect(shouldKeep(new ApiError(401, 'unauthenticated', ''))).toBe(true)
  })

  it('drops it when the server refused it on the merits', () => {
    // These would be refused again forever and would wedge the queue.
    for (const status of [400, 404, 409, 422]) {
      expect(shouldKeep(new ApiError(status, 'invalid', '')), String(status)).toBe(false)
    }
  })

  it('drops anything that is not an ApiError at all', () => {
    expect(shouldKeep(new TypeError('boom'))).toBe(false)
    expect(shouldKeep(undefined)).toBe(false)
  })
})
