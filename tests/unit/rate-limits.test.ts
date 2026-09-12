import { describe, expect, it } from 'vitest'
import {
  STRICT_AUTH_RATE_LIMITS,
  authRateLimitRules,
  shouldRelaxRateLimits,
} from '@/server/auth/rate-limits'

describe('authentication rate limits', () => {
  it('keeps sign-in tightly limited by default', () => {
    const rules = authRateLimitRules(false)
    expect(rules['/sign-in/email']).toEqual({ window: 60, max: 5 })
    expect(rules['/forget-password']).toEqual({ window: 60, max: 3 })
  })

  it('covers every credential endpoint', () => {
    expect(Object.keys(STRICT_AUTH_RATE_LIMITS).sort()).toEqual([
      '/forget-password',
      '/reset-password',
      '/sign-in/email',
      '/sign-up/email',
    ])
  })

  it('NEVER relaxes limits in production, whatever the flag says', () => {
    expect(shouldRelaxRateLimits('production', 'true')).toBe(false)
    expect(shouldRelaxRateLimits('production', undefined)).toBe(false)
  })

  it('relaxes outside production only when explicitly asked', () => {
    expect(shouldRelaxRateLimits('development', 'true')).toBe(true)
    expect(shouldRelaxRateLimits('test', 'true')).toBe(true)
    expect(shouldRelaxRateLimits('development', undefined)).toBe(false)
    expect(shouldRelaxRateLimits('development', 'false')).toBe(false)
  })

  it('keeps the same windows when relaxed - only the ceiling moves', () => {
    const relaxed = authRateLimitRules(true)
    for (const [path, rule] of Object.entries(STRICT_AUTH_RATE_LIMITS)) {
      expect(relaxed[path]?.window).toBe(rule.window)
      expect(relaxed[path]?.max).toBeGreaterThan(rule.max)
    }
  })
})
