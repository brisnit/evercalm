import { NextResponse } from 'next/server'
import { runtimeRoleAttributes } from '@/server/db'
import { getEnv } from '@/lib/env'
import { shouldRelaxRateLimits } from '@/server/auth/rate-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Health check.
 *
 * Reports whether the runtime database role can bypass RLS. A deployment
 * whose role is privileged is UNHEALTHY even if it can serve queries, because
 * the primary isolation layer is inert.
 *
 * It also reports whether sign-in rate limits are relaxed. That is never true
 * in production - the flag is ignored there - and the browser suite reads it
 * to refuse a server that would throttle its sign-ins, which otherwise looks
 * like a dozen unrelated test failures.
 */
export async function GET() {
  try {
    const role = await runtimeRoleAttributes()
    const rlsEnforced = !role.isSuperuser && !role.canBypassRls
    return NextResponse.json(
      {
        status: rlsEnforced ? 'ok' : 'unhealthy',
        database: { connected: true, role: role.role, rlsEnforced },
        auth: {
          rateLimitsRelaxed: shouldRelaxRateLimits(
            getEnv().NODE_ENV,
            process.env.E2E_RELAX_RATE_LIMIT,
          ),
        },
      },
      { status: rlsEnforced ? 200 : 503 },
    )
  } catch {
    return NextResponse.json(
      { status: 'unhealthy', database: { connected: false } },
      { status: 503 },
    )
  }
}
