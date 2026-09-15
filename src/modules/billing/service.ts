import { and, count, desc, eq, isNull } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import {
  billingEvents,
  employments,
  locations,
  organizations,
  subscriptions,
} from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { authorize } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent, recordSystemAuditEvent } from '@/server/audit'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import {
  PLANS,
  PLAN_KEYS,
  TRIAL_DAYS,
  accessModeFor,
  applyBillingEvent,
  dueLifecycleEvents,
  graceEndsAt,
  type AccessMode,
  type BillingEvent,
  type PlanKey,
  type SubscriptionState,
  type SubscriptionStatus,
} from './policy'
import { billingProvider, type ProviderEvent, type ProviderEventType } from './provider'

/*
 * BILLING, INSIDE ONE ORGANIZATION.
 *
 * Every change to a subscription is a billing event first: the event row is
 * inserted with an idempotency key, and only if that insert succeeds is the
 * subscription changed. A webhook delivered twice, a worker tick run by two
 * processes, or an owner double-clicking Cancel therefore changes the
 * subscription exactly once, and the history is complete and immutable.
 *
 * Owners hold billing.manage (organization-wide only). Provider and lifecycle
 * events are attributed to the system, not a person.
 */

const DAY = 86_400_000
type SubscriptionRow = typeof subscriptions.$inferSelect
type Source = 'owner' | 'provider' | 'system' | 'evercalm'

function stateOf(row: SubscriptionRow): SubscriptionState {
  return {
    status: row.status as SubscriptionStatus,
    trialEndsAt: row.trialEndsAt,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    pastDueSince: row.pastDueSince,
    hasPaymentMethod: row.hasPaymentMethod,
  }
}

/** The access mode actor resolution applies. No subscription on record: full. */
export async function organizationAccessMode(tx: Tx, organizationId: string): Promise<AccessMode> {
  const [row] = await tx
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1)
  return row ? accessModeFor(row.status) : 'full'
}

async function lockSubscription(tx: Tx, organizationId: string): Promise<SubscriptionRow | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .for('update')
    .limit(1)
  return row ?? null
}

