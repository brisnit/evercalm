import { describe, expect, it } from 'vitest'
import {
  DEMO_SIGN_IN_MAX,
  STRICT_AUTH_RATE_LIMITS,
  authRateLimitRules,
  rateLimitMode,
  shouldRelaxRateLimits,
} from '@/server/auth/rate-limits'

describe('authentication rate limits', () => {
  it('keeps sign-in tightly limited by default', () => {
    const rules = authRateLimitRules('strict')
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
    const relaxed = authRateLimitRules('relaxed')
    for (const [path, rule] of Object.entries(STRICT_AUTH_RATE_LIMITS)) {
      expect(relaxed[path]?.window).toBe(rule.window)
      expect(relaxed[path]?.max).toBeGreaterThan(rule.max)
    }
  })

  it('gives the stakeholder demo 20 sign-in attempts a minute, and nothing else', () => {
    const demo = authRateLimitRules('stakeholder-demo')
    expect(demo['/sign-in/email']).toEqual({ window: 60, max: DEMO_SIGN_IN_MAX })
    expect(DEMO_SIGN_IN_MAX).toBe(20)
    // Every other credential endpoint stays exactly as production has it.
    for (const [path, rule] of Object.entries(STRICT_AUTH_RATE_LIMITS)) {
      if (path === '/sign-in/email') continue
      expect(demo[path], path).toEqual(rule)
    }
  })
})

describe('which mode a process runs in', () => {
  const strictIn = { nodeEnv: 'production', e2eFlag: undefined }

  it('is strict for customer production, with no environment set', () => {
    expect(rateLimitMode({ ...strictIn, environment: undefined })).toBe('strict')
    expect(
      authRateLimitRules(rateLimitMode({ ...strictIn, environment: undefined }))['/sign-in/email'],
    ).toEqual({ window: 60, max: 5 })
  })

  it('gives the demo allowance ONLY to the exact environment value', () => {
    expect(rateLimitMode({ ...strictIn, environment: 'stakeholder-demo' })).toBe('stakeholder-demo')
  })

  it('cannot be activated by a missing, empty or spoofed environment value', () => {
    const spoofed = [
      undefined,
      '',
      '   ',
      'Stakeholder-Demo',
      'STAKEHOLDER-DEMO',
      ' stakeholder-demo',
      'stakeholder-demo ',
      'stakeholder-demo\n',
      'stakeholder_demo',
      'stakeholder-demo-x',
      'xstakeholder-demo',
      'production',
      'demo',
      'true',
      '1',
      'stakeholder-demo,production',
      '{"EVERCALM_ENVIRONMENT":"stakeholder-demo"}',
    ]
    for (const environment of spoofed) {
      const mode = rateLimitMode({ ...strictIn, environment })
      expect(mode, JSON.stringify(environment)).toBe('strict')
      expect(authRateLimitRules(mode)['/sign-in/email'], JSON.stringify(environment)).toEqual({
        window: 60,
        max: 5,
      })
    }
  })

  it('never lets the browser suite relax production, demo or not', () => {
    for (const environment of [undefined, 'stakeholder-demo']) {
      expect(rateLimitMode({ nodeEnv: 'production', environment, e2eFlag: 'true' })).not.toBe(
        'relaxed',
      )
    }
    expect(rateLimitMode({ nodeEnv: 'development', environment: undefined, e2eFlag: 'true' })).toBe(
      'relaxed',
    )
  })
})
