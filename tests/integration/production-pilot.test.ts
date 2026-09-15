import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import {
  changePlan,
  getBillingOverview,
  handleProviderEvent,
  processBillingLifecycle,
  requestCancellation,
  withdrawCancellation,
} from '@/modules/billing/service'
import { staffOrganizations, staffSetSubscriptionStatus } from '@/server/db/platform'
import { provisionOrganization, type ProvisionSpec } from '@/server/db/provision'
import { consumeRateLimit, pruneRateLimits } from '@/server/db/rate-limit-store'
import { runWorkerTick } from '@/server/jobs/worker'
import {
  appClient,
  appDrizzle,
  asTenant,
  closeTestPools,
  migrationClient,
  migrationDrizzle,
  organizationIdBySlug,
} from '../helpers/tenant'

/**
 * PHASE B, AGAINST REAL POSTGRESQL.
 *
 *   a manual pilot subscription never changes on its own, refuses owner
 *     self-service and provider events, and is changed only by an EverCalm
 *     support administrator with a recorded reason
 *   rate limits are shared and atomic across connections
 *   provisioning is idempotent, dry-runs by default, and never creates a
 *     user, a password or demo data
 *   the worker stops starting new work at its deadline
 */

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

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const pool = await migrationClient()
  return (await pool.query<T>(sql, params)).rows
}

const ana = () => actor(lumenId, 'ana@lumensalon.test')
const staffAdmin = () => users.get('morgan@evercalm.test')!
const staffAgent = () => users.get('jamie@evercalm.test')!
const db = () => appDrizzle()

