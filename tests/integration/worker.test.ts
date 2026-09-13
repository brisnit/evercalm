import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAnnouncement,
  listCategories,
  publishAnnouncement,
  reviseAnnouncement,
  scheduleAnnouncement,
  type AnnouncementInput,
} from '@/modules/comms/service'
import {
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  claimDueNotifications,
  completeDelivery,
  enqueue,
  retryBackoffMs,
  type ClaimedNotification,
  type DeliveryOutcome,
} from '@/modules/notifications/service'
import {
  defaultSender,
  runWorkerTick,
  startWorker,
  type NotificationSender,
  type TickReport,
} from '@/server/jobs/worker'
import { acknowledge } from '@/modules/comms/inbox'
import { setEmploymentStatus } from '@/modules/people/employment-service'
import { overrideConnectionStrings } from '@/server/db/client'
import { closePools } from '@/server/db'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'
import { testDatabaseInfo } from '../helpers/postgres'

/**
 * THE BACKGROUND WORKER, against real PostgreSQL, with a controlled clock.
 *
 * Nothing here calls publish, expire or deliver by hand. Each test sets up
 * state the way a manager would - schedule this, require that - then moves a
 * fake clock and lets the REAL worker (the same runWorkerTick and startWorker
 * that `npm run worker` runs, through the real withTenant and the real
 * SECURITY DEFINER discovery function) do the rest.
 *
 * The clock is real time plus minutes or hours, never days: the seeded
 * scheduled announcements are days out, and other suites share this database.
 */

let harborId: string
const userIds = new Map<string, string>()
const OWNER = 'dana@harborvine.test'
const EMPLOYEE = 'sam@harborvine.test'
const HR = 'priya@harborvine.test'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

beforeAll(async () => {
  // Point the APPLICATION's own pool at the test database, so the worker
  // runs exactly as it does in development: runtime role, RLS, withTenant.
  overrideConnectionStrings({ appUrl: (await testDatabaseInfo()).appUrl })
  harborId = await organizationIdBySlug('harbor-vine')
  const pool = await migrationClient()
  const users = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of users.rows) userIds.set(row.email, row.id)
})

afterAll(async () => {
  await closePools()
  await closeTestPools()
})

// --- helpers ----------------------------------------------------------------

async function actorFor(email: string): Promise<Actor> {
  const userId = userIds.get(email)
  if (!userId) throw new Error(`Seeded user ${email} not found`)
  const actor = await asTenant(harborId, (tx) => resolveActor(tx, harborId, userId))
  if (!actor) throw new Error(`No actor for ${email}`)
  return actor
}

async function categoryId(key: string): Promise<string> {
  const categories = await asTenant(harborId, (tx) => listCategories(tx, harborId))
  return categories.find((c) => c.key === key)!.id
}

async function draftFor(
  owner: Actor,
  employmentIds: string[],
  overrides: Partial<AnnouncementInput> = {},
): Promise<string> {
  const input: AnnouncementInput = {
    title: `Worker ${crypto.randomUUID().slice(0, 8)}`,
    body: 'Background work under test.',
    categoryId: await categoryId('general'),
    priority: 'normal',
    requiresAcknowledgement: false,
    acknowledgementDueAt: null,
    expiresAt: null,
    callToActionLabel: null,
    callToActionHref: null,
    eventId: null,
    ...overrides,
  }
  return asTenant(harborId, (tx) =>
    createAnnouncement(
      tx,
      owner,
      input,
      employmentIds.map((id) => ({ mode: 'include', selectorType: 'employment', selectorId: id })),
    ),
  )
}

async function scheduled(
  owner: Actor,
  employmentIds: string[],
  publishAt: Date,
  overrides: Partial<AnnouncementInput> = {},
): Promise<string> {
  const id = await draftFor(owner, employmentIds, overrides)
  await asTenant(harborId, (tx) => scheduleAnnouncement(tx, owner, id, publishAt))
  return id
}