/** A trial that starts when the organization was created, for workspaces set up before billing existed. */
export async function ensureSubscription(
  tx: Tx,
  organizationId: string,
  now = new Date(),
): Promise<SubscriptionRow> {
  const existing = await lockSubscription(tx, organizationId)
  if (existing) return existing
  const [org] = await tx
    .select({ createdAt: organizations.createdAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
  if (!org) throw new NotFoundError('Organization not found')
  const trialStartsAt = org.createdAt
  const trialEndsAt = new Date(
    Math.max(trialStartsAt.getTime() + TRIAL_DAYS * DAY, now.getTime() + 7 * DAY),
  )
  const id = newId()
  await tx
    .insert(subscriptions)
    .values({ id, organizationId, plan: 'pilot', status: 'trialing', trialStartsAt, trialEndsAt })
    .onConflictDoNothing()
  const row = await lockSubscription(tx, organizationId)
  await tx
    .insert(billingEvents)
    .values({
      id: newId(),
      organizationId,
      subscriptionId: row!.id,
      type: 'trial_started',
      source: 'system',
      idempotencyKey: `system:trial_started:${row!.id}`,
      toStatus: 'trialing',
      summary: `Trial started, ending ${trialEndsAt.toISOString().slice(0, 10)}`,
      occurredAt: now,
    })
    .onConflictDoNothing()
  return row!
}

interface RecordInput {
  type: string
  source: Source
  idempotencyKey: string
  summary: string
  actorLabel?: string
  detail?: Record<string, unknown>
  set?: Partial<typeof subscriptions.$inferInsert>
}

/**
 * THE ONLY WAY A SUBSCRIPTION CHANGES. Returns false when this event was
 * already recorded, in which case nothing changes.
 */
async function recordChange(
  tx: Tx,
  row: SubscriptionRow,
  input: RecordInput,
  event: BillingEvent | null,
  now: Date,
): Promise<{ recorded: boolean; status: SubscriptionStatus }> {
  const before = stateOf(row)
  const transition = event
    ? applyBillingEvent(before, event, now)
    : { next: before, changed: false }
  const next = transition.next

  const inserted = await tx
    .insert(billingEvents)
    .values({
      id: newId(),
      organizationId: row.organizationId,
      subscriptionId: row.id,
      type: input.type,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      fromStatus: before.status,
      toStatus: next.status,
      summary: input.summary,
      detail: input.detail ?? {},
      actorLabel: input.actorLabel ?? '',
      occurredAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id })
  if (inserted.length === 0) return { recorded: false, status: before.status }

  const becameCanceled = next.status === 'canceled' && before.status !== 'canceled'
  const becameSuspended = next.status === 'suspended' && before.status !== 'suspended'
  await tx
    .update(subscriptions)
    .set({
      status: next.status,
      currentPeriodEnd: next.currentPeriodEnd,
      cancelAtPeriodEnd: next.cancelAtPeriodEnd,
      pastDueSince: next.pastDueSince,
      hasPaymentMethod: next.hasPaymentMethod,
      canceledAt: becameCanceled ? now : next.status === 'canceled' ? row.canceledAt : null,
      suspendedAt: becameSuspended ? now : next.status === 'suspended' ? row.suspendedAt : null,
      ...(event?.type === 'cancellation_requested' ? { cancelRequestedAt: now } : {}),
      ...(event?.type === 'cancellation_withdrawn' ? { cancelRequestedAt: null } : {}),
      ...(event?.type === 'payment_succeeded' && before.status !== 'active'
        ? { currentPeriodStart: now }
        : {}),
      ...input.set,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, row.id))
  return { recorded: true, status: next.status }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface BillingOverview {
  subscription: {
    plan: PlanKey
    status: SubscriptionStatus
    billingInterval: string
    trialStartsAt: Date | null
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    canceledAt: Date | null
    pastDueSince: Date | null
    graceEndsAt: Date | null
    suspendedAt: Date | null
    hasPaymentMethod: boolean
    billingContactName: string
    billingContactEmail: string
    quantityBasis: string
    quantity: number
  }
  accessMode: AccessMode
  activeEmployees: number
  activeLocations: number
  events: {
    id: string
    type: string
    source: string
    fromStatus: string | null
    toStatus: string | null
    summary: string
    actorLabel: string
    occurredAt: Date
  }[]
  provider: { name: string; live: boolean; simulationsEnabled: boolean }
}

export async function getBillingOverview(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<BillingOverview> {
  authorize(actor, 'billing.manage')
  const row = await ensureSubscription(tx, actor.organizationId, now)
  const [[people], [places], events] = await Promise.all([
    tx
      .select({ n: count() })
      .from(employments)
      .where(
        and(eq(employments.organizationId, actor.organizationId), eq(employments.status, 'active')),
      ),
    tx
      .select({ n: count() })
      .from(locations)
      .where(and(eq(locations.organizationId, actor.organizationId), isNull(locations.archivedAt))),
    tx
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.organizationId, actor.organizationId))
      .orderBy(desc(billingEvents.occurredAt), desc(billingEvents.createdAt))
      .limit(50),
  ])
  const provider = billingProvider()
  return {
    subscription: {
      plan: row.plan as PlanKey,
      status: row.status as SubscriptionStatus,
      billingInterval: row.billingInterval,
      trialStartsAt: row.trialStartsAt,
      trialEndsAt: row.trialEndsAt,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      canceledAt: row.canceledAt,
      pastDueSince: row.pastDueSince,
      graceEndsAt: graceEndsAt(row),
      suspendedAt: row.suspendedAt,
      hasPaymentMethod: row.hasPaymentMethod,
      billingContactName: row.billingContactName,
      billingContactEmail: row.billingContactEmail,
      quantityBasis: row.quantityBasis,
      quantity: row.quantity,
    },
    accessMode: accessModeFor(row.status),
    activeEmployees: people?.n ?? 0,
    activeLocations: places?.n ?? 0,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      source: e.source,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      summary: e.summary,
      actorLabel: e.actorLabel,
      occurredAt: e.occurredAt,
    })),
    provider: {
      name: provider.name,
      live: provider.live,
      simulationsEnabled: provider.simulationsEnabled,
    },
  }
}