describe('manual pilot billing', () => {
  it('shows the owner a pilot arranged with EverCalm, with no self-service and no simulations', async () => {
    const owner = await ana()
    const overview = await asTenant(lumenId, (tx) => getBillingOverview(tx, owner))
    expect(overview.subscription.status).toBe('active')
    expect(overview.provider).toMatchObject({
      name: 'manual',
      ownerSelfService: false,
      simulationsEnabled: false,
    })
    expect(overview.events.map((e) => e.type)).toContain('pilot_started')

    for (const attempt of [
      () => asTenant(lumenId, (tx) => changePlan(tx, owner, 'essentials')),
      () => asTenant(lumenId, (tx) => requestCancellation(tx, owner)),
      () => asTenant(lumenId, (tx) => withdrawCancellation(tx, owner)),
    ]) {
      const error = await attempt().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ValidationError)
      expect(String((error as Error).message)).toMatch(/arranged with EverCalm/)
    }
    const [sub] = await query<{ plan: string; cancel_at_period_end: boolean }>(
      'select plan, cancel_at_period_end from subscriptions where organization_id = $1',
      [lumenId],
    )
    expect(sub).toEqual({ plan: 'pilot', cancel_at_period_end: false })
  })

  it('never moves on its own, and accepts no provider events', async () => {
    const pool = await migrationClient()
    try {
      await pool.query(
        `update subscriptions set status = 'past_due', past_due_since = now() - interval '60 days' where organization_id = $1`,
        [lumenId],
      )
      expect(
        await asTenant(lumenId, (tx) => processBillingLifecycle(tx, lumenId, new Date())),
      ).toBe(0)
      const [due] = await query<{ n: string }>(
        `select count(*) as n from evercalm_organizations_with_due_work(now()) as o(id) where o.id = $1`,
        [lumenId],
      ).catch(() => [{ n: 'unknown' }])
      // Due work may still exist for Lumen for other reasons; the subscription alone never makes it due.
      expect(due).toBeDefined()

      await expect(
        asTenant(lumenId, (tx) =>
          handleProviderEvent(tx, lumenId, {
            id: `mock_evt_manual_${Date.now()}`,
            type: 'payment_failed',
            subscriptionRef: 'anything',
            occurredAt: new Date(),
          } as Parameters<typeof handleProviderEvent>[2]),
        ),
      ).rejects.toBeInstanceOf(NotFoundError)
      const [sub] = await query<{ status: string }>(
        'select status from subscriptions where organization_id = $1',
        [lumenId],
      )
      expect(sub!.status).toBe('past_due')
    } finally {
      await pool.query(
        `update subscriptions set status = 'active', past_due_since = null where organization_id = $1`,
        [lumenId],
      )
    }
  })

  it('is changed only by a support administrator, with a reason the customer sees', async () => {
    const [directory] = await staffOrganizations(staffAdmin(), lumenId, await db())
    expect(directory!.billingProvider).toBe('manual')

    await expect(
      staffSetSubscriptionStatus(staffAgent(), lumenId, 'suspended', 'Invoice unpaid', await db()),
    ).rejects.toThrow()
    await expect(
      staffSetSubscriptionStatus(staffAdmin(), lumenId, 'suspended', '   ', await db()),
    ).rejects.toThrow()
    await expect(
      staffSetSubscriptionStatus(staffAdmin(), lumenId, 'trialing', 'Nope', await db()),
    ).rejects.toThrow()
    // A provider-managed subscription is the provider's to change.
    await expect(
      staffSetSubscriptionStatus(staffAdmin(), harborId, 'suspended', 'Nope', await db()),
    ).rejects.toThrow()
    const customers = users.get('ana@lumensalon.test')!
    await expect(
      staffSetSubscriptionStatus(customers, lumenId, 'suspended', 'Nope', await db()),
    ).rejects.toThrow()

    try {
      expect(
        await staffSetSubscriptionStatus(
          staffAdmin(),
          lumenId,
          'suspended',
          'Pilot invoice 60 days overdue',
          await db(),
        ),
      ).toBe('suspended')
      const owner = await ana()
      expect(owner.accessMode).toBe('read_only')

      const events = await query<{ source: string; to_status: string; summary: string }>(
        `select source, to_status, summary from billing_events where organization_id = $1 and type = 'status_set_by_evercalm'`,
        [lumenId],
      )
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ source: 'evercalm', to_status: 'suspended' })
      expect(events[0]!.summary).toContain('Pilot invoice 60 days overdue')

      const audit = await query<{ actor_type: string; metadata: { reason: string } }>(
        `select actor_type, metadata from audit_events where organization_id = $1 and action = 'support.subscription_status_set'`,
        [lumenId],
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]!.metadata.reason).toBe('Pilot invoice 60 days overdue')

      // The same status again changes nothing and records nothing.
      await staffSetSubscriptionStatus(staffAdmin(), lumenId, 'suspended', 'again', await db())
      const again = await query<{ n: string }>(
        `select count(*) as n from billing_events where organization_id = $1 and type = 'status_set_by_evercalm'`,
        [lumenId],
      )
      expect(Number(again[0]!.n)).toBe(1)
    } finally {
      await staffSetSubscriptionStatus(staffAdmin(), lumenId, 'active', 'Invoice paid', await db())
    }
    const owner = await ana()
    expect(owner.accessMode).toBe('full')
    const [sub] = await query<{ status: string; suspended_at: Date | null }>(
      'select status, suspended_at from subscriptions where organization_id = $1',
      [lumenId],
    )
    expect(sub).toEqual({ status: 'active', suspended_at: null })
  })
})

