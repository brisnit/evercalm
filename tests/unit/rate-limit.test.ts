import { beforeEach, describe, expect, it } from 'vitest'
import { rateLimited, resetRateLimits } from '@/server/rate-limit'

describe('rate limiting', () => {
  beforeEach(() => resetRateLimits())

  it('allows up to the limit in a window, then refuses until it resets', () => {
    const limit = { max: 3, windowMs: 60_000 }
    const t = 1_000_000
    expect([1, 2, 3].map(() => rateLimited('export', 'emp-1', limit, t))).toEqual([
      false,
      false,
      false,
    ])
    expect(rateLimited('export', 'emp-1', limit, t + 1)).toBe(true)
    expect(rateLimited('export', 'emp-2', limit, t + 1)).toBe(false)
    expect(rateLimited('export', 'emp-1', limit, t + 60_001)).toBe(false)
  })
})
