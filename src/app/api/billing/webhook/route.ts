import { NextResponse } from 'next/server'
import { withTenant } from '@/server/db'
import { organizationForProviderSubscription } from '@/server/db/platform'
import { getLogger } from '@/lib/logger'
import { billingProvider } from '@/modules/billing/provider'
import { receiveBillingWebhook } from '@/modules/billing/webhook'
import { rateLimited } from '@/server/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Billing provider webhook. Authenticated by the provider's signature over
 * the raw body, idempotent on the provider's event id, and a 404 for anything
 * it cannot verify. With the mock provider it is effectively absent unless
 * MOCK_BILLING_WEBHOOK_SECRET is set, and always absent in production. See
 * modules/billing/webhook.ts.
 */
export async function POST(request: Request) {
  if (await rateLimited('billing-webhook', 'global', { max: 120, windowSeconds: 60 })) {
    return NextResponse.json({ error: 'slow down' }, { status: 429 })
  }
  try {
    const outcome = await receiveBillingWebhook(
      await request.text(),
      request.headers.get('x-evercalm-mock-signature'),
      {
        provider: billingProvider(),
        organizationFor: (provider, ref) => organizationForProviderSubscription(provider, ref),
        runTenant: withTenant,
      },
    )
    return outcome.status === 200
      ? NextResponse.json(outcome.body)
      : new NextResponse(null, { status: outcome.status })
  } catch (error) {
    getLogger().error(
      { err: error instanceof Error ? error.message : 'unknown' },
      'billing webhook failed',
    )
    // A 5xx asks the provider to retry; nothing was recorded.
    return NextResponse.json({ error: 'try again' }, { status: 500 })
  }
}
