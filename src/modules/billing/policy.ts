import type { Capability } from '@/server/authz/capabilities'

/*
 * WHAT A SUBSCRIPTION STATUS MEANS FOR THE PEOPLE USING EVERCALM.
 *
 * Pure: the rules the billing screens, the worker and actor resolution share,
 * so "past due" means the same thing everywhere and is tested directly.
 *
 *   trialing   Everything works. The trial end date is shown to owners.
 *   active     Everything works.
 *   past_due   Everything works for GRACE_DAYS. Owners see a banner and the
 *              date access becomes read-only.
 *   suspended  READ-ONLY ADMINISTRATION. Managers can read and export what
 *              they could before, and owners can fix billing; nothing new is
 *              published, assigned or changed. EMPLOYEES KEEP ACCESS to their
 *              own schedule, training records, onboarding, messages and shift
 *              work, and can still acknowledge and complete their own work:
 *              a billing dispute never locks a person out of their own records.
 *   canceled   The same read-only mode, for CANCELED_RETENTION_DAYS so the
 *              business can export its data; account closure after that is a
 *              documented, human step (docs/runbooks/data-retention.md).
 *
 * Nothing here charges anyone. Provider events arrive through the provider
 * adapter; see modules/billing/provider.ts.
 */

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'suspended',
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const BILLING_INTERVALS = ['month'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export const PLAN_KEYS = ['pilot', 'essentials', 'multi_location'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export interface PlanDefinition {
  key: PlanKey
  name: string
  summary: string
  /** Null means no limit. */
  maxLocations: number | null
  includes: readonly string[]
}

/**
 * Plans describe what is included. No prices: pricing is agreed with pilot
 * businesses, and a price on this screen would imply a checkout that does not
 * exist.
 */
export const PLANS: Record<PlanKey, PlanDefinition> = {
  pilot: {
    key: 'pilot',
    name: 'Pilot',
    summary: 'Everything, set up with our team, at the price agreed for the pilot.',
    maxLocations: null,
    includes: ['All features', 'Setup with the EverCalm team', 'Direct support'],
  },
  essentials: {
    key: 'essentials',
    name: 'Essentials',
    summary: 'One location: onboarding, training, scheduling, communication and shift work.',
    maxLocations: 1,
    includes: ['One location', 'All employee features', 'Reports and exports'],
  },
  multi_location: {
    key: 'multi_location',
    name: 'Multi-location',
    summary: 'Several locations, with location-scoped managers and organization reporting.',
    maxLocations: null,
    includes: ['Unlimited locations', 'Location-scoped managers', 'Organization-wide reporting'],
  },
}

export const TRIAL_DAYS = 30
export const GRACE_DAYS = 14
export const CANCELED_RETENTION_DAYS = 90
const DAY = 86_400_000

export type AccessMode = 'full' | 'grace' | 'read_only'

export function accessModeFor(status: string): AccessMode {
  switch (status) {
    case 'trialing':
    case 'active':
      return 'full'
    case 'past_due':
      return 'grace'
    default:
      return 'read_only'
  }
}

/**
 * Capabilities that survive read-only mode: seeing, reporting, exporting, and
 * fixing billing. Everything that creates, publishes, assigns or changes is
 * withheld. Self-access needs no capability, so employees are unaffected.
 */
export const READ_ONLY_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'org.view',
  'org.view_audit',
  'billing.manage',
  'support.manage',
  'people.view',
  'people.view_sensitive',
  'people.export',
  'onboarding.view_progress',
  'announcement.view_receipts',
  'schedule.view_all',
  'availability.view_team',
  'training.view_progress_team',
  'training.view_progress_org',
  'checklist.view_runs',
  'report.people',
  'report.training',
  'report.operations',
  'report.communications',
  'report.export',
])