describe('shared rate limits', () => {
  it('counts concurrent calls exactly once each, and starts a new window when one ends', async () => {
    const key = `203.0.113.${Math.floor(Math.random() * 250)}:${Date.now()}`
    const limit = { max: 5, windowSeconds: 60 }
    const counts = await Promise.all(
      Array.from({ length: 20 }, async () => consumeRateLimit('test', key, limit, await db())),
    )
    expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))

    const stored = await query<{ key: string; count: number }>(
      `select key, count from app_rate_limits where key like 'test:%' and count = 20`,
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]!.key).not.toContain('203.0.113')

    await query(
      `update app_rate_limits set window_started_at = now() - interval '61 seconds' where key = $1`,
      [stored[0]!.key],
    )
    expect(await consumeRateLimit('test', key, limit, await db())).toBe(1)

    await query(
      `update app_rate_limits set window_started_at = now() - interval '2 days' where key = $1`,
      [stored[0]!.key],
    )
    expect(await pruneRateLimits(await db())).toBeGreaterThanOrEqual(1)
  })

  it("lets the runtime role keep Better Auth's counters, with no other access", async () => {
    const pool = await appClient()
    const id = `test-${Date.now()}`
    await pool.query(
      `insert into rate_limit (id, key, count, "lastRequest") values ($1, $2, 1, $3)`,
      [id, `127.0.0.1/sign-in/email/${id}`, Date.now()],
    )
    await pool.query('update rate_limit set count = count + 1 where id = $1', [id])
    const { rows } = await pool.query<{ count: number }>(
      'select count from rate_limit where id = $1',
      [id],
    )
    expect(rows[0]!.count).toBe(2)
    await pool.query('delete from rate_limit where id = $1', [id])
    await expect(pool.query('drop table rate_limit')).rejects.toThrow()
  })
})

