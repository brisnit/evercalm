import { NextResponse } from 'next/server'
import { runtimeRoleAttributes } from '@/server/db'
import { latestMigration, latestWorkerRun } from '@/server/db/platform'
import { getEnv } from '@/lib/env'
import { EXPECTED_LATEST_MIGRATION, readiness } from '@/server/readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Readiness: should this instance receive traffic?
 *
 * /api/health says the process is up and isolation is intact. This adds what
 * a deploy needs before switching traffic: the environment validates, the
 * database has every migration this build expects, and - reported, but not a
 * reason to refuse traffic - whether the background worker is ticking.
 *
 * It names no hosts, versions or secrets.
 */
export async function GET() {
  let envValid = true
  let providers = { email: 'unknown', billing: 'unknown' }
  try {
    const env = getEnv()
    providers = { email: env.EMAIL_PROVIDER, billing: env.BILLING_PROVIDER }
  } catch {
    envValid = false
  }
  try {
    const [role, migration, worker] = await Promise.all([
      runtimeRoleAttributes(),
      latestMigration(),
      latestWorkerRun(),
    ])
    const result = readiness({
      envValid,
      rlsEnforced: !role.isSuperuser && !role.canBypassRls,
      latestMigration: migration,
      workerLastFinishedAt: worker?.finishedAt ?? null,
      now: new Date(),
    })
    return NextResponse.json(
      { ...result, expectedMigration: EXPECTED_LATEST_MIGRATION, providers },
      { status: result.ready ? 200 : 503 },
    )
  } catch {
    return NextResponse.json({ ready: false, checks: { database: 'unreachable' } }, { status: 503 })
  }
}
