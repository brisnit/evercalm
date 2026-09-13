import { withTenant, organizationsWithDueWork, type Tx } from '@/server/db'
import { getEnv } from '@/lib/env'
import { getLogger } from '@/lib/logger'
import { emailProvider } from '@/server/email'
import {
  ScheduledPublishError,
  expireDue,
  listDueScheduled,
  markScheduleFailed,
  publishScheduledAnnouncement,
} from '@/modules/comms/service'
import { processAutomaticReminders } from '@/modules/comms/receipts'
import {
  claimDueNotifications,
  completeDelivery,
  type ClaimedNotification,
  type DeliveryOutcome,
} from '@/modules/notifications/service'

/*
 * THE BACKGROUND WORKER.
 *
 * One TICK does everything that is due at `now`, for every organization that
 * has something due:
 *
 *   1. publish scheduled announcements whose time has come
 *   2. expire published announcements whose time has passed
 *   3. send automatic "due soon" and "overdue" acknowledgement reminders
 *   4. deliver queued notifications
 *
 * In that order, so an announcement published in step 1 has its notifications
 * delivered in step 4 of the SAME tick.
 *
 * DURABLE. The worker keeps no state of its own. Every decision is a row in
 * PostgreSQL - a status, a stamp, a lease - so stopping it at any instant
 * loses nothing, and starting it again (hours later, or on another machine)
 * does exactly the work that is still outstanding.
 *
 * IDEMPOTENT AND SAFE TO RUN CONCURRENTLY. Each unit of work is claimed with
 * a conditional UPDATE or `FOR UPDATE SKIP LOCKED`, so any number of workers
 * can tick at once and each thing still happens once. That is also what lets
 * a production scheduler call `worker --once` on a timer without caring
 * whether the previous invocation has finished.
 *
 * TENANT-SAFE. The only cross-tenant question is "which organizations have
 * due work", answered by a SECURITY DEFINER function that returns ids and
 * nothing else. All work then runs inside withTenant(), under RLS, as the
 * non-privileged runtime role - the same boundary a web request has.
 *
 * ISOLATED FAILURES. A failure in one organization, or one step, is recorded
 * in the tick report and logged; the rest of the tick carries on, and the
 * failed work is still outstanding in the database for the next tick.
 */

