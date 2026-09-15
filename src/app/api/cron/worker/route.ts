import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { getLogger } from '@/lib/logger'
import { handleCronWorker } from '@/server/jobs/cron'
import { runWorkerTick } from '@/server/jobs/worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Seconds. The tick stops starting new work well before this. */
export const maxDuration = 60

/**
 * One background worker tick, for Vercel Cron (see vercel.json).
 *
 * Authenticated by Vercel's "Authorization: Bearer <CRON_SECRET>" and a 404 for
 * anything else. Smaller batches and a deadline keep a tick inside the
 * function's time limit; unfinished work stays in the database for the next
 * minute's tick, and overlapping ticks are safe (see src/server/jobs/worker.ts).
 */
export async function GET(request: Request) {
  try {
    const outcome = await handleCronWorker(request.headers.get('authorization'), {
      secret: getEnv().CRON_SECRET,
      runTick: () =>
        runWorkerTick({ batchSize: 25, maxBatches: 4, deadlineAt: Date.now() + 40_000 }),
    })
    if (outcome.status === 404) return new NextResponse(null, { status: 404 })
    return NextResponse.json(outcome.body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    getLogger().error(
      { err: error instanceof Error ? error.message : 'unknown' },
      'scheduled worker tick failed',
    )
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
