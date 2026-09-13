import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cancelForSubject,
  claimDueNotifications,
  completeDelivery,
  enqueue,
  listInApp,
  markNotificationRead,
  retryFailed,
  saveSettings,
  setPreference,
} from '@/modules/notifications/service'
import { createAnnouncement, listCategories, publishAnnouncement } from '@/modules/comms/service'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

/**
 * NOTIFICATION DELIVERY, against real PostgreSQL.
 *
 * What is under test is the promise the preferences screen makes:
 *
 *   a switch you turn off is honoured, and the fact is recorded
 *   a mandatory message ignores the switch, on purpose
 *   quiet hours delay and never drop
 *   the same message enqueued twice produces one row
 *   a failure is recorded with a reason and can be retried
 */

let harborId: string
const userIds = new Map<string, string>()

const OWNER = 'dana@harborvine.test'
const EMPLOYEE = 'sam@harborvine.test'

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  const pool = await migrationClient()
  const users = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of users.rows) userIds.set(row.email, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

async function actorFor(email: string): Promise<Actor> {
  const userId = userIds.get(email)
  if (!userId) throw new Error(`Seeded user ${email} not found`)
  const actor = await asTenant(harborId, (tx) => resolveActor(tx, harborId, userId))
  if (!actor) throw new Error(`No actor for ${email}`)
  return actor
}

/** A unique subject id per test, so idempotency keys never collide. */
function subject(): string {
  return crypto.randomUUID()
}

function input(employmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    employmentId,
    category: 'general',
    channel: 'in_app' as const,
    subjectType: 'test',
    subjectId: subject(),
    title: 'A notification',
    preview: 'Something short',
    ...overrides,
  }
}

async function statusOf(subjectId: string): Promise<string[]> {
  const pool = await migrationClient()
  const { rows } = await pool.query<{ status: string }>(
    `select status from notifications where subject_id = $1`,
    [subjectId],
  )
  return rows.map((r) => r.status)
}

