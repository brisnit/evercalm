import { describe, expect, it } from 'vitest'
import {
  GRACE_DAYS,
  accessModeFor,
  applyBillingEvent,
  capabilitiesFor,
  dueLifecycleEvents,
  graceEndsAt,
  type SubscriptionState,
} from '@/modules/billing/policy'
import { ROLE_PRESETS } from '@/server/authz/role-presets'

/** Subscription states, what they allow, and how they move. */

const DAY = 86_400_000
const now = new Date('2026-09-14T12:00:00Z')

const state = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  status: 'trialing',
  trialEndsAt: new Date(now.getTime() + 5 * DAY),
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  hasPaymentMethod: false,
  ...over,
})

describe('what each status allows', () => {
  it('keeps everything working through trial, active and the grace period', () => {
    expect(accessModeFor('trialing')).toBe('full')
    expect(accessModeFor('active')).toBe('full')
    expect(accessModeFor('past_due')).toBe('grace')
    expect(accessModeFor('suspended')).toBe('read_only')
    expect(accessModeFor('canceled')).toBe('read_only')
  })

  it('leaves an owner able to read, export and fix billing, and nothing else, when read-only', () => {
    const owner = new Set(ROLE_PRESETS.owner.capabilities)
    const readOnly = capabilitiesFor(owner, 'read_only')
    for (const kept of [
      'billing.manage',
      'org.view',
      'report.export',
      'people.view',
      'support.manage',
    ] as const) {
      expect(readOnly.has(kept), kept).toBe(true)
    }
    for (const withheld of [
      'schedule.publish',
      'announcement.publish',
      'people.invite',
      'training.assign',
      'checklist.verify',
    ] as const) {
      expect(readOnly.has(withheld), withheld).toBe(false)
    }
    expect(capabilitiesFor(owner, 'grace').size).toBe(owner.size)
  })
})

describe('moving between states', () => {
  it('ends a trial into active with a payment method, or past due without', () => {
    expect(
      applyBillingEvent(state({ hasPaymentMethod: true }), { type: 'trial_ended' }, now).next
        .status,
    ).toBe('active')
    const unpaid = applyBillingEvent(state(), { type: 'trial_ended' }, now).next
    expect(unpaid).toMatchObject({ status: 'past_due', pastDueSince: now })
    expect(graceEndsAt(unpaid)!.getTime()).toBe(now.getTime() + GRACE_DAYS * DAY)
  })

  it('suspends only after the grace period, and a payment restores everything', () => {
    const pastDue = state({
      status: 'past_due',
      pastDueSince: new Date(now.getTime() - (GRACE_DAYS - 1) * DAY),
    })
    expect(dueLifecycleEvents(pastDue, now)).toEqual([])
    const later = new Date(now.getTime() + 2 * DAY)
    expect(dueLifecycleEvents(pastDue, later)).toEqual([{ type: 'grace_expired' }])
    const suspended = applyBillingEvent(pastDue, { type: 'grace_expired' }, later).next
    expect(suspended.status).toBe('suspended')
    const periodEnd = new Date(later.getTime() + 30 * DAY)
    expect(
      applyBillingEvent(suspended, { type: 'payment_succeeded', periodEnd }, later).next,
    ).toMatchObject({
      status: 'active',
      pastDueSince: null,
      currentPeriodEnd: periodEnd,
    })
  })

  it('cancels at the end of the period, not before, and can be withdrawn until then', () => {
    const active = state({
      status: 'active',
      currentPeriodEnd: new Date(now.getTime() + 10 * DAY),
      hasPaymentMethod: true,
    })
    const requested = applyBillingEvent(active, { type: 'cancellation_requested' }, now).next
    expect(requested).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
    expect(dueLifecycleEvents(requested, now)).toEqual([])
    expect(
      applyBillingEvent(requested, { type: 'cancellation_withdrawn' }, now).next.cancelAtPeriodEnd,
    ).toBe(false)
    const end = new Date(now.getTime() + 11 * DAY)
    expect(dueLifecycleEvents(requested, end)).toEqual([{ type: 'period_ended' }])
    expect(applyBillingEvent(requested, { type: 'period_ended' }, end).next.status).toBe('canceled')
  })

  it('ignores events that make no sense, and says nothing changed', () => {
    const suspended = state({ status: 'suspended' })
    expect(applyBillingEvent(suspended, { type: 'payment_failed' }, now).changed).toBe(false)
    expect(
      applyBillingEvent(state({ status: 'active' }), { type: 'grace_expired' }, now).changed,
    ).toBe(false)
    const once = applyBillingEvent(
      state({ status: 'active' }),
      { type: 'payment_failed' },
      now,
    ).next
    expect(applyBillingEvent(once, { type: 'payment_failed' }, now).changed).toBe(false)
  })
})
