/*
 * A SMALL IN-MEMORY RATE LIMITER.
 *
 * For application actions that are cheap to abuse and expensive to serve:
 * report exports, support case creation, the billing webhook. Sign-in and
 * password reset are limited separately by the authentication library.
 *
 * Per process. Behind several instances each counts on its own, so the
 * effective limit is the limit times the instance count; that is acceptable
 * for abuse protection and documented in docs/runbooks/launch-checklist.md,
 * with a shared store listed as a production follow-up.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface Limit {
  max: number
  windowMs: number
}

/** True when this call is over the limit. Counts the call either way. */
export function rateLimited(scope: string, key: string, limit: Limit, now = Date.now()): boolean {
  const id = `${scope}:${key}`
  const bucket = buckets.get(id)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + limit.windowMs })
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
    }
    return false
  }
  bucket.count += 1
  return bucket.count > limit.max
}

/** Test-only. */
export function resetRateLimits(): void {
  buckets.clear()
}
