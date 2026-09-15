import type { Metadata } from 'next'
import { formatDateInZone } from '@/lib/dates'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can } from '@/server/authz/can'
import { EVENT_LABELS, GRACE_DAYS, PLANS, PLAN_KEYS, STATUS_LABELS } from '@/modules/billing/policy'
import { getBillingOverview } from '@/modules/billing/service'
import { organizationTimeZone } from '@/modules/training/records'
import { Badge, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { BillingWorkspace } from './billing-workspace'

export const metadata: Metadata = { title: 'Billing' }
export const dynamic = 'force-dynamic'

const SOURCE_LABELS: Record<string, string> = {
  owner: 'Owner',
  provider: 'Billing provider',
  system: 'EverCalm',
  evercalm: 'EverCalm support',
}

/**
 * Plan, subscription and billing history, for owners.
 *
 * Says plainly that payments are not connected: nothing on this screen
 * charges anyone, and there are no prices to imply otherwise.
 */
export default async function BillingPage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'billing.manage')) return <PermissionDenied capabilityLabel="Manage billing" />

  const { overview, timeZone } = await withTenant(actor.organizationId, async (tx) => ({
    overview: await getBillingOverview(tx, actor),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  }))
  const sub = overview.subscription
  const day = (d: Date | null) => (d ? formatDateInZone(d, timeZone) : null)
  const status = STATUS_LABELS[sub.status]

  const access =
    overview.accessMode === 'full'
      ? 'Everything is available to everyone.'
      : overview.accessMode === 'grace'
        ? `Everything keeps working until ${day(sub.graceEndsAt)}. After ${GRACE_DAYS} days overdue, administration becomes read-only.`
        : 'Administration is read-only: people can view and export, but nothing is published, assigned or changed. Employees keep their schedules, training, onboarding, messages and shift work.'

  const timing =
    sub.status === 'canceled'
      ? `Ended ${day(sub.canceledAt) ?? ''}.`
      : sub.cancelAtPeriodEnd
        ? `Ends ${day(sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd) ?? 'at the end of the period'}. Everything works until then.`
        : sub.status === 'trialing'
          ? `Trial ends ${day(sub.trialEndsAt)}.`
          : sub.currentPeriodEnd
            ? `Renews monthly. Current period ends ${day(sub.currentPeriodEnd)}.`
            : 'Renews monthly.'

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, subscription status and billing history."
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <BillingWorkspace
        provider={overview.provider}
        summary={{
          statusLabel: status.label,
          statusTone: status.tone,
          planName: PLANS[sub.plan].name,
          interval: 'Monthly',
          timing,
          access,
          trial:
            sub.trialStartsAt && sub.trialEndsAt
              ? `${day(sub.trialStartsAt)} – ${day(sub.trialEndsAt)}`
              : null,
          activeEmployees: overview.activeEmployees,
          activeLocations: overview.activeLocations,
          paymentMethod: sub.hasPaymentMethod ? 'On file with the provider' : 'None on file',
          canCancel:
            !sub.cancelAtPeriodEnd && sub.status !== 'canceled' && sub.status !== 'suspended',
          canWithdraw: sub.cancelAtPeriodEnd && sub.status !== 'canceled',
          isTrial: sub.status === 'trialing',
        }}
        plans={PLAN_KEYS.map((key) => ({
          key,
          name: PLANS[key].name,
          summary: PLANS[key].summary,
          includes: [...PLANS[key].includes],
          current: key === sub.plan,
          unavailable:
            PLANS[key].maxLocations !== null && overview.activeLocations > PLANS[key].maxLocations
              ? `Covers ${PLANS[key].maxLocations} location; you have ${overview.activeLocations}.`
              : null,
        }))}
        contact={{ name: sub.billingContactName, email: sub.billingContactEmail }}
        history={overview.events.map((e) => ({
          id: e.id,
          when: day(e.occurredAt)!,
          what: e.summary || EVENT_LABELS[e.type] || e.type,
          by: e.actorLabel || SOURCE_LABELS[e.source] || e.source,
          change:
            e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus
              ? `${STATUS_LABELS[e.fromStatus as keyof typeof STATUS_LABELS]?.label ?? e.fromStatus} → ${STATUS_LABELS[e.toStatus as keyof typeof STATUS_LABELS]?.label ?? e.toStatus}`
              : null,
        }))}
      />
    </>
  )
}