describe('preferences', () => {
  it('delivers by default, without anybody opting in', async () => {
    const employee = await actorFor(EMPLOYEE)
    const row = input(employee.employmentId)
    const outcome = await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    expect(outcome.created).toBe(1)
    expect(outcome.suppressed).toBe(0)
    expect(await statusOf(row.subjectId)).toEqual(['pending'])
  })

  it('SUPPRESSES rather than skips when a switch is off', async () => {
    const employee = await actorFor(EMPLOYEE)
    await asTenant(harborId, (tx) =>
      setPreference(tx, employee, employee.employmentId, 'schedule', 'in_app', false),
    )

    const row = input(employee.employmentId, { category: 'schedule' })
    const outcome = await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    // The row exists, marked suppressed: evidence that we deliberately did not
    // tell somebody something, rather than silence.
    expect(outcome.created).toBe(1)
    expect(await statusOf(row.subjectId)).toEqual(['suppressed'])

    await asTenant(harborId, (tx) =>
      setPreference(tx, employee, employee.employmentId, 'schedule', 'in_app', true),
    )
  })

  it('a switch is per channel', async () => {
    const employee = await actorFor(EMPLOYEE)
    await asTenant(harborId, (tx) =>
      setPreference(tx, employee, employee.employmentId, 'training', 'email', false),
    )

    const inApp = input(employee.employmentId, { category: 'training', channel: 'in_app' })
    const email = input(employee.employmentId, { category: 'training', channel: 'email' })
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [inApp, email]))

    expect(await statusOf(inApp.subjectId)).toEqual(['pending'])
    expect(await statusOf(email.subjectId)).toEqual(['suppressed'])
  })

  it('a message that overrides preferences ignores the switch', async () => {
    const employee = await actorFor(EMPLOYEE)
    await asTenant(harborId, (tx) =>
      setPreference(tx, employee, employee.employmentId, 'safety', 'in_app', false),
    )

    const row = input(employee.employmentId, { category: 'safety', overridesPreferences: true })
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))
    expect(await statusOf(row.subjectId)).toEqual(['pending'])
  })

  it('lets an administrator change preferences, and refuses everyone else', async () => {
    const owner = await actorFor(OWNER)
    const employee = await actorFor(EMPLOYEE)

    // The owner holds notification.administer, so this is allowed. It is put
    // back immediately: a preference left off here would silently suppress
    // every later test that uses the same category.
    await asTenant(harborId, (tx) =>
      setPreference(tx, owner, employee.employmentId, 'event', 'in_app', false),
    )
    await asTenant(harborId, (tx) =>
      setPreference(tx, owner, employee.employmentId, 'event', 'in_app', true),
    )

    // An employee has neither ownership of nor permission over somebody else's.
    await expect(
      asTenant(harborId, (tx) =>
        setPreference(tx, employee, owner.employmentId, 'general', 'in_app', false),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('quiet hours', () => {
  it('DELAYS rather than dropping, and clears the window', async () => {
    const employee = await actorFor(EMPLOYEE)
    await asTenant(harborId, (tx) =>
      saveSettings(tx, employee, employee.employmentId, {
        quietHoursEnabled: true,
        quietStart: 0,
        quietEnd: 23 * 60 + 59, // almost always quiet, so the test is stable
        timezone: 'UTC',
      }),
    )

    const row = input(employee.employmentId)
    const outcome = await asTenant(harborId, (tx) => enqueue(tx, harborId, [row], new Date()))

    expect(outcome.created).toBe(1)
    expect(await statusOf(row.subjectId)).toEqual(['pending'])

    const pool = await migrationClient()
    const { rows } = await pool.query<{ scheduled_for: Date; created_at: Date }>(
      `select scheduled_for, created_at from notifications where subject_id = $1`,
      [row.subjectId],
    )
    expect(rows[0]!.scheduled_for.getTime()).toBeGreaterThan(rows[0]!.created_at.getTime())

    await asTenant(harborId, (tx) =>
      saveSettings(tx, employee, employee.employmentId, {
        quietHoursEnabled: false,
        quietStart: 22 * 60,
        quietEnd: 7 * 60,
        timezone: null,
      }),
    )
  })

  it('a message allowed to override quiet hours arrives immediately', async () => {
    const employee = await actorFor(EMPLOYEE)
    await asTenant(harborId, (tx) =>
      saveSettings(tx, employee, employee.employmentId, {
        quietHoursEnabled: true,
        quietStart: 0,
        quietEnd: 23 * 60 + 59,
        timezone: 'UTC',
      }),
    )

    const now = new Date()
    const row = input(employee.employmentId, {
      overridesPreferences: true,
      overridesQuietHours: true,
    })
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [row], now))

    const pool = await migrationClient()
    const { rows } = await pool.query<{ scheduled_for: Date }>(
      `select scheduled_for from notifications where subject_id = $1`,
      [row.subjectId],
    )
    expect(Math.abs(rows[0]!.scheduled_for.getTime() - now.getTime())).toBeLessThan(2000)

    await asTenant(harborId, (tx) =>
      saveSettings(tx, employee, employee.employmentId, {
        quietHoursEnabled: false,
        quietStart: 22 * 60,
        quietEnd: 7 * 60,
        timezone: null,
      }),
    )
  })

  it('refuses an impossible time or an unknown zone', async () => {
    const employee = await actorFor(EMPLOYEE)
    await expect(
      asTenant(harborId, (tx) =>
        saveSettings(tx, employee, employee.employmentId, {
          quietHoursEnabled: true,
          quietStart: 5000,
          quietEnd: 0,
          timezone: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    await expect(
      asTenant(harborId, (tx) =>
        saveSettings(tx, employee, employee.employmentId, {
          quietHoursEnabled: true,
          quietStart: 0,
          quietEnd: 60,
          timezone: 'Mars/Olympus',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('idempotency', () => {
  it('the same message enqueued twice produces one row', async () => {
    const employee = await actorFor(EMPLOYEE)
    const row = input(employee.employmentId)

    const first = await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))
    const second = await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(second.duplicates).toBe(1)
    expect(await statusOf(row.subjectId)).toHaveLength(1)
  })

  it('a different PURPOSE for the same subject is a different message', async () => {
    const employee = await actorFor(EMPLOYEE)
    const subjectId = subject()
    const original = input(employee.employmentId, { subjectId, purpose: 'initial' })
    const reminder = input(employee.employmentId, { subjectId, purpose: 'reminder-1' })

    await asTenant(harborId, (tx) => enqueue(tx, harborId, [original]))
    const second = await asTenant(harborId, (tx) => enqueue(tx, harborId, [reminder]))

    expect(second.created).toBe(1)
    expect(await statusOf(subjectId)).toHaveLength(2)
  })

  it('a batch containing a duplicate still inserts the new ones', async () => {
    const employee = await actorFor(EMPLOYEE)
    const existing = input(employee.employmentId)
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [existing]))

    const fresh = input(employee.employmentId)
    const outcome = await asTenant(harborId, (tx) => enqueue(tx, harborId, [existing, fresh]))
    expect(outcome.created).toBe(1)
    expect(outcome.duplicates).toBe(1)
  })
})

describe('delivery', () => {
  /** Claim and complete in batches until nothing due is left - the worker's loop, by hand. */
  async function deliverEverythingDue(now: Date, fail?: (title: string) => string | null) {
    for (;;) {
      const claimed = await asTenant(harborId, (tx) =>
        claimDueNotifications(tx, harborId, { now, limit: 100 }),
      )
      await asTenant(harborId, async (tx) => {
        for (const n of claimed) {
          const reason = fail?.(n.title) ?? null
          await completeDelivery(
            tx,
            harborId,
            n,
            reason ? { kind: 'permanent', reason } : { kind: 'sent' },
            now,
          )
        }
      })
      if (claimed.length < 100) return
    }
  }

  it('marks due notifications sent', async () => {
    const employee = await actorFor(EMPLOYEE)
    const row = input(employee.employmentId)
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    await deliverEverythingDue(new Date())
    expect(await statusOf(row.subjectId)).toEqual(['sent'])
  })

  it('records a FAILURE with a reason, and can retry it', async () => {
    const employee = await actorFor(EMPLOYEE)
    const admin = await actorFor(OWNER)
    const row = input(employee.employmentId, { title: 'Refused upstream' })
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    await deliverEverythingDue(new Date(), (title) =>
      title === 'Refused upstream' ? 'Upstream refused the message' : null,
    )

    const pool = await migrationClient()
    const { rows } = await pool.query<{ status: string; failure_reason: string; attempts: number }>(
      `select status, failure_reason, attempts from notifications where subject_id = $1`,
      [row.subjectId],
    )
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.failure_reason).toContain('Upstream refused')
    expect(rows[0]?.attempts).toBe(1)

    // Retry needs notification.administer, which the owner holds.
    const { rows: ids } = await pool.query<{ id: string }>(
      `select id from notifications where subject_id = $1`,
      [row.subjectId],
    )
    await asTenant(harborId, (tx) => retryFailed(tx, admin, ids[0]!.id))
    expect(await statusOf(row.subjectId)).toEqual(['pending'])
  })

  it('refuses a retry without the administration capability', async () => {
    const employee = await actorFor(EMPLOYEE)
    await expect(
      asTenant(harborId, (tx) => retryFailed(tx, employee, crypto.randomUUID())),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('does not deliver anything scheduled for later', async () => {
    const employee = await actorFor(EMPLOYEE)
    const row = input(employee.employmentId)
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    await deliverEverythingDue(anHourAgo)
    expect(await statusOf(row.subjectId)).toEqual(['pending'])
  })

  it('cancels anything still queued for a retired subject', async () => {
    const employee = await actorFor(EMPLOYEE)
    const row = input(employee.employmentId)
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    const cancelled = await asTenant(harborId, (tx) =>
      cancelForSubject(tx, harborId, 'test', row.subjectId),
    )
    expect(cancelled).toBe(1)
    expect(await statusOf(row.subjectId)).toEqual(['cancelled'])
  })
})

describe('the in-app list', () => {
  it('is readable by its owner and by nobody else', async () => {
    const employee = await actorFor(EMPLOYEE)
    const owner = await actorFor(OWNER)

    const mine = await asTenant(harborId, (tx) =>
      listInApp(tx, employee, employee.employmentId, {}),
    )
    expect(Array.isArray(mine)).toBe(true)

    // Not even an owner holding notification.administer. That capability is
    // for inspecting the delivery queue, not for reading somebody's messages.
    await expect(
      asTenant(harborId, (tx) => listInApp(tx, owner, employee.employmentId, {})),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('marking read only affects your own row', async () => {
    const employee = await actorFor(EMPLOYEE)
    const owner = await actorFor(OWNER)
    const row = input(employee.employmentId)
    await asTenant(harborId, (tx) => enqueue(tx, harborId, [row]))

    const pool = await migrationClient()
    const { rows: ids } = await pool.query<{ id: string }>(
      `select id from notifications where subject_id = $1`,
      [row.subjectId],
    )

    // The owner tries to dismiss the employee's notification; the WHERE clause
    // on employment_id means it simply matches nothing.
    await asTenant(harborId, (tx) => markNotificationRead(tx, owner, ids[0]!.id))
    const { rows: after } = await pool.query<{ read_at: Date | null }>(
      `select read_at from notifications where id = $1`,
      [ids[0]!.id],
    )
    expect(after[0]?.read_at).toBeNull()

    await asTenant(harborId, (tx) => markNotificationRead(tx, employee, ids[0]!.id))
    const { rows: mine } = await pool.query<{ read_at: Date | null }>(
      `select read_at from notifications where id = $1`,
      [ids[0]!.id],
    )
    expect(mine[0]?.read_at).not.toBeNull()
  })
})

describe('publishing queues notifications', () => {
  it('queues one per recipient, and never the body', async () => {
    const owner = await actorFor(OWNER)
    const categories = await asTenant(harborId, (tx) => listCategories(tx, harborId))
    const general = categories.find((c) => c.key === 'general')!
    const employee = await actorFor(EMPLOYEE)

    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(
        tx,
        owner,
        {
          title: 'Queued announcement',
          body: 'A long body that must never end up in a delivery record. '.repeat(6),
          categoryId: general.id,
          priority: 'normal',
          requiresAcknowledgement: false,
          acknowledgementDueAt: null,
          expiresAt: null,
          callToActionLabel: null,
          callToActionHref: null,
          eventId: null,
        },
        [{ mode: 'include', selectorType: 'employment', selectorId: employee.employmentId }],
      ),
    )
    const outcome = await asTenant(harborId, (tx) => publishAnnouncement(tx, owner, id))
    expect(outcome.recipients).toBe(1)
    expect(outcome.notified).toBe(1)

    const pool = await migrationClient()
    const { rows } = await pool.query<{ preview: string; title: string; href: string }>(
      `select preview, title, href from notifications where subject_id = $1`,
      [id],
    )
    expect(rows[0]?.title).toBe('Queued announcement')
    // A short, bounded preview - not the body.
    expect(rows[0]?.preview.length).toBeLessThanOrEqual(141)
    expect(rows[0]?.href).toBe(`/my/inbox/${id}`)
  })
})

/*
 * THE DELIVERY POLICY, through a real publish.
 *
 * Needing a confirmation is not a reason to wake somebody. Only an explicitly
 * authorized urgent message in a safety, HR or emergency category - or an
 * emergency - arrives during quiet hours. See src/modules/comms/delivery-policy.ts.
 */
describe('who may be interrupted', () => {
  async function withSamAsleep<T>(fn: (sam: Actor, owner: Actor) => Promise<T>): Promise<T> {
    const sam = await actorFor(EMPLOYEE)
    const owner = await actorFor(OWNER)
    await asTenant(harborId, (tx) =>
      saveSettings(tx, sam, sam.employmentId, {
        quietHoursEnabled: true,
        quietStart: 0,
        quietEnd: 23 * 60 + 59,
        timezone: 'UTC',
      }),
    )
    try {
      return await fn(sam, owner)
    } finally {
      await asTenant(harborId, (tx) =>
        saveSettings(tx, sam, sam.employmentId, {
          quietHoursEnabled: false,
          quietStart: 22 * 60,
          quietEnd: 7 * 60,
          timezone: null,
        }),
      )
    }
  }

  async function publishTo(
    owner: Actor,
    sam: Actor,
    options: { category: string; priority: string; requiresAcknowledgement: boolean },
  ) {
    const categories = await asTenant(harborId, (tx) => listCategories(tx, harborId))
    const category = categories.find((c) => c.key === options.category)!
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(
        tx,
        owner,
        {
          title: `Policy check ${options.category} ${options.priority}`,
          body: 'Policy check.',
          categoryId: category.id,
          priority: options.priority as 'normal',
          requiresAcknowledgement: options.requiresAcknowledgement,
          acknowledgementDueAt: null,
          expiresAt: null,
          callToActionLabel: null,
          callToActionHref: null,
          eventId: null,
        },
        [{ mode: 'include', selectorType: 'employment', selectorId: sam.employmentId }],
      ),
    )
    const publishedAt = Date.now()
    await asTenant(harborId, (tx) => publishAnnouncement(tx, owner, id))

    const pool = await migrationClient()
    const { rows } = await pool.query<{
      channel: string
      status: string
      scheduled_for: Date
      mandatory: boolean
      overrides_quiet_hours: boolean
    }>(
      `select channel, status, scheduled_for, mandatory, overrides_quiet_hours
         from notifications where subject_id = $1 order by channel`,
      [id],
    )
    const inApp = rows.find((r) => r.channel === 'in_app')!
    return {
      inApp,
      channels: rows.map((r) => r.channel),
      immediate: Math.abs(inApp.scheduled_for.getTime() - publishedAt) < 60_000,
    }
  }

  it('holds a ROUTINE acknowledgement request until quiet hours end', async () => {
    await withSamAsleep(async (sam, owner) => {
      const result = await publishTo(owner, sam, {
        category: 'general',
        priority: 'normal',
        requiresAcknowledgement: true,
      })
      expect(result.inApp.status).toBe('pending')
      expect(result.immediate).toBe(false)
      expect(result.inApp.overrides_quiet_hours).toBe(false)
      expect(result.inApp.mandatory).toBe(false)
      // Held, never dropped - and email follows the same rule.
      expect(result.channels).toEqual(['email', 'in_app'])
    })
  })

  it('still respects a muted category for a routine acknowledgement', async () => {
    const sam = await actorFor(EMPLOYEE)
    const owner = await actorFor(OWNER)
    await asTenant(harborId, (tx) =>
      setPreference(tx, sam, sam.employmentId, 'training', 'in_app', false),
    )
    try {
      const result = await publishTo(owner, sam, {
        category: 'training',
        priority: 'important',
        requiresAcknowledgement: true,
      })
      expect(result.inApp.status).toBe('suppressed')
    } finally {
      await asTenant(harborId, (tx) =>
        setPreference(tx, sam, sam.employmentId, 'training', 'in_app', true),
      )
    }
  })

  it('does not let a muted SAFETY notice be silenced, but waits for morning', async () => {
    await withSamAsleep(async (sam, owner) => {
      await asTenant(harborId, (tx) =>
        setPreference(tx, sam, sam.employmentId, 'safety', 'in_app', false),
      )
      try {
        const result = await publishTo(owner, sam, {
          category: 'safety',
          priority: 'normal',
          requiresAcknowledgement: true,
        })
        expect(result.inApp.status).toBe('pending')
        expect(result.inApp.mandatory).toBe(true)
        expect(result.immediate).toBe(false)
      } finally {
        await asTenant(harborId, (tx) =>
          setPreference(tx, sam, sam.employmentId, 'safety', 'in_app', true),
        )
      }
    })
  })

  it('delivers an URGENT safety notice immediately, overnight', async () => {
    await withSamAsleep(async (sam, owner) => {
      const result = await publishTo(owner, sam, {
        category: 'safety',
        priority: 'urgent',
        requiresAcknowledgement: true,
      })
      expect(result.inApp.overrides_quiet_hours).toBe(true)
      expect(result.immediate).toBe(true)
    })
  })

  it('does not interrupt for an urgent notice in an ordinary category', async () => {
    await withSamAsleep(async (sam, owner) => {
      const result = await publishTo(owner, sam, {
        category: 'general',
        priority: 'urgent',
        requiresAcknowledgement: true,
      })
      expect(result.immediate).toBe(false)
    })
  })

  it('delivers an EMERGENCY immediately, whatever was muted', async () => {
    await withSamAsleep(async (sam, owner) => {
      await asTenant(harborId, (tx) =>
        setPreference(tx, sam, sam.employmentId, 'general', 'in_app', false),
      )
      try {
        const result = await publishTo(owner, sam, {
          category: 'general',
          priority: 'emergency',
          requiresAcknowledgement: false,
        })
        expect(result.inApp.status).toBe('pending')
        expect(result.inApp.mandatory).toBe(true)
        expect(result.immediate).toBe(true)
      } finally {
        await asTenant(harborId, (tx) =>
          setPreference(tx, sam, sam.employmentId, 'general', 'in_app', true),
        )
      }
    })
  })
})