async function query<T extends Record<string, unknown>>(
  text: string,
  params: unknown[],
): Promise<T[]> {
  const pool = await migrationClient()
  return (await pool.query<T>(text, params)).rows
}

async function statusOf(announcementId: string): Promise<string> {
  const rows = await query<{ status: string }>('select status from announcements where id = $1', [
    announcementId,
  ])
  return rows[0]!.status
}

async function recipientCount(announcementId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    'select count(*) as n from announcement_recipients where announcement_id = $1',
    [announcementId],
  )
  return Number(rows[0]!.n)
}

type NotificationRow = {
  id: string
  channel: string
  status: string
  attempts: number
  purpose: string
  failure_reason: string | null
  scheduled_for: Date
  locked_until: Date | null
}

async function notificationsFor(subjectId: string): Promise<NotificationRow[]> {
  return query<NotificationRow>(
    `select id, channel, status, attempts, failure_reason, scheduled_for, locked_until,
            split_part(idempotency_key, ':', 5) as purpose
       from notifications where subject_id = $1
      order by purpose, channel`,
    [subjectId],
  )
}

async function auditCount(subjectId: string, action: string): Promise<number> {
  const rows = await query<{ n: string }>(
    'select count(*) as n from audit_events where subject_id = $1 and action = $2',
    [subjectId, action],
  )
  return Number(rows[0]!.n)
}

/** Records every delivery attempt, then delivers exactly as production would. */
function recordingSender(
  override?: (n: ClaimedNotification) => DeliveryOutcome | null,
): NotificationSender & { calls: Map<string, number> } {
  const calls = new Map<string, number>()
  const sender = async (n: ClaimedNotification) => {
    calls.set(n.id, (calls.get(n.id) ?? 0) + 1)
    return override?.(n) ?? defaultSender(n)
  }
  return Object.assign(sender, { calls })
}

function tickAt(at: Date, sender?: NotificationSender): Promise<TickReport> {
  return runWorkerTick({ now: () => at, sender })
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for the worker')
}

function noErrors(report: TickReport) {
  expect(report.errors, JSON.stringify(report.errors)).toEqual([])
}

// ---------------------------------------------------------------------------

