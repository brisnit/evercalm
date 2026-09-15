import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/lib/env'

/*
 * THE BILLING PROVIDER BOUNDARY.
 *
 * Everything EverCalm knows about a payment provider is this interface. The
 * only implementation today is the MOCK provider, which charges nothing,
 * talks to nobody, and says so on every screen. Adding Stripe (or anyone
 * else) means a new implementation of BillingProvider plus the production
 * steps in docs/runbooks/billing-provider.md - no change to the subscription
 * model, the state machine or the screens.
 *
 * Webhooks are AUTHENTICATED (a signature over the raw body, compared in
 * constant time) and IDEMPOTENT (every provider event id is recorded once per
 * organization, see service.ts). The mock provider's webhook is disabled
 * unless MOCK_BILLING_WEBHOOK_SECRET is set, and never runs in production.
 */

export type ProviderEventType = 'payment_succeeded' | 'payment_failed' | 'payment_method_added'

export interface ProviderEvent {
  /** The provider's own event id: the idempotency key. */
  id: string
  type: ProviderEventType
  subscriptionRef: string
  occurredAt: Date
  periodEnd: Date | null
}

export type BillingProviderName = 'mock' | 'manual'

export interface BillingProvider {
  readonly name: BillingProviderName
  /** False until a real provider is configured. Screens say so. */
  readonly live: boolean
  /** Whether owners may simulate provider events from the billing screen. */
  readonly simulationsEnabled: boolean
  /**
   * Whether owners change plan and cancel themselves. With the manual pilot
   * provider those are arranged with EverCalm instead.
   */
  readonly ownerSelfService: boolean
  /** Verify and parse a webhook. Null means reject. */
  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent | null
}

const EVENT_TYPES: readonly ProviderEventType[] = [
  'payment_succeeded',
  'payment_failed',
  'payment_method_added',
]

export function signMockPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function parseProviderEvent(raw: unknown): ProviderEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length < 8 || r.id.length > 200) return null
  if (typeof r.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(r.type))
    return null
  if (
    typeof r.subscriptionRef !== 'string' ||
    r.subscriptionRef.length === 0 ||
    r.subscriptionRef.length > 200
  )
    return null
  const occurredAt = new Date(typeof r.occurredAt === 'string' ? r.occurredAt : '')
  if (Number.isNaN(occurredAt.getTime())) return null
  let periodEnd: Date | null = null
  if (r.periodEnd !== undefined && r.periodEnd !== null) {
    periodEnd = new Date(typeof r.periodEnd === 'string' ? r.periodEnd : '')
    if (Number.isNaN(periodEnd.getTime())) return null
  }
  if (r.type === 'payment_succeeded' && !periodEnd) return null
  return {
    id: r.id,
    type: r.type as ProviderEventType,
    subscriptionRef: r.subscriptionRef,
    occurredAt,
    periodEnd,
  }
}

export function mockProvider(options: {
  secret: string | undefined
  production: boolean
}): BillingProvider {
  return {
    name: 'mock',
    live: false,
    simulationsEnabled: !options.production,
    ownerSelfService: true,
    verifyWebhook(rawBody, signature) {
      if (options.production || !options.secret || !signature) return null
      const expected = Buffer.from(signMockPayload(rawBody, options.secret), 'utf8')
      const given = Buffer.from(signature, 'utf8')
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
      try {
        return parseProviderEvent(JSON.parse(rawBody))
      } catch {
        return null
      }
    },
  }
}

/**
 * THE MANUAL PILOT PROVIDER.
 *
 * For a pilot where EverCalm takes no payments: pricing and invoicing are
 * arranged directly with the business. It charges nothing, accepts no
 * webhooks, offers no simulations, and never changes a subscription on its
 * own. Only an EverCalm support administrator changes a manual subscription's
 * status, with a reason recorded in the billing history and the customer's
 * audit log. Unlike the mock it is allowed in production, because it does not
 * pretend anything: every screen says billing is arranged with EverCalm.
 */
export function manualProvider(): BillingProvider {
  return {
    name: 'manual',
    live: false,
    simulationsEnabled: false,
    ownerSelfService: false,
    verifyWebhook: () => null,
  }
}

export function billingProvider(): BillingProvider {
  const env = getEnv()
  if (env.BILLING_PROVIDER === 'manual') return manualProvider()
  return mockProvider({
    secret: env.MOCK_BILLING_WEBHOOK_SECRET,
    production: env.NODE_ENV === 'production',
  })
}
