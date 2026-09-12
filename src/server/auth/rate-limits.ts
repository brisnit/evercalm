/**
 * Authentication rate limits.
 *
 * Kept in their own module with a pure builder so the PRODUCTION values can
 * be asserted by a unit test. End-to-end tests sign in far more often than
 * any real person, so they run with a relaxed window - but relaxing is only
 * possible outside production, and the strict values are test-locked.
 */

export interface RateRule {
  window: number
  max: number
}

export const STRICT_AUTH_RATE_LIMITS = {
  '/sign-in/email': { window: 60, max: 5 },
  '/sign-up/email': { window: 60, max: 5 },
  '/forget-password': { window: 60, max: 3 },
  '/reset-password': { window: 60, max: 5 },
} as const satisfies Record<string, RateRule>

const RELAXED_MAX = 500

export function authRateLimitRules(relaxed: boolean): Record<string, RateRule> {
  if (!relaxed) return { ...STRICT_AUTH_RATE_LIMITS }
  return Object.fromEntries(
    Object.entries(STRICT_AUTH_RATE_LIMITS).map(([path, rule]) => [
      path,
      { window: rule.window, max: RELAXED_MAX },
    ]),
  )
}

/**
 * Relaxation is only ever permitted outside production, and only when
 * explicitly requested. A production deployment cannot opt out, whatever the
 * environment says.
 */
export function shouldRelaxRateLimits(nodeEnv: string, flag: string | undefined): boolean {
  return nodeEnv !== 'production' && flag === 'true'
}