// ---------------------------------------------------------------------------
// Owner actions
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function updateBillingContact(
  tx: Tx,
  actor: Actor,
  input: { name: string; email: string },
  now = new Date(),
): Promise<void> {
  authorize(actor, 'billing.manage')
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120)
  const email = input.email.trim().toLowerCase().slice(0, 254)
  const errors: Record<string, string[]> = {}
  if (!name) errors.name = ['Enter the name of the person who handles invoices.']
  if (!EMAIL.test(email)) errors.email = ['Enter an email address, like accounts@example.com.']
  if (Object.keys(errors).length) throw new ValidationError(errors)
  const row = await ensureSubscription(tx, actor.organizationId, now)
  if (row.billingContactName === name && row.billingContactEmail === email) return
  await recordChange(
    tx,
    row,
    {
      type: 'contact_updated',
      source: 'owner',
      idempotencyKey: `owner:contact:${newId()}`,
      summary: 'Billing contact updated',
      actorLabel: actor.displayName,
      set: { billingContactName: name, billingContactEmail: email },
    },
    null,
    now,
  )
  // The address itself stays out of the audit log.
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.BILLING_CONTACT_UPDATED,
    summary: 'Updated the billing contact',
    subjectType: 'subscription',
    subjectId: row.id,
  })
}

export async function changePlan(
  tx: Tx,
  actor: Actor,
  planKey: string,
  now = new Date(),
): Promise<void> {
  authorize(actor, 'billing.manage')
  if (!(PLAN_KEYS as readonly string[]).includes(planKey))
    throw new ValidationError({ plan: ['Choose a plan.'] })
  const plan = PLANS[planKey as PlanKey]
  const row = await ensureSubscription(tx, actor.organizationId, now)
  if (row.plan === plan.key) return
  if (row.status === 'canceled' || row.status === 'suspended') {
    throw new ValidationError({}, 'Resolve the subscription status before changing plan.')
  }
  if (plan.maxLocations !== null) {
    const [places] = await tx
      .select({ n: count() })
      .from(locations)
      .where(and(eq(locations.organizationId, actor.organizationId), isNull(locations.archivedAt)))
    if ((places?.n ?? 0) > plan.maxLocations) {
      throw new ValidationError(
        { plan: [`${plan.name} covers ${plan.maxLocations} location. You have ${places?.n}.`] },
        `${plan.name} covers ${plan.maxLocations} location, and this workspace has ${places?.n}.`,
      )
    }
  }
  await recordChange(
    tx,
    row,
    {
      type: 'plan_changed',
      source: 'owner',
      idempotencyKey: `owner:plan:${row.id}:${row.plan}->${plan.key}:${now.getTime()}`,
      summary: `Plan changed from ${PLANS[row.plan as PlanKey]?.name ?? row.plan} to ${plan.name}`,
      actorLabel: actor.displayName,
      set: { plan: plan.key },
    },
    null,
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.BILLING_PLAN_CHANGED,
    summary: `Changed the plan to ${plan.name}`,
    subjectType: 'subscription',
    subjectId: row.id,
    metadata: { from: row.plan, to: plan.key },
  })
}

export async function requestCancellation(tx: Tx, actor: Actor, now = new Date()): Promise<void> {
  authorize(actor, 'billing.manage')
  const row = await ensureSubscription(tx, actor.organizationId, now)
  if (row.cancelAtPeriodEnd) return
  if (row.status === 'canceled' || row.status === 'suspended') {
    throw new ValidationError({}, 'This subscription is not active, so there is nothing to cancel.')
  }
  const endsAt = row.status === 'trialing' ? row.trialEndsAt : row.currentPeriodEnd
  await recordChange(
    tx,
    row,
    {
      type: 'cancellation_requested',
      source: 'owner',
      idempotencyKey: `owner:cancel:${row.id}:${now.getTime()}`,
      summary: endsAt
        ? `Cancellation requested, taking effect ${endsAt.toISOString().slice(0, 10)}`
        : 'Cancellation requested',
      actorLabel: actor.displayName,
    },
    { type: 'cancellation_requested' },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.BILLING_CANCELLATION_REQUESTED,
    summary: 'Asked to cancel the subscription at the end of the period',
    subjectType: 'subscription',
    subjectId: row.id,
  })
}

export async function withdrawCancellation(tx: Tx, actor: Actor, now = new Date()): Promise<void> {
  authorize(actor, 'billing.manage')
  const row = await ensureSubscription(tx, actor.organizationId, now)
  if (!row.cancelAtPeriodEnd || row.status === 'canceled') return
  await recordChange(
    tx,
    row,
    {
      type: 'cancellation_withdrawn',
      source: 'owner',
      idempotencyKey: `owner:uncancel:${row.id}:${now.getTime()}`,
      summary: 'Cancellation withdrawn',
      actorLabel: actor.displayName,
    },
    { type: 'cancellation_withdrawn' },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.BILLING_CANCELLATION_WITHDRAWN,
    summary: 'Withdrew the cancellation',
    subjectType: 'subscription',
    subjectId: row.id,
  })
}