describe('scheduled publishing', () => {
  it('publishes when the clock reaches the time, with nobody invoking it', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 10 * MINUTE)
    const id = await scheduled(owner, [sam.employmentId], publishAt)

    // The running loop - the same one `npm run worker` starts - with a clock
    // this test controls.
    let clock = new Date()
    const sender = recordingSender()
    const worker = startWorker({ intervalMs: 25, now: () => clock, sender })
    try {
      await waitFor(() => worker.ticks >= 3)
      expect(await statusOf(id)).toBe('scheduled')
      expect(await recipientCount(id)).toBe(0)

      clock = new Date(publishAt.getTime() + 1_000)
      await waitFor(async () => (await statusOf(id)) === 'published')
      await waitFor(async () => (await notificationsFor(id)).every((n) => n.status === 'sent'))

      // Let it keep ticking well past the point of publication.
      const settled = worker.ticks
      await waitFor(() => worker.ticks >= settled + 5)
    } finally {
      await worker.stop()
    }

    expect(await recipientCount(id)).toBe(1)
    const rows = await notificationsFor(id)
    expect(rows.map((n) => [n.channel, n.status, n.attempts])).toEqual([
      ['email', 'sent', 1],
      ['in_app', 'sent', 1],
    ])
    // Delivered once each, however many ticks ran afterwards.
    for (const row of rows) expect(sender.calls.get(row.id)).toBe(1)
    expect(await auditCount(id, 'announcement.published')).toBe(1)
  })

  it('publishes a schedule missed during downtime on the first tick back', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 5 * MINUTE)
    const id = await scheduled(owner, [sam.employmentId], publishAt)

    // The worker was down for six hours.
    const back = new Date(publishAt.getTime() + 6 * HOUR)
    const report = await tickAt(back)
    noErrors(report)
    expect(await statusOf(id)).toBe('published')
    expect(await recipientCount(id)).toBe(1)

    await tickAt(new Date(back.getTime() + MINUTE))
    expect(await recipientCount(id)).toBe(1)
    expect((await notificationsFor(id)).length).toBe(2)
  })

  it('does not publish something whose expiry also passed during downtime', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 5 * MINUTE)
    const id = await scheduled(owner, [sam.employmentId], publishAt, {
      expiresAt: new Date(publishAt.getTime() + 30 * MINUTE),
    })

    const report = await tickAt(new Date(publishAt.getTime() + 2 * HOUR))
    noErrors(report)
    expect(await statusOf(id)).toBe('expired')
    expect(await recipientCount(id)).toBe(0)
    expect(await notificationsFor(id)).toEqual([])
    expect(await auditCount(id, 'announcement.expired')).toBe(1)
  })

  it('recovers after a worker restart: stopped before the time, started after it', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 10 * MINUTE)
    const id = await scheduled(owner, [sam.employmentId], publishAt)

    let clock = new Date()
    const first = startWorker({ intervalMs: 25, now: () => clock })
    await waitFor(() => first.ticks >= 2)
    await first.stop()
    const ticksWhenStopped = first.ticks

    // Time passes while nothing is running.
    clock = new Date(publishAt.getTime() + HOUR)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(first.ticks).toBe(ticksWhenStopped)
    expect(await statusOf(id)).toBe('scheduled')

    const second = startWorker({ intervalMs: 25, now: () => clock })
    try {
      await waitFor(async () => (await statusOf(id)) === 'published')
      await waitFor(async () => (await notificationsFor(id)).every((n) => n.status === 'sent'))
    } finally {
      await second.stop()
    }
    expect(await recipientCount(id)).toBe(1)
  })

  it('returns a schedule to draft, with the reason, when its author lost permission', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 5 * MINUTE)
    const id = await scheduled(owner, [sam.employmentId], publishAt)

    // The person who scheduled it is now somebody without announcement.publish.
    await query('update announcements set scheduled_by_employment_id = $1 where id = $2', [
      sam.employmentId,
      id,
    ])

    const at = new Date(publishAt.getTime() + MINUTE)
    const report = await tickAt(at)
    noErrors(report)
    expect(report.scheduleFailures).toBe(1)

    const [row] = await query<{ status: string; publish_failure_reason: string | null }>(
      'select status, publish_failure_reason from announcements where id = $1',
      [id],
    )
    expect(row!.status).toBe('draft')
    expect(row!.publish_failure_reason).toMatch(/no longer has permission/)
    expect(await recipientCount(id)).toBe(0)
    expect(await auditCount(id, 'announcement.schedule_failed')).toBe(1)

    // Not retried: waiting will not restore somebody's permission.
    const again = await tickAt(new Date(at.getTime() + MINUTE))
    expect(again.scheduleFailures).toBe(0)
    expect(await auditCount(id, 'announcement.schedule_failed')).toBe(1)
  })
})

describe('expiry', () => {
  it('expires when due and cancels anything still waiting to be delivered', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 5 * MINUTE)
    const expiresAt = new Date(publishAt.getTime() + 20 * MINUTE)
    const id = await scheduled(owner, [sam.employmentId], publishAt, { expiresAt })

    // Published, but with delivery failing transiently, so notifications are
    // still queued for retry when expiry arrives.
    const failing = recordingSender(() => ({ kind: 'transient', reason: 'Provider timeout' }))
    noErrors(await tickAt(new Date(publishAt.getTime() + MINUTE), failing))
    expect(await statusOf(id)).toBe('published')

    // Still failing on the retry, so it is backed off again, past expiry.
    noErrors(await tickAt(new Date(expiresAt.getTime() - MINUTE), failing))
    expect(await statusOf(id)).toBe('published')
    expect((await notificationsFor(id)).map((n) => n.status)).toEqual(['pending', 'pending'])

    const report = await tickAt(new Date(expiresAt.getTime() + MINUTE))
    noErrors(report)
    expect(await statusOf(id)).toBe('expired')
    expect((await notificationsFor(id)).map((n) => n.status)).toEqual(['cancelled', 'cancelled'])
    expect(await auditCount(id, 'announcement.expired')).toBe(1)

    await tickAt(new Date(expiresAt.getTime() + 2 * MINUTE))
    expect(await auditCount(id, 'announcement.expired')).toBe(1)
  })
})

