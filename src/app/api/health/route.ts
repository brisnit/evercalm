import { NextResponse } from 'next/server'
import { runtimeRoleAttributes } from '@/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Health check.
 *
 * Reports whether the runtime database role can bypass RLS. A deployment
 * whose role is privileged is UNHEALTHY even if it can serve queries, because
 * the primary isolation layer is inert.
 */
export async function GET() {
  try {
    const role = await runtimeRoleAttributes()
    const rlsEnforced = !role.isSuperuser && !role.canBypassRls
    return NextResponse.json(
      {
        status: rlsEnforced ? 'ok' : 'unhealthy',
        database: { connected: true, role: role.role, rlsEnforced },
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