// ---------------------------------------------------------------------------
// Provider and system events
// ---------------------------------------------------------------------------

const PROVIDER_SUMMARIES: Record<ProviderEventType, string> = {
  payment_succeeded: 'Payment succeeded',
  payment_failed: 'Payment failed',
  payment_method_added: 'Payment method added',
}

/** Apply a verified provider event. Replays are recorded once and change nothing. */
export async function handleProviderEvent(
  tx: Tx,
  organizationId: string,
  event: ProviderEvent,
  now = new Date(),
): Promise<{ duplicate: boolean; status: SubscriptionStatus }> {
  const row = await lockSubscription(tx, organizationId)
  if (!row || row.providerSubscriptionRef !== event.subscriptionRef)
    throw new NotFoundError('Subscription not found')
  const billingEvent: BillingEvent =
    event.type === 'payment_succeeded'
      ? { type: 'payment_succeeded', periodEnd: event.periodEnd! }
      : event.type === 'payment_failed'
        ? { type: 'payment_failed' }
        : { type: 'payment_method_added' }
  const result = await recordChange(
    tx,
    row,
    {
      type: event.type,
      source: 'provider',
      idempotencyKey: `provider:${row.provider}:${event.id}`,
      summary: PROVIDER_SUMMARIES[event.type],
      actorLabel: `${row.provider} provider`,
      detail: { providerEventId: event.id, periodEnd: event.periodEnd?.toISOString() ?? null },
    },
    billingEvent,
    now,
  )
  if (result.recorded) {
    await recordSystemAuditEvent(tx, organizationId, {
      action: AUDIT_ACTIONS.BILLING_PROVIDER_EVENT,
      summary: `${PROVIDER_SUMMARIES[event.type]} (billing provider)`,
      subjectType: 'subscription',
      subjectId: row.id,
      reason: 'Billing provider',
      metadata: { providerEventId: event.id, status: result.status },
    })
  }
  return { duplicate: !result.recorded, status: result.status }
}

/** Trial endings, grace periods and period-end cancellations that are due. Worker step. */
export async function processBillingLifecycle(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<number> {
  const row = await lockSubscription(tx, organizationId)
  if (!row) return 0
  let applied = 0
  let current = row
  for (const event of dueLifecycleEvents(stateOf(current), now)) {
    const anchor =
      event.type === 'trial_ended'
        ? current.trialEndsAt
        : event.type === 'grace_expired'
          ? current.pastDueSince
          : current.currentPeriodEnd
    const summary =
      event.type === 'trial_ended'
        ? 'Trial ended'
        : event.type === 'grace_expired'
          ? 'Grace period ended: administration is read-only until payment is resolved'
          : 'Billing period ended: the subscription is canceled'
    const result = await recordChange(
      tx,
      current,
      {
        type: event.type,
        source: 'system',
        idempotencyKey: `system:${event.type}:${current.id}:${anchor?.toISOString() ?? 'none'}`,
        summary,
        actorLabel: 'EverCalm',
      },
      event,
      now,
    )
    if (result.recorded) {
      applied += 1
      await recordSystemAuditEvent(tx, organizationId, {
        action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
        summary,
        subjectType: 'subscription',
        subjectId: current.id,
        reason: 'Billing lifecycle',
        metadata: { from: current.status, to: result.status },
      })
    }
    current = (await lockSubscription(tx, organizationId))!
  }
  return applied
}

/** Keep the recorded active-employee count in step with reality. Worker step. */
export async function syncQuantity(tx: Tx, organizationId: string, now: Date): Promise<boolean> {
  const row = await lockSubscription(tx, organizationId)
  if (!row || row.quantityBasis !== 'active_employees') return false
  const [people] = await tx
    .select({ n: count() })
    .from(employments)
    .where(and(eq(employments.organizationId, organizationId), eq(employments.status, 'active')))
  const quantity = people?.n ?? 0
  if (quantity === row.quantity) return false
  const result = await recordChange(
    tx,
    row,
    {
      type: 'quantity_changed',
      source: 'system',
      idempotencyKey: `system:quantity:${row.id}:${now.toISOString().slice(0, 13)}:${quantity}`,
      summary: `Active employees changed from ${row.quantity} to ${quantity}`,
      actorLabel: 'EverCalm',
      detail: { from: row.quantity, to: quantity },
      set: { quantity },
    },
    null,
    now,
  )
  return result.recorded
}

// ---------------------------------------------------------------------------
// Development-only simulation
// ---------------------------------------------------------------------------

export type Simulation =
  'payment_succeeded' | 'payment_failed' | 'payment_method_added' | 'advance_to_trial_end'

/**
 * Exercise the provider path without a provider. Builds exactly the event a
 * webhook would deliver and hands it to handleProviderEvent. Refused in
 * production and for any provider but the mock.
 */
export async function simulateBilling(
  tx: Tx,
  actor: Actor,
  simulation: Simulation,
  now = new Date(),
): Promise<void> {
  authorize(actor, 'billing.manage')
  const provider = billingProvider()
  if (provider.live || !provider.simulationsEnabled)
    throw new ForbiddenError('billing.manage', 'Simulations are not available here.')
  const row = await ensureSubscription(tx, actor.organizationId, now)
  let ref = row.providerSubscriptionRef
  if (!ref) {
    ref = `mock_sub_${row.id.slice(0, 8)}`
    await tx
      .update(subscriptions)
      .set({
        providerSubscriptionRef: ref,
        providerCustomerRef: `mock_cus_${row.id.slice(0, 8)}`,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, row.id))
  }
  if (simulation === 'advance_to_trial_end') {
    if (row.status !== 'trialing')
      throw new ValidationError({}, 'Only a trial can be moved to its end.')
    await tx
      .update(subscriptions)
      .set({ trialEndsAt: now, updatedAt: now })
      .where(eq(subscriptions.id, row.id))
    await processBillingLifecycle(tx, actor.organizationId, now)
  } else {
    await handleProviderEvent(
      tx,
      actor.organizationId,
      {
        id: `mock_evt_${newId()}`,
        type: simulation,
        subscriptionRef: ref,
        occurredAt: now,
        periodEnd: simulation === 'payment_succeeded' ? new Date(now.getTime() + 30 * DAY) : null,
      },
      now,
    )
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.BILLING_SIMULATED,
    summary: `Simulated a billing event in development: ${simulation.replace(/_/g, ' ')}`,
    subjectType: 'subscription',
    subjectId: row.id,
  })
}