describe('concurrent workers', () => {
  it('publish, notify and deliver each thing once, however many run at the same instant', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 5 * MINUTE)
    const everyone = await query<{ id: string }>(
      `select id from employments where organization_id = $1 and status = 'active' limit 6`,
      [harborId],
    )
    const audience = [...new Set([sam.employmentId, ...everyone.map((e) => e.id)])]
    const ids = await Promise.all([1, 2, 3].map(() => scheduled(owner, audience, publishAt)))

    const sender = recordingSender()
    const at = new Date(publishAt.getTime() + MINUTE)
    const reports = await Promise.all([1, 2, 3, 4].map(() => tickAt(at, sender)))
    reports.forEach(noErrors)

    expect(reports.reduce((sum, r) => sum + r.published, 0)).toBe(3)
    for (const id of ids) {
      expect(await statusOf(id)).toBe('published')
      expect(await recipientCount(id)).toBe(audience.length)
      expect(await auditCount(id, 'announcement.published')).toBe(1)
    }

    // Whatever the first wave left claimed, a second concurrent wave finishes.
    await Promise.all([1, 2, 3].map(() => tickAt(new Date(at.getTime() + 1_000), sender)))

    for (const id of ids) {
      const rows = await notificationsFor(id)
      expect(rows).toHaveLength(audience.length * 2)
      for (const row of rows) {
        // Nobody was notified twice on any channel.
        expect(sender.calls.get(row.id) ?? 0).toBeLessThanOrEqual(1)
        if (row.status === 'sent') expect(sender.calls.get(row.id)).toBe(1)
      }
    }
    const sentOrFailed = (await Promise.all(ids.map(notificationsFor)))
      .flat()
      .every((n) => n.status === 'sent' || n.status === 'failed')
    expect(sentOrFailed).toBe(true)
  })
})

