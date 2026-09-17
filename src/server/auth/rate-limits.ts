/**
 * Authentication rate limits.
 *
 * Kept in their own module with a pure builder so the PRODUCTION values can
 * be asserted by a unit test. Three modes, and only one of them is the real
 * one:
 *
 *   strict            5 sign-in attempts a minute per IP. Production, and
 *                     anything that has not deliberately asked otherwise.
 *   stakeholder-demo  20 a minute, because a room of reviewers behind one
 *                     office IP signing into demo accounts in turn is not an
 *                     attack. Only ever the demo: it is keyed on the exact
 *                     value "stakeholder-demo", which is itself a validated
 *                     enum in lib/env.ts, so a misspelled, empty or
 *                     attacker-supplied value cannot reach this at all.
 *   relaxed           500 a minute for the browser suite, and impossible in
 *                     production whatever the environment says.
 *
 * Customer production is locked at strict and test-locked there.
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

/** The demo's sign-in allowance. Sign-up, forget and reset stay strict. */
export const DEMO_SIGN_IN_MAX = 20

/** The one environment value that earns the demo allowance. Exact match. */
export const DEMO_ENVIRONMENT = 'stakeholder-demo'

export type RateLimitMode = 'strict' | 'stakeholder-demo' | 'relaxed'

export function authRateLimitRules(mode: RateLimitMode): Record<string, RateRule> {
  if (mode === 'relaxed') {
    return Object.fromEntries(
      Object.entries(STRICT_AUTH_RATE_LIMITS).map(([path, rule]) => [
        path,
        { window: rule.window, max: RELAXED_MAX },
      ]),
    )
  }
  if (mode === 'stakeholder-demo') {
    return {
      ...STRICT_AUTH_RATE_LIMITS,
      '/sign-in/email': { window: 60, max: DEMO_SIGN_IN_MAX },
    }
  }
  return { ...STRICT_AUTH_RATE_LIMITS }
}

/**
 * Which mode this process runs in.
 *
 * The browser suite's relaxation wins where it is allowed at all (never in
 * production); otherwise the demo allowance applies only to an environment
 * value that is EXACTLY "stakeholder-demo" - not trimmed, not lower-cased, not
 * a prefix. Everything else, including an unset value, is strict.
 */
export function rateLimitMode(input: {
  nodeEnv: string
  environment: string | undefined
  e2eFlag: string | undefined
}): RateLimitMode {
  if (shouldRelaxRateLimits(input.nodeEnv, input.e2eFlag)) return 'relaxed'
  if (input.environment === DEMO_ENVIRONMENT) return 'stakeholder-demo'
  return 'strict'
}

/**
 * Relaxation is only ever permitted outside production, and only when
 * explicitly requested. A production deployment cannot opt out, whatever the
 * environment says.
 */
export function shouldRelaxRateLimits(nodeEnv: string, flag: string | undefined): boolean {
  return nodeEnv !== 'production' && flag === 'true'
}
