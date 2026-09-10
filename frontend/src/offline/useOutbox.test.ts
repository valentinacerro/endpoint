import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/client'
import { shouldKeep } from './useOutbox'

describe('deciding whether a queued write survives a failure', () => {
  it('keeps it when there is no network', () => {
    expect(shouldKeep(new ApiError(0, 'offline', 'x'))).toBe(true)
    expect(shouldKeep(new ApiError(0, 'network_error', 'x'))).toBe(true)
  })

  it('keeps it while the free server is waking up', () => {
    expect(shouldKeep(new ApiError(503, 'http_error', 'x'))).toBe(true)
  })

  it('keeps it when the session has lapsed', () => {
    // A token expiring is a formality; dropping a recorded expense over it
    // would lose real data.
    expect(shouldKeep(new ApiError(401, 'unauthenticated', 'x'))).toBe(true)
  })

  it('keeps it when rate limited', () => {
    expect(shouldKeep(new ApiError(429, 'rate_limited', 'x'))).toBe(true)
  })

  it('drops it when the server refuses it on the merits', () => {
    // Replaying this forever would wedge everything behind it.
    expect(shouldKeep(new ApiError(422, 'validation_error', 'x'))).toBe(false)
    expect(shouldKeep(new ApiError(404, 'not_found', 'x'))).toBe(false)
  })

  it('drops anything that is not an API error at all', () => {
    expect(shouldKeep(new TypeError('boom'))).toBe(false)
  })
})