describe('delivery failures', () => {
  async function queueOne(title: string): Promise<string> {
    const sam = await actorFor(EMPLOYEE)
    const subjectId = crypto.randomUUID()
    await asTenant(harborId, (tx) =>
      enqueue(tx, harborId, [
        {
          employmentId: sam.employmentId,
          category: 'general',
          channel: 'in_app',
          subjectType: 'worker-test',
          subjectId,
          title,
        },
      ]),
    )
    return subjectId
  }

  it('retries a transient failure with backoff, then delivers once', async () => {
    const title = `Flaky ${crypto.randomUUID()}`
    const subjectId = await queueOne(title)
    let failuresLeft = 2
    const sender = recordingSender((n) =>
      n.title === title && failuresLeft-- > 0 ? { kind: 'transient', reason: 'Timed out' } : null,
    )

    const t0 = new Date(Date.now() + MINUTE)
    await tickAt(t0, sender)
    let [row] = await notificationsFor(subjectId)
    expect(row).toMatchObject({ status: 'pending', attempts: 1, failure_reason: 'Timed out' })
    expect(row!.scheduled_for.getTime()).toBe(t0.getTime() + retryBackoffMs(1))

    // Before the backoff elapses: not attempted.
    await tickAt(new Date(t0.getTime() + retryBackoffMs(1) - 1_000), sender)
    expect((await notificationsFor(subjectId))[0]!.attempts).toBe(1)

    const t1 = new Date(t0.getTime() + retryBackoffMs(1))
    await tickAt(t1, sender)
    ;[row] = await notificationsFor(subjectId)
    expect(row).toMatchObject({ status: 'pending', attempts: 2 })

    await tickAt(new Date(t1.getTime() + retryBackoffMs(2)), sender)
    ;[row] = await notificationsFor(subjectId)
    expect(row).toMatchObject({ status: 'sent', attempts: 3 })
    expect(sender.calls.get(row!.id)).toBe(3)

    await tickAt(new Date(t1.getTime() + 2 * HOUR), sender)
    expect(sender.calls.get(row!.id)).toBe(3)
  })

  it(`gives up after ${MAX_DELIVERY_ATTEMPTS} transient failures, keeping the reason`, async () => {
    const title = `Always failing ${crypto.randomUUID()}`
    const subjectId = await queueOne(title)
    const sender = recordingSender((n) =>
      n.title === title ? { kind: 'transient', reason: 'Provider unavailable' } : null,
    )

    let at = new Date(Date.now() + MINUTE)
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS + 2; i += 1) {
      await tickAt(at, sender)
      at = new Date(at.getTime() + 2 * HOUR)
    }
    const [row] = await notificationsFor(subjectId)
    expect(row).toMatchObject({
      status: 'failed',
      attempts: MAX_DELIVERY_ATTEMPTS,
      failure_reason: 'Provider unavailable',
    })
    expect(sender.calls.get(row!.id)).toBe(MAX_DELIVERY_ATTEMPTS)
  })

  it('fails a permanent error immediately, without retrying', async () => {
    const title = `Rejected ${crypto.randomUUID()}`
    const subjectId = await queueOne(title)
    const sender = recordingSender((n) =>
      n.title === title ? { kind: 'permanent', reason: 'Address rejected' } : null,
    )
    await tickAt(new Date(Date.now() + MINUTE), sender)
    await tickAt(new Date(Date.now() + 3 * HOUR), sender)
    const [row] = await notificationsFor(subjectId)
    expect(row).toMatchObject({ status: 'failed', attempts: 1 })
    expect(sender.calls.get(row!.id)).toBe(1)
  })

  it('treats an email with no address as permanent, and never leaks an address in a reason', async () => {
    const base: ClaimedNotification = {
      id: crypto.randomUUID(),
      employmentId: crypto.randomUUID(),
      channel: 'email',
      title: 'Hello',
      preview: '',
      href: null,
      attempts: 1,
      claimToken: crypto.randomUUID(),
      emailAddress: null,
    }
    expect(await defaultSender(base)).toEqual({
      kind: 'permanent',
      reason: 'No email address on file for this person.',
    })

    const title = `Throws ${crypto.randomUUID()}`
    const subjectId = await queueOne(title)
    const sender = recordingSender((n) => {
      if (n.title === title) throw new Error('Mailbox someone@example.test is full')
      return null
    })
    await tickAt(new Date(Date.now() + MINUTE), sender)
    const [row] = await notificationsFor(subjectId)
    expect(row!.status).toBe('pending')
    expect(row!.failure_reason).not.toContain('@')
  })

  it('re-delivers after a worker died holding a lease - once, and the dead worker cannot overwrite it', async () => {
    const title = `Crash ${crypto.randomUUID()}`
    const subjectId = await queueOne(title)
    const crashAt = new Date(Date.now() + MINUTE)

    // A worker claims the row, then dies before sending or completing.
    const claimedByDeadWorker = await asTenant(harborId, (tx) =>
      claimDueNotifications(tx, harborId, { now: crashAt }),
    )
    const lost = claimedByDeadWorker.find((n) => n.title === title)!
    expect(lost).toBeDefined()

    const sender = recordingSender()
    // While the lease is live, a fresh worker leaves the row alone.
    await tickAt(new Date(crashAt.getTime() + DELIVERY_LEASE_MS - 1_000), sender)
    let [row] = await notificationsFor(subjectId)
    expect(row!.status).toBe('pending')
    expect(sender.calls.get(row!.id)).toBeUndefined()

    // Once it expires, the restarted worker takes over.
    await tickAt(new Date(crashAt.getTime() + DELIVERY_LEASE_MS + 1_000), sender)
    ;[row] = await notificationsFor(subjectId)
    expect(row).toMatchObject({ status: 'sent', attempts: 2 })
    expect(row!.locked_until).toBeNull()
    expect(sender.calls.get(row!.id)).toBe(1)

    // The dead worker "wakes up" and tries to record a failure. Refused.
    const late = await asTenant(harborId, (tx) =>
      completeDelivery(
        tx,
        harborId,
        lost,
        { kind: 'permanent', reason: 'late' },
        new Date(crashAt.getTime() + HOUR),
      ),
    )
    expect(late).toBe('lease_lost')
    expect((await notificationsFor(subjectId))[0]!.status).toBe('sent')
  })
})

