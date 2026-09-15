import type { Tx } from '@/server/db'
import { NotFoundError } from '@/lib/errors'
import type { BillingProvider } from './provider'
import { handleProviderEvent } from './service'

/*
 * RECEIVING A BILLING WEBHOOK - authenticated, idempotent, and quiet about
 * why it refused something. The route wires the real provider and database;
 * tests wire their own.
 */

export interface WebhookDeps {
  provider: BillingProvider
  organizationFor: (provider: string, subscriptionRef: string) => Promise<string | null>
  runTenant: <T>(organizationId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>
  now?: () => Date
}

export type WebhookOutcome =
  { status: 200; body: { received: true; duplicate: boolean } } | { status: 404 | 413 }

export async function receiveBillingWebhook(
  rawBody: string,
  signature: string | null,
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  if (rawBody.length > 16_384) return { status: 413 }
  const event = deps.provider.verifyWebhook(rawBody, signature)
  if (!event) return { status: 404 }
  const organizationId = await deps.organizationFor(deps.provider.name, event.subscriptionRef)
  if (!organizationId) return { status: 404 }
  try {
    const result = await deps.runTenant(organizationId, (tx) =>
      handleProviderEvent(tx, organizationId, event, deps.now?.() ?? new Date()),
    )
    return { status: 200, body: { received: true, duplicate: result.duplicate } }
  } catch (error) {
    if (error instanceof NotFoundError) return { status: 404 }
    throw error
  }
}
