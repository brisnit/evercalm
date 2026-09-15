import { createHash, timingSafeEqual } from 'node:crypto'
import type { TickReport } from './worker'

/*
 * THE SCHEDULED WORKER ENDPOINT.
 *
 * Vercel Cron calls GET /api/cron/worker with "Authorization: Bearer
 * <CRON_SECRET>". Anything else - no header, another scheme, a wrong token, or
 * no CRON_SECRET configured - is answered 404, so the endpoint is not
 * discoverable and a missing secret fails closed.
 *
 * The comparison hashes both sides first, so it takes the same time whatever
 * the token's length or content.
 */

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()

export function bearerTokenMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header || !header.startsWith('Bearer ')) return false
  const given = header.slice('Bearer '.length)
  // Hash first: timingSafeEqual needs equal lengths, and must not leak them.
  const matches = timingSafeEqual(digest(given), digest(secret))
  return matches && given.length === secret.length
}

export type CronOutcome =
  | { status: 404 }
  | {
      status: 200
      body: {
        ok: boolean
        organizations: number
        deferred: number
        published: number
        reminded: number
        billingChanges: number
        sent: number
        retrying: number
        failed: number
        errors: number
        durationMs: number
      }
    }

/** Counts only: no organization ids, no error messages, nothing about a customer. */
export async function handleCronWorker(
  authorization: string | null,
  deps: { secret: string | undefined; runTick: () => Promise<TickReport> },
): Promise<CronOutcome> {
  if (!bearerTokenMatches(authorization, deps.secret)) return { status: 404 }
  const report = await deps.runTick()
  return {
    status: 200,
    body: {
      ok: report.errors.length === 0,
      organizations: report.organizations,
      deferred: report.deferredOrganizations,
      published: report.published,
      reminded: report.reminded + report.shiftReminders,
      billingChanges: report.billingChanges,
      sent: report.sent,
      retrying: report.retrying,
      failed: report.failed,
      errors: report.errors.length,
      durationMs: report.finishedAt.getTime() - report.startedAt.getTime(),
    },
  }
}
