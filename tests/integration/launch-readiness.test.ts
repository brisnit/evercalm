import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { can } from '@/server/authz/can'
import {
  staffCaseNote,
  staffCaseThread,
  staffCaseUpdate,
  staffCases,
  staffOrganizations,
  staffRetryDeliveries,
} from '@/server/db/platform'
import { mockProvider, signMockPayload } from '@/modules/billing/provider'
import { receiveBillingWebhook } from '@/modules/billing/webhook'
import {
  changePlan,
  getBillingOverview,
  handleProviderEvent,
  processBillingLifecycle,
  requestCancellation,
} from '@/modules/billing/service'
import { buildReport } from '@/modules/reports/builders'
import { exportReport } from '@/modules/reports/export'
import { parseReportFilters, REPORT_KEYS } from '@/modules/reports/filters'
import { getSystemStatus, retryFailedNotifications } from '@/modules/status/service'
import { createCase, getCase, listCases, replyToCase } from '@/modules/support/service'
import { myTraining } from '@/modules/training/learner'
import { runWorkerTick } from '@/server/jobs/worker'
import { organizationForProviderSubscription, recordWorkerRun } from '@/server/db/platform'
import {
  appDrizzle,
  asTenant,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
  rawAsApp,
} from '../helpers/tenant'