describe('automatic acknowledgement reminders', () => {
  it('sends "due soon" once and "overdue" once, whatever the number of ticks', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const dueAt = new Date(Date.now() + 30 * HOUR)
    const id = await draftFor(owner, [sam.employmentId], {
      requiresAcknowledgement: true,
      acknowledgementDueAt: dueAt,
    })
    await asTenant(harborId, (tx) => publishAnnouncement(tx, owner, id))

    const purposes = async () =>
      (await notificationsFor(id)).map((n) => `${n.purpose}:${n.channel}`).sort()

    // More than a day out: nothing.
    noErrors(await tickAt(new Date(dueAt.getTime() - 25 * HOUR)))
    expect(await purposes()).toEqual(['initial:email', 'initial:in_app'])

    // Inside the last day: one "due soon", even across repeated and concurrent ticks.
    const soon = new Date(dueAt.getTime() - 2 * HOUR)
    await Promise.all([tickAt(soon), tickAt(soon), tickAt(soon)])
    await tickAt(new Date(soon.getTime() + MINUTE))
    expect(await purposes()).toEqual([
      'auto-due-soon-r1:email',
      'auto-due-soon-r1:in_app',
      'initial:email',
      'initial:in_app',
    ])

    // Past due: one "overdue".
    const late = new Date(dueAt.getTime() + HOUR)
    await Promise.all([tickAt(late), tickAt(late)])
    await tickAt(new Date(late.getTime() + HOUR))
    expect(await purposes()).toEqual([
      'auto-due-soon-r1:email',
      'auto-due-soon-r1:in_app',
      'auto-overdue-r1:email',
      'auto-overdue-r1:in_app',
      'initial:email',
      'initial:in_app',
    ])
  })

  it('after downtime past the due date, sends only the overdue reminder', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const dueAt = new Date(Date.now() + 2 * HOUR)
    const id = await draftFor(owner, [sam.employmentId], {
      requiresAcknowledgement: true,
      acknowledgementDueAt: dueAt,
    })
    await asTenant(harborId, (tx) => publishAnnouncement(tx, owner, id))

    noErrors(await tickAt(new Date(dueAt.getTime() + 5 * HOUR)))
    const purposes = (await notificationsFor(id)).map((n) => n.purpose)
    expect(purposes.filter((p) => p === 'auto-overdue-r1')).toHaveLength(2)
    expect(purposes).not.toContain('auto-due-soon-r1')
  })
})

