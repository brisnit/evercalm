import { describe, expect, it } from 'vitest'
import { mockProvider, parseProviderEvent, signMockPayload } from '@/modules/billing/provider'

/** The mock provider's webhook is authenticated, strict about shape, and off in production. */

const secret = 'a'.repeat(40)
const body = JSON.stringify({
  id: 'mock_evt_12345678',
  type: 'payment_succeeded',
  subscriptionRef: 'mock_sub_harborvine',
  occurredAt: '2026-09-14T12:00:00Z',
  periodEnd: '2026-10-14T12:00:00Z',
})

describe('mock billing webhook', () => {
  it('accepts a correctly signed event', () => {
    const provider = mockProvider({ secret, production: false })
    const event = provider.verifyWebhook(body, signMockPayload(body, secret))
    expect(event).toMatchObject({
      id: 'mock_evt_12345678',
      type: 'payment_succeeded',
      subscriptionRef: 'mock_sub_harborvine',
    })
  })

  it('rejects a wrong or missing signature, a tampered body, and any request when unconfigured', () => {
    const provider = mockProvider({ secret, production: false })
    expect(provider.verifyWebhook(body, null)).toBeNull()
    expect(provider.verifyWebhook(body, signMockPayload(body, 'b'.repeat(40)))).toBeNull()
    expect(
      provider.verifyWebhook(
        body.replace('payment_succeeded', 'payment_failed'),
        signMockPayload(body, secret),
      ),
    ).toBeNull()
    expect(
      mockProvider({ secret: undefined, production: false }).verifyWebhook(
        body,
        signMockPayload(body, secret),
      ),
    ).toBeNull()
  })

  it('never accepts webhooks or offers simulations in production', () => {
    const provider = mockProvider({ secret, production: true })
    expect(provider.verifyWebhook(body, signMockPayload(body, secret))).toBeNull()
    expect(provider.simulationsEnabled).toBe(false)
    expect(provider.live).toBe(false)
  })

  it('refuses events with the wrong shape', () => {
    expect(
      parseProviderEvent({
        id: 'short',
        type: 'payment_failed',
        subscriptionRef: 'x',
        occurredAt: '2026-09-14T12:00:00Z',
      }),
    ).toBeNull()
    expect(
      parseProviderEvent({
        id: 'mock_evt_12345678',
        type: 'refund',
        subscriptionRef: 'x',
        occurredAt: '2026-09-14T12:00:00Z',
      }),
    ).toBeNull()
    expect(
      parseProviderEvent({
        id: 'mock_evt_12345678',
        type: 'payment_succeeded',
        subscriptionRef: 'x',
        occurredAt: '2026-09-14T12:00:00Z',
      }),
    ).toBeNull()
  })
})