export type RunTenant = <T>(organizationId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>

/** Delivers one claimed notification. Must not throw for an expected failure. */
export type NotificationSender = (notification: ClaimedNotification) => Promise<DeliveryOutcome>

export interface WorkerDeps {
  now?: () => Date
  runTenant?: RunTenant
  dueOrganizations?: (now: Date) => Promise<string[]>
  sender?: NotificationSender
  /** Claimed per batch, and how many batches per organization per tick. */
  batchSize?: number
  maxBatches?: number
  leaseMs?: number
}

export type WorkerStep = 'discover' | 'publish' | 'expire' | 'reminders' | 'deliver'

export interface TickReport {
  startedAt: Date
  finishedAt: Date
  organizations: number
  published: number
  expiredBeforePublish: number
  scheduleFailures: number
  expired: number
  reminded: number
  sent: number
  retrying: number
  failed: number
  leaseLost: number
  errors: { organizationId: string | null; step: WorkerStep; message: string }[]
}

function emptyReport(startedAt: Date): TickReport {
  return {
    startedAt,
    finishedAt: startedAt,
    organizations: 0,
    published: 0,
    expiredBeforePublish: 0,
    scheduleFailures: 0,
    expired: 0,
    reminded: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    leaseLost: 0,
    errors: [],
  }
}

/** The report's counters, for "did this tick do anything". */
export function tickDidWork(report: TickReport): boolean {
  return (
    report.published +
      report.expiredBeforePublish +
      report.scheduleFailures +
      report.expired +
      report.reminded +
      report.sent +
      report.retrying +
      report.failed >
    0
  )
}

/** Error text safe for a log line or a notification's failure reason. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Provider errors sometimes quote the recipient. Never let that into a log
  // or an administrator-visible failure reason.
  return message.replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[address]').slice(0, 300)
}

/*
 * THE DEFAULT SENDER.
 *
 *   in_app   delivery IS recording it as sent; the inbox reads the row.
 *   email    handed to the configured provider. In development and tests that
 *            is the console provider, which sends nothing. A person with no
 *            address on file is a permanent failure - retrying will not
 *            invent one. A provider error is transient and retried.
 *   sms/push not built; permanent failure, so it is visible rather than
 *            silently pending forever.
 */
export const defaultSender: NotificationSender = async (notification) => {
  switch (notification.channel) {
    case 'in_app':
      return { kind: 'sent' }
    case 'email': {
      if (!notification.emailAddress) {
        return { kind: 'permanent', reason: 'No email address on file for this person.' }
      }
      const link = notification.href ? new URL(notification.href, getEnv().APP_URL).toString() : ''
      try {
        await emailProvider().send({
          to: notification.emailAddress,
          subject: notification.title,
          text: [notification.preview, link].filter(Boolean).join('\n\n'),
        })
        return { kind: 'sent' }
      } catch (error) {
        return { kind: 'transient', reason: `Email provider error: ${describe(error)}` }
      }
    }
    default:
      return {
        kind: 'permanent',
        reason: `The ${notification.channel} channel is not available yet.`,
      }
  }
}

export async function runWorkerTick(deps: WorkerDeps = {}): Promise<TickReport> {
  const now = (deps.now ?? (() => new Date()))()
  const runTenant: RunTenant = deps.runTenant ?? withTenant
  const dueOrganizations = deps.dueOrganizations ?? organizationsWithDueWork
  const sender = deps.sender ?? defaultSender
  const batchSize = deps.batchSize ?? 100
  const maxBatches = deps.maxBatches ?? 10
  const report = emptyReport(now)
  const log = getLogger()

  let organizationIds: string[]
  try {
    organizationIds = await dueOrganizations(now)
  } catch (error) {
    report.errors.push({ organizationId: null, step: 'discover', message: describe(error) })
    report.finishedAt = new Date()
    return report
  }
  report.organizations = organizationIds.length

  const step = async (organizationId: string, name: WorkerStep, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (error) {
      const message = describe(error)
      report.errors.push({ organizationId, step: name, message })
      log.error({ organizationId, step: name, err: message }, 'worker step failed')
    }
  }

  for (const organizationId of organizationIds) {
    await step(organizationId, 'publish', async () => {
      const due = await runTenant(organizationId, (tx) => listDueScheduled(tx, organizationId, now))
      // One transaction per announcement: one bad schedule cannot hold back
      // or roll back the others.
      for (const announcementId of due) {
        try {
          const result = await runTenant(organizationId, (tx) =>
            publishScheduledAnnouncement(tx, organizationId, announcementId, now),
          )
          if (result.kind === 'published') report.published += 1
          if (result.kind === 'expired_before_publish') report.expiredBeforePublish += 1
        } catch (error) {
          if (!(error instanceof ScheduledPublishError)) throw error
          const marked = await runTenant(organizationId, (tx) =>
            markScheduleFailed(tx, organizationId, announcementId, error.message, now),
          )
          if (marked) report.scheduleFailures += 1
        }
      }
    })

    await step(organizationId, 'expire', async () => {
      report.expired += await runTenant(organizationId, (tx) => expireDue(tx, organizationId, now))
    })

    await step(organizationId, 'reminders', async () => {
      const result = await runTenant(organizationId, (tx) =>
        processAutomaticReminders(tx, organizationId, now),
      )
      report.reminded += result.reminded
    })

    await step(organizationId, 'deliver', async () => {
      for (let batch = 0; batch < maxBatches; batch += 1) {
        // Claim and commit FIRST, so the lease is visible to other workers
        // before any slow send begins.
        const claimed = await runTenant(organizationId, (tx) =>
          claimDueNotifications(tx, organizationId, {
            now,
            limit: batchSize,
            leaseMs: deps.leaseMs,
          }),
        )
        if (claimed.length === 0) break

        // Send outside any transaction: a slow provider must not hold a
        // database connection or row locks.
        const outcomes: DeliveryOutcome[] = []
        for (const notification of claimed) {
          try {
            outcomes.push(await sender(notification))
          } catch (error) {
            outcomes.push({ kind: 'transient', reason: describe(error) })
          }
        }

        await runTenant(organizationId, async (tx) => {
          for (const [index, notification] of claimed.entries()) {
            const result = await completeDelivery(
              tx,
              organizationId,
              notification,
              outcomes[index]!,
              now,
            )
            if (result === 'sent') report.sent += 1
            if (result === 'retrying') report.retrying += 1
            if (result === 'failed') report.failed += 1
            if (result === 'lease_lost') report.leaseLost += 1
          }
        })

        if (claimed.length < batchSize) break
      }
    })
  }

  report.finishedAt = new Date()
  return report
}

/*
 * THE LOOP.
 *
 * Ticks never overlap within one process: the next tick is scheduled only
 * after the previous one finishes. `stop()` lets the tick in progress finish
 * - every step is transactional, so it would be safe to kill it instead, but
 * finishing avoids needlessly waiting out a delivery lease - then resolves.
 */

export interface WorkerHandle {
  stop(): Promise<void>
  readonly ticks: number
}

export interface StartWorkerOptions extends WorkerDeps {
  intervalMs: number
  onTick?: (report: TickReport) => void | Promise<void>
}

export function startWorker(options: StartWorkerOptions): WorkerHandle {
  const log = getLogger()
  let stopped = false
  let ticks = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: Promise<void> = Promise.resolve()

  const loop = () => {
    if (stopped) return
    current = (async () => {
      try {
        const report = await runWorkerTick(options)
        ticks += 1
        await options.onTick?.(report)
      } catch (error) {
        // runWorkerTick isolates its own failures; this is a last resort so
        // one unexpected error cannot end the loop.
        log.error({ err: describe(error) }, 'worker tick failed')
      }
    })()
    void current.then(() => {
      if (!stopped) timer = setTimeout(loop, options.intervalMs)
    })
  }

  loop()

  return {
    get ticks() {
      return ticks
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await current
    },
  }
}
