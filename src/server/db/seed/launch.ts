import { hash as argon2Hash } from '@node-rs/argon2'
import { eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { newId } from '@/lib/ids'
import * as schema from '../full-schema'
import { SEED_PASSWORD } from './data'

/*
 * LAUNCH-READINESS DEMO DATA.
 *
 *   Harbor & Vine   an active multi-location subscription with a real-looking
 *                   history, a support case in progress (with an EverCalm
 *                   internal note the owner must never see), a resolved billing
 *                   question, and a couple of email deliveries that failed.
 *   Lumen Salon     a manual pilot (billing arranged with EverCalm), and a fresh, unanswered
 *                   high-severity case about Boise times.
 *   EverCalm        two support staff with no employment anywhere, and a few
 *                   recorded worker runs, one with an error.
 */

type SeedDb = NodePgDatabase<typeof schema>

const DAY = 86_400_000
const HOUR = 3_600_000
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export const SEED_STAFF = [
  { email: 'morgan@evercalm.test', name: 'Morgan Ellis', role: 'support_admin' },
  { email: 'jamie@evercalm.test', name: 'Jamie Park', role: 'support_agent' },
] as const

interface Context {
  organizationId: string
  slug: string
  employmentIds: Map<string, string>
}

export async function seedBillingAndSupport(
  db: SeedDb,
  ctx: Context,
  now = new Date(),
): Promise<{ cases: number }> {
  const org = ctx.organizationId
  const person = (key: string) => {
    const id = ctx.employmentIds.get(key)
    if (!id) throw new Error(`Launch seed: unknown person ${key} in ${ctx.slug}`)
    return id
  }
  const active = await db
    .select({ id: schema.employments.id })
    .from(schema.employments)
    .where(eq(schema.employments.organizationId, org))
  const quantity = active.length

  const subscriptionId = newId()
  const event = (
    type: string,
    source: 'owner' | 'provider' | 'system',
    daysAgo: number,
    summary: string,
    from: string | null,
    to: string | null,
    actorLabel = '',
  ) => ({
    id: newId(),
    organizationId: org,
    subscriptionId,
    type,
    source,
    idempotencyKey: `seed:${type}:${daysAgo}:${newId()}`,
    fromStatus: from,
    toStatus: to,
    summary,
    actorLabel,
    occurredAt: new Date(now.getTime() - daysAgo * DAY),
  })

  if (ctx.slug === 'harbor-vine') {
    await db.insert(schema.subscriptions).values({
      id: subscriptionId,
      organizationId: org,
      plan: 'multi_location',
      status: 'active',
      trialStartsAt: new Date(now.getTime() - 75 * DAY),
      trialEndsAt: new Date(now.getTime() - 45 * DAY),
      quantity,
      currentPeriodStart: new Date(now.getTime() - 12 * DAY),
      currentPeriodEnd: new Date(now.getTime() + 18 * DAY),
      hasPaymentMethod: true,
      billingContactName: 'Dana Okafor',
      billingContactEmail: 'billing@harborvine.test',
      providerCustomerRef: 'mock_cus_harborvine',
      providerSubscriptionRef: 'mock_sub_harborvine',
    })
    await db
      .insert(schema.billingEvents)
      .values([
        event('trial_started', 'system', 75, 'Trial started', null, 'trialing', 'EverCalm'),
        event(
          'contact_updated',
          'owner',
          60,
          'Billing contact updated',
          'trialing',
          'trialing',
          'Dana Okafor',
        ),
        event(
          'plan_changed',
          'owner',
          50,
          'Plan changed from Pilot to Multi-location',
          'trialing',
          'trialing',
          'Dana Okafor',
        ),
        event(
          'payment_method_added',
          'provider',
          47,
          'Payment method added',
          'trialing',
          'trialing',
          'mock provider',
        ),
        event('trial_ended', 'system', 45, 'Trial ended', 'trialing', 'active', 'EverCalm'),
        event(
          'payment_succeeded',
          'provider',
          42,
          'Payment succeeded',
          'active',
          'active',
          'mock provider',
        ),
        event(
          'payment_succeeded',
          'provider',
          12,
          'Payment succeeded',
          'active',
          'active',
          'mock provider',
        ),
      ])
  } else {
    // A manual pilot: billing arranged directly with EverCalm, nothing charged.
    await db.insert(schema.subscriptions).values({
      id: subscriptionId,
      organizationId: org,
      plan: 'pilot',
      status: 'active',
      provider: 'manual',
      currentPeriodStart: new Date(now.getTime() - 21 * DAY),
      quantity,
      billingContactName: 'Ana Beltrán',
      billingContactEmail: 'accounts@lumensalon.test',
    })
    await db
      .insert(schema.billingEvents)
      .values([
        event(
          'pilot_started',
          'system',
          21,
          'Pilot started. Billing is arranged directly with EverCalm; nothing is charged here.',
          null,
          'active',
          'EverCalm',
        ),
      ])
  }

  // --- support cases ---------------------------------------------------------
  const cases: {
    reference: string
    creator: string
    category: string
    severity: string
    status: string
    subject: string
    description: string
    createdHoursAgo: number
    assignee?: string
    messages: {
      from: 'customer' | 'evercalm'
      hoursAgo: number
      body: string
      statusFrom?: string
      statusTo?: string
      author?: string
    }[]
    notes: { hoursAgo: number; body: string; author: string }[]
  }[] =
    ctx.slug === 'harbor-vine'
      ? [
          {
            reference: 'EC-HV7K2Q',
            creator: 'owner',
            category: 'problem',
            severity: 'normal',
            status: 'in_progress',
            subject: 'A server did not get the schedule email',
            description:
              'Theo at Downtown says he never got the email when we published this week’s schedule. He can see his shifts in the app. Other people got theirs.',
            createdHoursAgo: 70,
            assignee: 'morgan@evercalm.test',
            messages: [
              {
                from: 'evercalm',
                hoursAgo: 52,
                statusFrom: 'open',
                statusTo: 'in_progress',
                author: 'Morgan Ellis',
                body: 'Thanks, Dana. Theo’s in-app notification was delivered; the email attempt timed out on our side. We have queued it to try again and will confirm here once it goes out.',
              },
            ],
            notes: [
              {
                hoursAgo: 51,
                author: 'Morgan Ellis',
                body: 'Two email deliveries for Harbor timed out at the provider on Thursday night. Not account-specific. Retried from diagnostics; watch the next worker run.',
              },
            ],
          },
          {
            reference: 'EC-HV3M9A',
            creator: 'owner',
            category: 'billing',
            severity: 'low',
            status: 'resolved',
            subject: 'Adding a third location next quarter',
            description:
              'We are opening a patio bar in the spring. Does Multi-location cover a third site, and does anything change?',
            createdHoursAgo: 14 * 24,
            messages: [
              {
                from: 'evercalm',
                hoursAgo: 13 * 24,
                author: 'Jamie Park',
                statusFrom: 'open',
                statusTo: 'resolved',
                body: 'Multi-location has no location limit, so add it whenever you are ready. Pilot pricing stays as agreed for the first year.',
              },
            ],
            notes: [],
          },
        ]
      : [
          {
            reference: 'EC-LS4P8R',
            creator: 'owner',
            category: 'question',
            severity: 'high',
            status: 'open',
            subject: 'Boise Bench shift times look an hour off',
            description:
              'Sierra says the Boise Bench schedule shows Ruben starting at 11:00 but he starts at 10:00. Portland looks right. Is Boise on the wrong time zone?',
            createdHoursAgo: 5,
            messages: [],
            notes: [],
          },
        ]

  const staffIds = new Map<string, string>()
  const staffRows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(
      inArray(
        schema.users.email,
        SEED_STAFF.map((s) => s.email),
      ),
    )
  for (const s of staffRows) staffIds.set(s.email, s.id)

  for (const c of cases) {
    const id = newId()
    const createdAt = new Date(now.getTime() - c.createdHoursAgo * HOUR)
    const lastMessage = c.messages.at(-1)
    const assignee = c.assignee ? SEED_STAFF.find((s) => s.email === c.assignee) : undefined
    await db.insert(schema.supportCases).values({
      id,
      organizationId: org,
      reference: c.reference,
      category: c.category,
      severity: c.severity,
      status: c.status,
      subject: c.subject,
      description: c.description,
      createdByEmploymentId: person(c.creator),
      createdByLabel:
        c.creator === 'owner'
          ? ctx.slug === 'harbor-vine'
            ? 'Dana Okafor'
            : 'Ana Beltrán'
          : c.creator,
      assignedStaffUserId: assignee ? (staffIds.get(assignee.email) ?? null) : null,
      assignedStaffLabel: assignee?.name ?? '',
      resolvedAt:
        c.status === 'resolved' && lastMessage
          ? new Date(now.getTime() - lastMessage.hoursAgo * HOUR)
          : null,
      lastCustomerActivityAt: createdAt,
      lastEvercalmActivityAt: lastMessage
        ? new Date(now.getTime() - lastMessage.hoursAgo * HOUR)
        : null,
      createdAt,
      updatedAt: lastMessage ? new Date(now.getTime() - lastMessage.hoursAgo * HOUR) : createdAt,
    })
    for (const m of c.messages) {
      await db.insert(schema.supportCaseMessages).values({
        id: newId(),
        organizationId: org,
        caseId: id,
        authorType: m.from,
        authorLabel: m.from === 'evercalm' ? `EverCalm support (${m.author})` : (m.author ?? ''),
        body: m.body,
        statusFrom: m.statusFrom ?? null,
        statusTo: m.statusTo ?? null,
        createdAt: new Date(now.getTime() - m.hoursAgo * HOUR),
      })
    }
    for (const n of c.notes) {
      const author = SEED_STAFF.find((s) => s.name === n.author)!
      await db.insert(schema.supportInternalNotes).values({
        id: newId(),
        caseId: id,
        authorStaffUserId: staffIds.get(author.email)!,
        authorLabel: author.name,
        body: n.body,
        createdAt: new Date(now.getTime() - n.hoursAgo * HOUR),
      })
    }
  }

  // --- a couple of failed deliveries, for status pages ----------------------
  if (ctx.slug === 'harbor-vine') {
    const theo = person('host')
    const failedAt = new Date(now.getTime() - 60 * HOUR)
    await db.insert(schema.notifications).values([
      {
        id: newId(),
        organizationId: org,
        employmentId: theo,
        category: 'schedule',
        channel: 'email',
        subjectType: 'schedule',
        subjectId: null,
        title: 'Your Downtown schedule for this week is ready',
        preview: 'Open EverCalm to see your shifts.',
        href: '/my/schedule',
        status: 'failed',
        attempts: 5,
        lastAttemptAt: failedAt,
        failedAt,
        failureReason: 'Email provider error: the connection timed out',
        idempotencyKey: `seed:failed-email:${newId()}`,
        createdAt: new Date(failedAt.getTime() - 2 * HOUR),
      },
      {
        id: newId(),
        organizationId: org,
        employmentId: person('dual-server'),
        category: 'announcement',
        channel: 'email',
        subjectType: 'announcement',
        subjectId: null,
        title: 'Tonight’s pre-shift huddle',
        preview: 'Doors at 4:30.',
        href: '/my/inbox',
        status: 'failed',
        attempts: 5,
        lastAttemptAt: failedAt,
        failedAt,
        failureReason: 'Email provider error: the connection timed out',
        idempotencyKey: `seed:failed-email:${newId()}`,
        createdAt: new Date(failedAt.getTime() - 2 * HOUR),
      },
    ])
  }
  return { cases: cases.length }
}

/** EverCalm staff accounts. Run BEFORE organizations, so cases can name an assignee. */
export async function seedPlatformStaff(
  db: SeedDb,
  options: { passwordFor?: (email: string) => string } = {},
): Promise<number> {
  const sharedHash = options.passwordFor ? null : await argon2Hash(SEED_PASSWORD, ARGON2_OPTIONS)
  for (const staff of SEED_STAFF) {
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, staff.email))
      .limit(1)
    let userId = existing?.id
    if (!userId) {
      userId = newId()
      await db
        .insert(schema.users)
        .values({ id: userId, name: staff.name, email: staff.email, emailVerified: true })
      await db.insert(schema.accounts).values({
        id: newId(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password:
          sharedHash ?? (await argon2Hash(options.passwordFor!(staff.email), ARGON2_OPTIONS)),
      })
    }
    await db
      .insert(schema.platformStaff)
      .values({ userId, role: staff.role, displayName: staff.name })
      .onConflictDoNothing()
  }
  return SEED_STAFF.length
}

/** A few recorded worker runs, one of which failed for the salon. */
export async function seedWorkerRuns(db: SeedDb, now = new Date()): Promise<void> {
  const [lumen] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, 'lumen-salon'))
  const run = (
    minutesAgo: number,
    errors: { organizationId: string | null; step: string; message: string }[],
  ) => ({
    id: newId(),
    startedAt: new Date(now.getTime() - minutesAgo * 60_000 - 800),
    finishedAt: new Date(now.getTime() - minutesAgo * 60_000),
    organizations: 2,
    counters: { sent: errors.length ? 3 : 7, failed: 0 },
    errorCount: errors.length,
    errors,
  })
  await db.insert(schema.workerRuns).values([
    run(24 * 60, []),
    run(
      95,
      lumen
        ? [
            {
              organizationId: lumen.id,
              step: 'deliver',
              message: 'Email provider error: the connection timed out',
            },
          ]
        : [],
    ),
    run(3, []),
  ])
}