describe('the discovery function', () => {
  it('is hardened like the other cross-tenant functions and returns only ids', async () => {
    const [fn] = await query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where proname = 'evercalm_organizations_with_due_work'`,
      [],
    )
    expect(fn!.prosecdef).toBe(true)
    expect(fn!.proconfig).toEqual(['search_path=pg_catalog, pg_temp'])

    const [grants] = await query<{ app: boolean; public_role: boolean }>(
      `select has_function_privilege('evercalm_app', 'evercalm_organizations_with_due_work(timestamptz)', 'execute') as app,
              exists (
                select 1 from pg_proc p, aclexplode(p.proacl) a
                 where p.proname = 'evercalm_organizations_with_due_work' and a.grantee = 0
              ) as public_role`,
      [],
    )
    expect(grants).toEqual({ app: true, public_role: false })

    const columns = await query<{ column_name: string }>(
      `select unnest(proargnames) as column_name from pg_proc
        where proname = 'evercalm_organizations_with_due_work'`,
      [],
    )
    expect(columns.map((c) => c.column_name)).toEqual(['p_now', 'organization_id'])
  })
})

/*
 * REGRESSION: a material revision after automatic reminders.
 *
 * A material revision asks people who already confirmed to confirm again, and
 * resets their reminder stamps. Their new reminder must actually be sent -
 * it once collided with the first reminder's idempotency key and was dropped
 * - while people who never confirmed, and were already reminded, must not
 * be reminded a second time for the same stage.
 */
describe('automatic reminders after a material revision', () => {
  it('reminds only the people asked to confirm again, once, without repeating earlier reminders', async () => {
    const owner = await actorFor(OWNER)
    const sam = await actorFor(EMPLOYEE)
    const [other] = await query<{ id: string }>(
      `select id from employments
        where organization_id = $1 and status = 'active' and id <> all($2::uuid[])
        order by display_name limit 1`,
      [harborId, [sam.employmentId, owner.employmentId]],
    )
    const otherId = other!.id

    const dueAt = new Date(Date.now() + 2 * HOUR)
    const id = await draftFor(owner, [sam.employmentId, otherId], {
      requiresAcknowledgement: true,
      acknowledgementDueAt: dueAt,
    })
    await asTenant(harborId, (tx) => publishAnnouncement(tx, owner, id))

    const reminders = async () =>
      (
        await query<{ employment_id: string; purpose: string; channel: string; id: string }>(
          `select id, employment_id, channel, split_part(idempotency_key, ':', 5) as purpose
             from notifications
            where subject_id = $1 and idempotency_key like '%:auto-%'
            order by employment_id, purpose, channel`,
          [id],
        )
      ).map((r) => ({
        who: r.employment_id === sam.employmentId ? 'sam' : 'other',
        purpose: r.purpose,
        channel: r.channel,
        id: r.id,
      }))
    const stamps = async (employmentId: string) =>
      (
        await query<{ due_soon: Date | null; overdue: Date | null; reminders: number }>(
          `select due_soon_reminded_at as due_soon, overdue_reminded_at as overdue,
                  reminder_count as reminders
             from announcement_recipients where announcement_id = $1 and employment_id = $2`,
          [id, employmentId],
        )
      )[0]!

    // --- first "due soon" reminder, to both ----------------------------------
    const first = new Date(Date.now() + MINUTE)
    noErrors(await tickAt(first))
    const before = await reminders()
    expect(
      before.map(({ who, purpose, channel }) => `${who}:${purpose}:${channel}`).sort(),
    ).toEqual([
      'other:auto-due-soon-r1:email',
      'other:auto-due-soon-r1:in_app',
      'sam:auto-due-soon-r1:email',
      'sam:auto-due-soon-r1:in_app',
    ])

    // --- Sam confirms; then the meaning changes ------------------------------
    await asTenant(harborId, (tx) => acknowledge(tx, sam, sam.employmentId, id))
    const revision = await asTenant(harborId, (tx) =>
      reviseAnnouncement(tx, owner, id, {
        title: 'Rota change - corrected start time',
        body: 'The start time moved to 6am.',
        callToActionLabel: null,
        callToActionHref: null,
        isMaterial: true,
        note: 'Corrected the start time',
      }),
    )
    expect(revision).toBe(2)

    // Reset for the person asked again; untouched for the person still outstanding.
    expect((await stamps(sam.employmentId)).due_soon).toBeNull()
    expect((await stamps(otherId)).due_soon).not.toBeNull()

    // --- repeated and concurrent ticks after the revision --------------------
    const after = new Date(first.getTime() + MINUTE)
    await Promise.all([tickAt(after), tickAt(after), tickAt(after)])
    noErrors(await tickAt(new Date(after.getTime() + MINUTE)))

    const afterRevision = await reminders()
    expect(
      afterRevision.map(({ who, purpose, channel }) => `${who}:${purpose}:${channel}`).sort(),
    ).toEqual([
      'other:auto-due-soon-r1:email',
      'other:auto-due-soon-r1:in_app',
      'sam:auto-due-soon-r1:email',
      'sam:auto-due-soon-r1:in_app',
      'sam:auto-due-soon-r2:email',
      'sam:auto-due-soon-r2:in_app',
    ])
    // The earlier reminders are the same rows, not re-created.
    for (const row of before) expect(afterRevision.map((r) => r.id)).toContain(row.id)
    expect((await stamps(sam.employmentId)).reminders).toBe(2)
    expect((await stamps(otherId)).reminders).toBe(1)

    // --- overdue: once per person, for the current revision -----------------
    const late = new Date(dueAt.getTime() + HOUR)
    await Promise.all([tickAt(late), tickAt(late)])
    noErrors(await tickAt(new Date(late.getTime() + HOUR)))
    const overdue = (await reminders()).filter((r) => r.purpose.startsWith('auto-overdue'))
    expect(
      overdue.map(({ who, purpose, channel }) => `${who}:${purpose}:${channel}`).sort(),
    ).toEqual([
      'other:auto-overdue-r2:email',
      'other:auto-overdue-r2:in_app',
      'sam:auto-overdue-r2:email',
      'sam:auto-overdue-r2:in_app',
    ])
    expect((await reminders()).filter((r) => r.purpose.startsWith('auto-due-soon'))).toHaveLength(6)
  })
})

/*
 * REGRESSION: the scheduler is deactivated before publish time.
 *
 * Suspending somebody must also stop what they scheduled. It must not go out
 * under their name, must not be retried on every tick, and must say why.
 */
describe('a schedule whose author is deactivated', () => {
  it('fails safely: back to draft, nothing sent, reason recorded, not retried', async () => {
    const owner = await actorFor(OWNER)
    const hr = await actorFor(HR)
    const sam = await actorFor(EMPLOYEE)
    const publishAt = new Date(Date.now() + 5 * MINUTE)
    const id = await scheduled(hr, [sam.employmentId], publishAt, {
      requiresAcknowledgement: true,
    })

    // Deactivated through the real service, as an administrator would.
    await asTenant(harborId, (tx) =>
      setEmploymentStatus(tx, owner, hr.employmentId, 'suspended', 'Regression test: suspended'),
    )
    try {
      const at = new Date(publishAt.getTime() + MINUTE)
      const report = await tickAt(at)
      noErrors(report)
      expect(report.published).toBe(0)
      expect(report.scheduleFailures).toBe(1)

      const [row] = await query<{
        status: string
        publish_at: Date | null
        published_at: Date | null
        publish_failure_reason: string | null
        publish_failed_at: Date | null
      }>(
        `select status, publish_at, published_at, publish_failure_reason, publish_failed_at
           from announcements where id = $1`,
        [id],
      )
      expect(row).toMatchObject({ status: 'draft', publish_at: null, published_at: null })
      expect(row!.publish_failure_reason).toMatch(/no longer active/)
      expect(row!.publish_failed_at).not.toBeNull()

      expect(await recipientCount(id)).toBe(0)
      expect(await notificationsFor(id)).toEqual([])
      expect(await auditCount(id, 'announcement.published')).toBe(0)
      expect(await auditCount(id, 'announcement.schedule_failed')).toBe(1)

      // Not retried, and does not slip out later.
      await Promise.all([
        tickAt(new Date(at.getTime() + MINUTE)),
        tickAt(new Date(at.getTime() + MINUTE)),
      ])
      await tickAt(new Date(at.getTime() + 2 * HOUR))
      expect(await statusOf(id)).toBe('draft')
      expect(await recipientCount(id)).toBe(0)
      expect(await auditCount(id, 'announcement.schedule_failed')).toBe(1)
    } finally {
      await asTenant(harborId, (tx) =>
        setEmploymentStatus(tx, owner, hr.employmentId, 'active', 'Regression test: restored'),
      )
    }

    // Reinstating the author does not resurrect the schedule on its own.
    await tickAt(new Date(publishAt.getTime() + 3 * HOUR))
    expect(await statusOf(id)).toBe('draft')
    expect(await recipientCount(id)).toBe(0)
  })
})