/**
 * SLICE 7, AGAINST REAL POSTGRESQL.
 *
 *   reports and exports stay inside the tenant and the actor's locations, and
 *     carry no internal ids, sensitive fields or live formulas
 *   billing events are idempotent, webhooks are authenticated, and each
 *     subscription status does what the policy says - without locking
 *     employees out of their own records
 *   support cases separate customer conversation from EverCalm-internal notes
 *   the EverCalm team works only through narrow, audited functions, with no
 *     way into a customer session
 *   worker and delivery failures are visible, and retries are audited
 *   none of it can be deleted by the application
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

let harborId: string
let lumenId: string
const users = new Map<string, string>()

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')
  const pool = await migrationClient()
  const rows = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of rows.rows) users.set(row.email, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

async function actor(organizationId: string, email: string): Promise<Actor> {
  const resolved = await asTenant(organizationId, (tx) =>
    resolveActor(tx, organizationId, users.get(email)!),
  )
  if (!resolved) throw new Error(`No actor for ${email}`)
  return resolved
}

const harbor = {
  owner: () => actor(harborId, 'dana@harborvine.test'),
  hr: () => actor(harborId, 'priya@harborvine.test'),
  gmRiverside: () => actor(harborId, 'marcus@harborvine.test'),
  scheduler: () => actor(harborId, 'omar@harborvine.test'),
  sam: () => actor(harborId, 'sam@harborvine.test'),
}
const lumen = {
  owner: () => actor(lumenId, 'ana@lumensalon.test'),
  trainer: () => actor(lumenId, 'yuki@lumensalon.test'),
}
const staff = {
  admin: () => users.get('morgan@evercalm.test')!,
  agent: () => users.get('jamie@evercalm.test')!,
}
const db = () => appDrizzle()

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const pool = await migrationClient()
  return (await pool.query<T>(sql, params)).rows
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return 'no error'
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } }
    return e.code ?? e.cause?.code
  }
}

const location = async (org: string, name: string) =>
  (
    await query<{ id: string }>(
      'select id from locations where organization_id = $1 and name = $2',
      [org, name],
    )
  )[0]!.id

const today = new Date().toISOString().slice(0, 10)
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const filters = (over: Parameters<typeof parseReportFilters>[0] = {}) =>
  parseReportFilters(over, today)

// ---------------------------------------------------------------------------

describe('reports', () => {
  it('shows an owner every location and a location manager only theirs', async () => {
    const owner = await harbor.owner()
    const gm = await harbor.gmRiverside()
    const riverside = await location(harborId, 'Riverside')
    const downtown = await location(harborId, 'Downtown')

    const ownerView = await asTenant(harborId, (tx) =>
      buildReport(tx, owner, 'schedule', filters()),
    )
    expect(ownerView.scope.locations.map((l) => l.name).sort()).toEqual(['Downtown', 'Riverside'])
    expect(ownerView.scope.partial).toBe(false)

    const gmView = await asTenant(harborId, (tx) => buildReport(tx, gm, 'schedule', filters()))
    expect(gmView.scope.locationIds).toEqual([riverside])
    expect(gmView.report.notes[0]).toContain('Riverside')
    const coverage = gmView.report.tables.find((t) => t.id === 'coverage')!
    expect(coverage.rows.map((r) => r.cells.location)).toEqual(['Riverside'])

    // Another location, by id, is not found.
    await expect(
      asTenant(harborId, (tx) => buildReport(tx, gm, 'schedule', filters({ location: downtown }))),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps people without the capability out, with the right answer', async () => {
    const sam = await harbor.sam()
    const scheduler = await harbor.scheduler()
    const trainer = await lumen.trainer()
    await expect(
      asTenant(harborId, (tx) => buildReport(tx, sam, 'people', filters())),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      asTenant(harborId, (tx) => buildReport(tx, scheduler, 'training', filters())),
    ).rejects.toBeInstanceOf(NotFoundError)
    // Holds training reporting, asks for schedule reporting: told, not hidden.
    await expect(
      asTenant(lumenId, (tx) => buildReport(tx, trainer, 'schedule', filters())),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('never crosses tenants, and never carries ids or sensitive fields', async () => {
    const ana = await lumen.owner()
    const harborLocation = await location(harborId, 'Riverside')
    await expect(
      asTenant(lumenId, (tx) =>
        buildReport(tx, ana, 'operations', filters({ location: harborLocation })),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    const harborNames = (
      await query<{ display_name: string }>(
        'select display_name from employments where organization_id = $1',
        [harborId],
      )
    )
      .map((r) => r.display_name)
      .filter((n) => n !== 'Noa Feldman') // employed by both, on purpose
    const sensitive = (
      await query<{ email: string | null; phone: string | null }>(
        'select email, phone from employments where organization_id = $1',
        [lumenId],
      )
    )
      .flatMap((r) => [r.email, r.phone])
      .filter((v): v is string => !!v)

    for (const key of REPORT_KEYS) {
      const { report } = await asTenant(lumenId, (tx) => buildReport(tx, ana, key, filters()))
      const text = JSON.stringify(report.tables.map((t) => t.rows.map((r) => r.cells)))
      expect(text, `${key} contains an internal id`).not.toMatch(UUID)
      for (const name of harborNames) expect(text, `${key} mentions ${name}`).not.toContain(name)
      for (const value of sensitive)
        expect(text, `${key} contains a sensitive field`).not.toContain(value)
    }
  })

  it('exports exactly the permitted rows, neutralises formulas, and audits it', async () => {
    const gm = await harbor.gmRiverside()
    const riverside = await location(harborId, 'Riverside')
    const pool = await migrationClient()
    // A skip reason written to be dangerous in a spreadsheet.
    const [item] = (
      await pool.query<{ id: string; employment: string }>(
        `select i.id, r.assignee_employment_id as employment from ops_task_items i
           join ops_runs r on r.id = i.run_id join ops_tasks t on t.id = i.task_id
          where r.organization_id = $1 and r.location_id = $2 and t.required and i.status = 'pending'
            and r.business_date between current_date - 7 and current_date + 7
          order by r.business_date desc limit 1`,
        [harborId, riverside],
      )
    ).rows
    await pool.query(
      `update ops_task_items set status = 'skipped', reason = '=HYPERLINK("http://evil.example","click")',
         completed_at = now(), completed_by_employment_id = $2 where id = $1`,
      [item!.id, item!.employment],
    )

    const result = await asTenant(harborId, (tx) =>
      exportReport(tx, gm, 'operations', {
        table: 'skipped',
        from: addDays(-300),
        to: addDays(30),
      }),
    )
    expect(result.fileName).toMatch(/^evercalm-operations-skipped-.*\.csv$/)
    expect(result.csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`)
    expect(result.csv).not.toMatch(UUID)
    expect(result.csv).not.toContain('Downtown')

    const [audit] = await query<{ n: string }>(
      `select count(*) as n from audit_events where organization_id = $1 and action = 'report.exported' and actor_employment_id = $2`,
      [harborId, gm.employmentId],
    )
    expect(Number(audit!.n)).toBeGreaterThanOrEqual(1)

    // No export capability, no export - even with the report itself.
    const scheduler = await harbor.scheduler()
    await expect(
      asTenant(harborId, (tx) => exportReport(tx, scheduler, 'schedule', {})),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('billing', () => {
  it('records a provider event once, however many times it is delivered', async () => {
    const event = {
      id: `mock_evt_${Date.now()}`,
      type: 'payment_succeeded' as const,
      subscriptionRef: 'mock_sub_harborvine',
      occurredAt: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86_400_000),
    }
    const first = await asTenant(harborId, (tx) => handleProviderEvent(tx, harborId, event))
    const second = await asTenant(harborId, (tx) => handleProviderEvent(tx, harborId, event))
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    const [rows] = await query<{ n: string }>(
      `select count(*) as n from billing_events where idempotency_key = $1`,
      [`provider:mock:${event.id}`],
    )
    expect(Number(rows!.n)).toBe(1)
  })

  it('authenticates webhooks and acknowledges replays without applying them twice', async () => {
    const signingValue = 'integration-webhook-test-value-0123456789abcdef'
    const handle = await db()
    const deps = {
      provider: mockProvider({ secret: signingValue, production: false }),
      organizationFor: (provider: string, ref: string) =>
        organizationForProviderSubscription(provider, ref, handle),
      runTenant: asTenant,
    }
    try {
      const body = JSON.stringify({
        id: `mock_evt_hook_${Date.now()}`,
        type: 'payment_failed',
        subscriptionRef: 'mock_sub_harborvine',
        occurredAt: new Date().toISOString(),
      })
      expect(await receiveBillingWebhook(body, '0'.repeat(64), deps)).toEqual({ status: 404 })
      expect(await receiveBillingWebhook(body, null, deps)).toEqual({ status: 404 })
      expect(await receiveBillingWebhook(body, signMockPayload(body, signingValue), deps)).toEqual({
        status: 200,
        body: { received: true, duplicate: false },
      })
      expect(await receiveBillingWebhook(body, signMockPayload(body, signingValue), deps)).toEqual({
        status: 200,
        body: { received: true, duplicate: true },
      })
      const stranger = body.replace('mock_sub_harborvine', 'mock_sub_nobody')
      expect(
        await receiveBillingWebhook(stranger, signMockPayload(stranger, signingValue), deps),
      ).toEqual({ status: 404 })
      expect(
        await receiveBillingWebhook(body, signMockPayload(body, signingValue), {
          ...deps,
          provider: mockProvider({ secret: signingValue, production: true }),
        }),
      ).toEqual({ status: 404 })
      const [sub] = await query<{ status: string }>(
        'select status from subscriptions where organization_id = $1',
        [harborId],
      )
      expect(sub!.status).toBe('past_due')
    } finally {
      await (
        await migrationClient()
      ).query(
        `update subscriptions set status = 'active', past_due_since = null where organization_id = $1`,
        [harborId],
      )
    }
  })

  it('suspends after the grace period, leaves administration read-only, and keeps employees in their records', async () => {
    const pool = await migrationClient()
    try {
      await pool.query(
        `update subscriptions set status = 'past_due', past_due_since = now() - interval '15 days' where organization_id = $1`,
        [lumenId],
      )
      const graceOwner = await lumen.owner()
      expect(graceOwner.accessMode).toBe('grace')
      expect(can(graceOwner, 'schedule.publish')).toBe(true)

      expect(
        await asTenant(lumenId, (tx) => processBillingLifecycle(tx, lumenId, new Date())),
      ).toBe(1)
      expect(
        await asTenant(lumenId, (tx) => processBillingLifecycle(tx, lumenId, new Date())),
      ).toBe(0)

      const owner = await lumen.owner()
      expect(owner.accessMode).toBe('read_only')
      expect(can(owner, 'schedule.publish')).toBe(false)
      expect(can(owner, 'people.invite')).toBe(false)
      expect(can(owner, 'billing.manage')).toBe(true)
      expect(can(owner, 'report.export')).toBe(true)
      await expect(
        asTenant(lumenId, (tx) => changePlan(tx, owner, 'essentials')),
      ).rejects.toBeInstanceOf(ValidationError)

      // An employee still has their own training.
      const elodie = await actor(lumenId, 'elodie@lumensalon.test')
      const training = await asTenant(lumenId, (tx) => myTraining(tx, elodie))
      expect(training.overview.active.length + training.overview.completed.length).toBeGreaterThan(
        0,
      )

      const overview = await asTenant(lumenId, (tx) => getBillingOverview(tx, owner))
      expect(overview.subscription.status).toBe('suspended')
      expect(overview.events.map((e) => e.type)).toContain('grace_expired')
    } finally {
      await pool.query(
        `update subscriptions set status = 'trialing', past_due_since = null, suspended_at = null where organization_id = $1`,
        [lumenId],
      )
    }
  })

  it('cancels at period end, and keeps billing history immutable', async () => {
    const owner = await harbor.owner()
    await asTenant(harborId, (tx) => requestCancellation(tx, owner))
    const [sub] = await query<{ status: string; cancel_at_period_end: boolean }>(
      'select status, cancel_at_period_end from subscriptions where organization_id = $1',
      [harborId],
    )
    expect(sub).toEqual({ status: 'active', cancel_at_period_end: true })
    expect(
      await codeOf(rawAsApp(harborId, 'update billing_events set summary = $1', ['rewritten'])),
    ).toBe('42501')
    expect(await codeOf(rawAsApp(harborId, 'delete from billing_events'))).toBe('42501')
    expect(await codeOf(rawAsApp(harborId, 'delete from subscriptions'))).toBe('42501')
    // Another tenant sees none of it.
    const seen = await rawAsApp(
      lumenId,
      'select count(*)::int as n from billing_events where organization_id = $1',
      [harborId],
    )
    expect(seen.rows[0].n).toBe(0)
    await (
      await migrationClient()
    ).query(
      'update subscriptions set cancel_at_period_end = false, cancel_requested_at = null where organization_id = $1',
      [harborId],
    )
  })
})

describe('support', () => {
  it('keeps EverCalm internal notes away from customers, in the service and the database', async () => {
    const owner = await harbor.owner()
    const caseId = await asTenant(harborId, (tx) =>
      createCase(tx, owner, {
        category: 'problem',
        severity: 'normal',
        subject: 'Report export is slow',
        description: 'The training export took a minute to download.',
      }),
    )
    await staffCaseNote(
      staff.agent(),
      caseId,
      'INTERNAL: customer on slow wifi, not a platform issue',
      await db(),
    )
    await staffCaseUpdate(
      staff.agent(),
      caseId,
      { body: 'Thanks. We are looking into it.', status: 'in_progress' },
      await db(),
    )

    const detail = await asTenant(harborId, (tx) => getCase(tx, owner, caseId))
    expect(JSON.stringify(detail)).not.toContain('INTERNAL')
    expect(detail.status).toBe('in_progress')
    expect(detail.messages.map((m) => m.authorType)).toEqual(['evercalm'])

    // The runtime role cannot touch the notes table at all.
    expect(await codeOf(rawAsApp(harborId, 'select * from support_internal_notes'))).toBe('42501')
    // The customer's audit log records a note exists, never what it says.
    const audits = await query<{ summary: string; actor_type: string }>(
      `select summary, actor_type from audit_events where organization_id = $1 and subject_id = $2 order by created_at`,
      [harborId, caseId],
    )
    expect(audits.map((a) => a.actor_type)).toEqual(['user', 'support', 'support'])
    expect(JSON.stringify(audits)).not.toContain('INTERNAL')

    // The owner was notified of the reply, in-app.
    const [notice] = await query<{ n: string }>(
      `select count(*) as n from notifications where subject_id = $1 and employment_id = $2 and category = 'support'`,
      [caseId, owner.employmentId],
    )
    expect(Number(notice!.n)).toBe(1)

    // Staff see the whole thread.
    const thread = await staffCaseThread(staff.agent(), caseId, await db())
    expect(thread.map((t) => t.kind).sort()).toEqual(['evercalm', 'internal'])

    // Resolved, then reopened by the customer replying.
    await staffCaseUpdate(staff.agent(), caseId, { body: '', status: 'resolved' }, await db())
    expect(
      await asTenant(harborId, (tx) => replyToCase(tx, owner, caseId, 'Still slow on Tuesday.')),
    ).toBe('open')
    const [row] = await query<{ status: string; reopened_count: number }>(
      'select status, reopened_count from support_cases where id = $1',
      [caseId],
    )
    expect(row).toEqual({ status: 'open', reopened_count: 1 })
    expect(
      await codeOf(rawAsApp(harborId, 'delete from support_cases where id = $1', [caseId])),
    ).toBe('42501')
    expect(
      await codeOf(rawAsApp(harborId, 'update support_case_messages set body = $1', ['x'])),
    ).toBe('42501')
  })

  it('shows customers only their own organization’s cases, and only to support.manage', async () => {
    const ana = await lumen.owner()
    const [harborCase] = await query<{ id: string }>(
      'select id from support_cases where organization_id = $1 limit 1',
      [harborId],
    )
    await expect(
      asTenant(lumenId, (tx) => getCase(tx, ana, harborCase!.id)),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(
      (await asTenant(lumenId, (tx) => listCases(tx, ana))).every((c) =>
        c.reference.startsWith('EC-'),
      ),
    ).toBe(true)
    const gm = await harbor.gmRiverside()
    await expect(asTenant(harborId, (tx) => listCases(tx, gm))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('the EverCalm team', () => {
  it('has no way into a customer session', async () => {
    const staffUser = staff.admin()
    const memberships = await query<{ n: string }>(
      'select count(*) as n from employments where user_id = $1',
      [staffUser],
    )
    expect(Number(memberships[0]!.n)).toBe(0)
    for (const org of [harborId, lumenId]) {
      expect(await asTenant(org, (tx) => resolveActor(tx, org, staffUser))).toBeNull()
    }
  })

  it('refuses every staff function to anyone who is not staff', async () => {
    const dana = users.get('dana@harborvine.test')!
    await expect(staffOrganizations(dana, null, await db())).rejects.toBeInstanceOf(NotFoundError)
    await expect(staffCases(dana, {}, await db())).rejects.toBeInstanceOf(NotFoundError)
    // A support agent cannot retry deliveries; an administrator can, with a reason.
    await expect(
      staffRetryDeliveries(staff.agent(), harborId, 'testing', await db()),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      staffRetryDeliveries(staff.admin(), harborId, '  ', await db()),
    ).rejects.toBeInstanceOf(ValidationError)
    const retried = await staffRetryDeliveries(
      staff.admin(),
      harborId,
      'Provider timeout on Thursday',
      await db(),
    )
    expect(retried).toBeGreaterThanOrEqual(1)
    const [audit] = await query<{ actor_type: string; metadata: { count: number } }>(
      `select actor_type, metadata from audit_events where organization_id = $1 and action = 'support.deliveries_retried' order by created_at desc limit 1`,
      [harborId],
    )
    expect(audit).toMatchObject({ actor_type: 'support', metadata: { count: retried } })
  })

  it('sees counts and statuses, never people', async () => {
    const [org] = await staffOrganizations(staff.agent(), harborId, await db())
    expect(org).toMatchObject({ name: 'Harbor & Vine', locations: 2 })
    expect(Object.keys(org!)).not.toContain('employees')
    expect(JSON.stringify(org)).not.toContain('Sam Whitfield')
  })
})

describe('reliability', () => {
  it('records worker failures and shows each organization only its own', async () => {
    await runWorkerTick({
      now: () => new Date(),
      dueOrganizations: () => Promise.resolve([harborId]),
      runTenant: () => Promise.reject(new Error('simulated outage')),
      recordRun: true,
      recordRunImpl: async (run) => recordWorkerRun(run, await db()),
    })
    const [latest] = await query<{ error_count: number; errors: { organizationId: string }[] }>(
      'select error_count, errors from worker_runs order by finished_at desc limit 1',
    )
    expect(latest!.error_count).toBeGreaterThan(0)
    expect(latest!.errors.every((e) => e.organizationId === harborId)).toBe(true)

    const owner = await harbor.owner()
    const harborStatus = await asTenant(harborId, (tx) => getSystemStatus(tx, owner))
    expect(harborStatus.worker.errors24h).toBeGreaterThan(0)
    const ana = await lumen.owner()
    const lumenStatus = await asTenant(lumenId, (tx) => getSystemStatus(tx, ana))
    // Lumen's seeded worker error is older than a day or its own; Harbor's outage never counts for Lumen.
    const [lumenOwn] = await query<{ n: string }>(
      `select count(*) as n from worker_runs w, jsonb_array_elements(w.errors) e where w.finished_at > now() - interval '1 day' and e->>'organizationId' = $1`,
      [lumenId],
    )
    expect(lumenStatus.worker.errors24h).toBe(Number(lumenOwn!.n))
  })

  it('lets an owner retry failed deliveries, audited, and nobody else', async () => {
    const pool = await migrationClient()
    await pool.query(
      `update notifications set status = 'failed', failed_at = now() - interval '1 hour', failure_reason = 'Email provider error: timeout'
        where id = (select id from notifications where organization_id = $1 and channel = 'email' limit 1)`,
      [harborId],
    )
    const gm = await harbor.gmRiverside()
    await expect(
      asTenant(harborId, (tx) => retryFailedNotifications(tx, gm)),
    ).rejects.toBeInstanceOf(ForbiddenError)
    const owner = await harbor.owner()
    const n = await asTenant(harborId, (tx) => retryFailedNotifications(tx, owner))
    expect(n).toBeGreaterThanOrEqual(1)
    const [audit] = await query<{ n: string }>(
      `select count(*) as n from audit_events where organization_id = $1 and action = 'notification.retried'`,
      [harborId],
    )
    expect(Number(audit!.n)).toBeGreaterThanOrEqual(1)
    expect(await codeOf(rawAsApp(harborId, 'delete from worker_runs'))).toBe('42501')
  })
})