export function capabilitiesFor(
  capabilities: ReadonlySet<Capability>,
  mode: AccessMode,
): Set<Capability> {
  if (mode !== 'read_only') return new Set(capabilities)
  return new Set([...capabilities].filter((c) => READ_ONLY_CAPABILITIES.has(c)))
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export interface SubscriptionState {
  status: SubscriptionStatus
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  pastDueSince: Date | null
  /** A payment method is on file with the provider. */
  hasPaymentMethod: boolean
}

export type BillingEvent =
  | { type: 'payment_succeeded'; periodEnd: Date }
  | { type: 'payment_failed' }
  | { type: 'payment_method_added' }
  | { type: 'trial_ended' }
  | { type: 'grace_expired' }
  | { type: 'period_ended' }
  | { type: 'cancellation_requested' }
  | { type: 'cancellation_withdrawn' }

export interface Transition {
  next: SubscriptionState
  changed: boolean
}

/**
 * Apply one event. Events that make no sense in the current state change
 * nothing - a late "payment failed" for a subscription already suspended is
 * recorded by the caller but moves nothing.
 */
export function applyBillingEvent(
  state: SubscriptionState,
  event: BillingEvent,
  now: Date,
): Transition {
  const next: SubscriptionState = { ...state }
  switch (event.type) {
    case 'payment_succeeded':
      if (
        state.status === 'canceled' ||
        state.status === 'suspended' ||
        state.status === 'past_due' ||
        state.status === 'trialing' ||
        state.status === 'active'
      ) {
        next.status = 'active'
        next.currentPeriodEnd = event.periodEnd
        next.pastDueSince = null
        next.hasPaymentMethod = true
        if (state.status === 'canceled') next.cancelAtPeriodEnd = false
      }
      break
    case 'payment_method_added':
      next.hasPaymentMethod = true
      break
    case 'payment_failed':
      if (state.status === 'active' || state.status === 'trialing') {
        next.status = 'past_due'
        next.pastDueSince = now
      }
      break
    case 'trial_ended':
      if (state.status === 'trialing') {
        if (state.cancelAtPeriodEnd) next.status = 'canceled'
        else if (state.hasPaymentMethod) next.status = 'active'
        else {
          next.status = 'past_due'
          next.pastDueSince = now
        }
      }
      break
    case 'grace_expired':
      if (state.status === 'past_due') next.status = 'suspended'
      break
    case 'period_ended':
      if (state.status === 'active' && state.cancelAtPeriodEnd) next.status = 'canceled'
      break
    case 'cancellation_requested':
      if (state.status === 'active' || state.status === 'trialing' || state.status === 'past_due') {
        next.cancelAtPeriodEnd = true
      }
      break
    case 'cancellation_withdrawn':
      if (state.status !== 'canceled') next.cancelAtPeriodEnd = false
      break
  }
  const changed = (Object.keys(next) as (keyof SubscriptionState)[]).some((key) => {
    const a = next[key]
    const b = state[key]
    return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b
  })
  return { next, changed }
}

/** Time-based events that are due now, in the order they should apply. */
export function dueLifecycleEvents(state: SubscriptionState, now: Date): BillingEvent[] {
  const t = now.getTime()
  if (state.status === 'trialing' && state.trialEndsAt && state.trialEndsAt.getTime() <= t) {
    return [{ type: 'trial_ended' }]
  }
  if (
    state.status === 'past_due' &&
    state.pastDueSince &&
    state.pastDueSince.getTime() + GRACE_DAYS * DAY <= t
  ) {
    return [{ type: 'grace_expired' }]
  }
  if (
    state.status === 'active' &&
    state.cancelAtPeriodEnd &&
    state.currentPeriodEnd &&
    state.currentPeriodEnd.getTime() <= t
  ) {
    return [{ type: 'period_ended' }]
  }
  return []
}

/** When read-only begins for a past-due subscription. */
export function graceEndsAt(state: Pick<SubscriptionState, 'pastDueSince'>): Date | null {
  return state.pastDueSince ? new Date(state.pastDueSince.getTime() + GRACE_DAYS * DAY) : null
}

export const STATUS_LABELS: Record<
  SubscriptionStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }
> = {
  trialing: { label: 'Trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment overdue', tone: 'warning' },
  suspended: { label: 'Suspended', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'neutral' },
}

export const EVENT_LABELS: Record<string, string> = {
  trial_started: 'Trial started',
  plan_changed: 'Plan changed',
  contact_updated: 'Billing contact updated',
  payment_succeeded: 'Payment succeeded',
  payment_failed: 'Payment failed',
  payment_method_added: 'Payment method added',
  trial_ended: 'Trial ended',
  grace_expired: 'Grace period ended',
  period_ended: 'Billing period ended',
  cancellation_requested: 'Cancellation requested',
  cancellation_withdrawn: 'Cancellation withdrawn',
  quantity_changed: 'Active employee count changed',
}
