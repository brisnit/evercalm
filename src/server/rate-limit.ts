import { getLogger } from '@/lib/logger'
import { consumeRateLimit, type RateLimit } from '@/server/db/rate-limit-store'

/*
 * RATE LIMITS FOR APPLICATION ACTIONS that are cheap to abuse and expensive
 * to serve: report exports and the billing webhook. Support case creation is
 * limited in its own query, and sign-in, sign-up and password reset by the
 * authentication library, which also stores its counters in the database.
 *
 * Shared across every server instance (see server/db/rate-limit-store.ts).
 * If the database cannot be reached the action is allowed: the action itself
 * needs the database, so failing closed would only add a second error.
 */

export type { RateLimit }

/** True when this call is over the limit. Counts the call either way. */
export async function rateLimited(scope: string, key: string, limit: RateLimit): Promise<boolean> {
  try {
    return (await consumeRateLimit(scope, key, limit)) > limit.max
  } catch (error) {
    getLogger().warn(
      { scope, err: error instanceof Error ? error.message : 'unknown' },
      'rate limit check failed open',
    )
    return false
  }
}