// ---------------------------------------------------------------------------
// The banner across administration
// ---------------------------------------------------------------------------

export interface BillingBanner {
  tone: 'info' | 'warning' | 'danger'
  title: string
  body: string
  href: string | null
}

/**
 * What everyone in administration should know about the subscription. Owners
 * are told what to do; other administrators are told what it means for them.
 */
export async function billingBanner(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<BillingBanner | null> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, actor.organizationId))
    .limit(1)
  if (!row) return null
  const owner = actor.grants.some((g) => g.capabilities.has('billing.manage'))
  const href = owner ? '/app/settings/billing' : null
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')
  switch (row.status) {
    case 'suspended':
      return {
        tone: 'danger',
        title: 'This workspace is read-only',
        body: owner
          ? 'Payment could not be collected, so administration is read-only. Employees still have their schedules, training and messages. Update billing to restore everything.'
          : 'Administration is read-only while the owner resolves billing. You can still view and export; employees keep access to their own work.',
        href,
      }
    case 'canceled':
      return {
        tone: 'danger',
        title: 'This subscription has ended',
        body: owner
          ? 'Administration is read-only so you can export your records. Contact EverCalm support to restart or close the account.'
          : 'Administration is read-only. You can still view and export records.',
        href,
      }
    case 'past_due':
      return owner
        ? {
            tone: 'warning',
            title: 'Payment is overdue',
            body: `Everything keeps working until ${day(graceEndsAt(row))}. After that, administration becomes read-only until billing is resolved.`,
            href,
          }
        : null
    case 'trialing': {
      const ends = row.trialEndsAt
      if (!owner || !ends || ends.getTime() - now.getTime() > 7 * DAY) return null
      return {
        tone: 'info',
        title: 'Your trial ends soon',
        body: `The trial ends ${day(ends)}. Review the plan and billing contact.`,
        href,
      }
    }
    default:
      if (owner && row.cancelAtPeriodEnd && row.currentPeriodEnd) {
        return {
          tone: 'info',
          title: 'Cancellation scheduled',
          body: `The subscription ends ${day(row.currentPeriodEnd)}.`,
          href,
        }
      }
      return null
  }
}