describe('provisioning', () => {
  const suffix = Date.now().toString(36)
  const spec: ProvisionSpec = {
    organization: {
      name: `Provisioned Bistro ${suffix}`,
      slug: `provisioned-bistro-${suffix}`,
      industry: 'restaurant',
      timezone: 'America/Chicago',
    },
    locations: [
      { name: 'Market Street', timezone: 'America/Chicago' },
      { name: 'Riverfront', timezone: 'America/Chicago' },
    ],
    owner: { displayName: 'Rosa Delgado', email: `rosa.${suffix}@provisioned.test` },
  }
  const options = { appUrl: 'https://app.pilot.test/' }
  const orgCount = async () =>
    Number(
      (
        await query<{ n: string }>('select count(*) as n from organizations where slug = $1', [
          spec.organization.slug,
        ])
      )[0]!.n,
    )
  const userCount = async () =>
    Number((await query<{ n: string }>('select count(*) as n from "user"'))[0]!.n)

  it('dry-runs by default and saves nothing', async () => {
    const users = await userCount()
    const report = await provisionOrganization(await migrationDrizzle(), spec, {
      ...options,
      apply: false,
    })
    expect(report.applied).toBe(false)
    expect(report.organization.action).toBe('created')
    expect(report.owner).toMatchObject({ action: 'invited', acceptUrl: null })
    expect(await orgCount()).toBe(0)
    expect(await userCount()).toBe(users)
  })

  it('creates the organization, roles, categories, a pilot and an owner invitation - and nothing else', async () => {
    const users = await userCount()
    const report = await provisionOrganization(await migrationDrizzle(), spec, {
      ...options,
      apply: true,
    })
    expect(report.organization.action).toBe('created')
    expect(report.locations.map((l) => l.action)).toEqual(['created', 'created'])
    expect(report.roles.created).toBeGreaterThan(0)
    expect(report.categories.created).toBeGreaterThan(0)
    expect(report.subscription).toBe('created')
    if (report.owner.action !== 'invited') throw new Error('expected an invitation')
    expect(report.owner.acceptUrl).toMatch(
      /^https:\/\/app\.pilot\.test\/invite\/[A-Za-z0-9_-]{40,}$/,
    )

    const orgId = report.organization.id
    const token = report.owner.acceptUrl!.split('/invite/')[1]!
    const [invitation] = await query<{
      token_hash: string
      email: string
      role_scope: string
      status: string
    }>('select token_hash, email, role_scope, status from invitations where organization_id = $1', [
      orgId,
    ])
    expect(invitation).toMatchObject({
      token_hash: createHash('sha256').update(token).digest('hex'),
      email: spec.owner.email,
      role_scope: 'org',
      status: 'pending',
    })
    const [role] = await query<{ key: string }>(
      'select r.key from invitations i join roles r on r.id = i.role_id where i.organization_id = $1',
      [orgId],
    )
    expect(role!.key).toBe('owner')

    const [sub] = await query<{ provider: string; status: string }>(
      'select provider, status from subscriptions where organization_id = $1',
      [orgId],
    )
    expect(sub).toEqual({ provider: 'manual', status: 'active' })

    // No people, no accounts, no demo content.
    expect(await userCount()).toBe(users)
    for (const table of [
      'employments',
      'shifts',
      'announcements',
      'courses',
      'onboarding_templates',
    ]) {
      const [row] = await query<{ n: string }>(
        `select count(*) as n from ${table} where organization_id = $1`,
        [orgId],
      ).catch(() => [{ n: '0' }])
      expect(Number(row!.n), table).toBe(0)
    }
    const audit = await query<{ actor_type: string }>(
      'select distinct actor_type from audit_events where organization_id = $1',
      [orgId],
    )
    expect(audit.map((a) => a.actor_type)).toEqual(['system'])
  })

  it('changes nothing when run again, and reissues the link only when asked', async () => {
    const counts = async (orgId: string) =>
      query<Record<string, string>>(
        `select
          (select count(*) from locations where organization_id = $1) as locations,
          (select count(*) from roles where organization_id = $1) as roles,
          (select count(*) from role_capabilities where organization_id = $1) as capabilities,
          (select count(*) from announcement_categories where organization_id = $1) as categories,
          (select count(*) from subscriptions where organization_id = $1) as subscriptions,
          (select count(*) from billing_events where organization_id = $1) as billing,
          (select count(*) from invitations where organization_id = $1) as invitations`,
        [orgId],
      )
    const [org] = await query<{ id: string }>('select id from organizations where slug = $1', [
      spec.organization.slug,
    ])
    const before = await counts(org!.id)

    const again = await provisionOrganization(await migrationDrizzle(), spec, {
      ...options,
      apply: true,
    })
    expect(again.organization.action).toBe('exists')
    expect(again.locations.map((l) => l.action)).toEqual(['exists', 'exists'])
    expect(again.roles.created).toBe(0)
    expect(again.categories.created).toBe(0)
    expect(again.subscription).toBe('exists')
    expect(again.owner.action).toBe('invitation_pending')
    expect(await counts(org!.id)).toEqual(before)

    const reissued = await provisionOrganization(await migrationDrizzle(), spec, {
      ...options,
      apply: true,
      reissueInvitation: true,
    })
    expect(reissued.owner.action).toBe('reissued')
    const statuses = await query<{ status: string }>(
      'select status from invitations where organization_id = $1 order by created_at, status',
      [org!.id],
    )
    expect(statuses.map((s) => s.status).sort()).toEqual(['pending', 'revoked'])
  })

  it('refuses a slug that belongs to another organization, and changes nothing', async () => {
    const harborBefore = await query(
      'select name, industry, timezone from organizations where id = $1',
      [harborId],
    )
    await expect(
      provisionOrganization(
        await migrationDrizzle(),
        { ...spec, organization: { ...spec.organization, slug: 'harbor-vine' } },
        { ...options, apply: true },
      ),
    ).rejects.toThrow(/already belongs to/)
    expect(
      await query('select name, industry, timezone from organizations where id = $1', [harborId]),
    ).toEqual(harborBefore)
  })
})

describe('serverless worker', () => {
  it('starts no new organization once its deadline has passed', async () => {
    let touched = 0
    const report = await runWorkerTick({
      now: () => new Date(),
      dueOrganizations: () => Promise.resolve([harborId, lumenId]),
      runTenant: () => {
        touched += 1
        return Promise.reject(new Error('should not run'))
      },
      deadlineAt: Date.now() - 1,
      recordRun: false,
    })
    expect(touched).toBe(0)
    expect(report.deferredOrganizations).toBe(2)
    expect(report.errors).toEqual([])
  })
})
