'use client'

import {
  changePlanAction,
  requestCancellationAction,
  simulateBillingAction,
  updateBillingContactAction,
  withdrawCancellationAction,
} from '@/modules/billing/actions'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { MiniForm } from '@/ui/patterns/mini-form'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { Badge, Card, CardHeader, Field, Input, TextLink } from '@/ui/primitives'

interface Props {
  provider: { name: string; live: boolean; simulationsEnabled: boolean; ownerSelfService: boolean }
  summary: {
    statusLabel: string
    statusTone: 'success' | 'info' | 'warning' | 'danger' | 'neutral'
    planName: string
    interval: string
    timing: string
    access: string
    trial: string | null
    activeEmployees: number
    activeLocations: number
    paymentMethod: string
    canCancel: boolean
    canWithdraw: boolean
    isTrial: boolean
  }
  plans: {
    key: string
    name: string
    summary: string
    includes: string[]
    current: boolean
    unavailable: string | null
  }[]
  contact: { name: string; email: string }
  history: { id: string; when: string; what: string; by: string; change: string | null }[]
}

export function BillingWorkspace({ provider, summary, plans, contact, history }: Props) {
  return (
    <NoticeProvider>
      {!provider.ownerSelfService ? (
        <Card className="border-info/30 bg-info-soft/50 mb-5 p-4">
          <p className="text-ink text-sm">
            <span className="font-semibold">
              Billing is arranged directly with EverCalm during the pilot.
            </span>{' '}
            Nothing is charged here. To change your plan or end the pilot,{' '}
            <TextLink href="/app/support/new">open a support case</TextLink>.
          </p>
        </Card>
      ) : !provider.live ? (
        <Card className="border-info/30 bg-info-soft/50 mb-5 p-4">
          <p className="text-ink text-sm">
            <span className="font-semibold">Payments are not connected.</span> EverCalm is in its
            pilot, and pricing is agreed with each business directly. Nothing on this page charges a
            card or sends an invoice.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <div className="flex min-w-0 flex-col gap-5">
          <Card as="section">
            <CardHeader title="Subscription" description={summary.timing} />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
              <Item label="Plan" value={summary.planName} />
              <Item label="Billing interval" value={summary.interval} />
              <Item
                label="Status"
                value={<Badge tone={summary.statusTone}>{summary.statusLabel}</Badge>}
              />
              {summary.trial ? <Item label="Trial" value={summary.trial} /> : null}
              <Item label="Active employees" value={String(summary.activeEmployees)} />
              <Item label="Locations" value={String(summary.activeLocations)} />
              <Item label="Payment method" value={summary.paymentMethod} />
            </dl>
            <p className="border-line text-muted border-t px-5 py-3 text-sm">{summary.access}</p>
          </Card>

          <Card as="section">
            <CardHeader
              title="Plan"
              description={
                provider.ownerSelfService
                  ? 'What each plan includes. Prices are agreed during the pilot.'
                  : 'What each plan includes. Plan changes are arranged with EverCalm during the pilot.'
              }
            />
            <ul className="divide-line divide-y">
              {plans.map((plan) => (
                <li
                  key={plan.key}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="text-ink font-semibold">
                      {plan.name} {plan.current ? <Badge tone="accent">Current plan</Badge> : null}
                    </p>
                    <p className="text-muted text-sm">{plan.summary}</p>
                    <ul className="text-muted mt-1 flex flex-wrap gap-x-3 text-xs">
                      {plan.includes.map((i) => (
                        <li key={i}>· {i}</li>
                      ))}
                    </ul>
                    {plan.unavailable ? (
                      <p className="text-warning mt-1 text-xs">{plan.unavailable}</p>
                    ) : null}
                  </div>
                  {provider.ownerSelfService && !plan.current && !plan.unavailable ? (
                    <MiniForm
                      action={changePlanAction}
                      hidden={{ plan: plan.key }}
                      submitLabel={`Switch to ${plan.name}`}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card as="section">
            <CardHeader
              title="Billing history"
              description="Every change, as it happened. This record cannot be edited."
            />
            {history.length === 0 ? (
              <p className="text-muted p-5 text-sm">Nothing yet.</p>
            ) : (
              <ol className="divide-line divide-y">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="text-ink font-medium">{h.what}</span>
                      {h.change ? <span className="text-muted"> · {h.change}</span> : null}
                    </span>
                    <span className="text-muted shrink-0 text-xs tabular-nums">
                      {h.when} · {h.by}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card as="section">
            <CardHeader
              title="Billing contact"
              description="Who receives invoices and billing notices."
            />
            <div className="p-5">
              <MiniForm action={updateBillingContactAction} hidden={{}} submitLabel="Save contact">
                {(state) => (
                  <>
                    <Field
                      id="billing-name"
                      label="Name"
                      required
                      error={state.fieldErrors?.name?.[0]}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          name="name"
                          defaultValue={contact.name}
                          maxLength={120}
                          required
                          autoComplete="name"
                        />
                      )}
                    </Field>
                    <Field
                      id="billing-email"
                      label="Email"
                      required
                      error={state.fieldErrors?.email?.[0]}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          name="email"
                          type="email"
                          defaultValue={contact.email}
                          maxLength={254}
                          required
                          autoComplete="email"
                        />
                      )}
                    </Field>
                  </>
                )}
              </MiniForm>
            </div>
          </Card>

          <Card as="section">
            <CardHeader
              title="Cancellation"
              description={
                !provider.ownerSelfService
                  ? 'Your records stay available to export for 90 days after the pilot ends.'
                  : summary.isTrial
                    ? 'Cancelling a trial takes effect when the trial ends.'
                    : 'Cancelling takes effect at the end of the current period. Your records stay available to export for 90 days after.'
              }
            />
            <div className="p-5">
              {!provider.ownerSelfService ? (
                <p className="text-muted text-sm">
                  During the pilot, ending your subscription is arranged with EverCalm.{' '}
                  <TextLink href="/app/support/new">Open a support case</TextLink> and we will take
                  care of it.
                </p>
              ) : summary.canWithdraw ? (
                <MiniForm
                  action={withdrawCancellationAction}
                  hidden={{}}
                  submitLabel="Keep the subscription"
                  variant="primary"
                />
              ) : summary.canCancel ? (
                <ConfirmAction
                  triggerLabel="Cancel subscription"
                  title="Cancel at the end of the period?"
                  description="Everything keeps working until then. Afterwards administration is read-only and employees keep access to their own records."
                >
                  <MiniForm
                    action={requestCancellationAction}
                    hidden={{}}
                    submitLabel="Cancel at period end"
                    variant="danger"
                  />
                </ConfirmAction>
              ) : (
                <p className="text-muted text-sm">There is nothing to cancel in this state.</p>
              )}
            </div>
          </Card>

          {provider.simulationsEnabled ? (
            <Card as="section" className="border-dashed">
              <CardHeader
                title="Development: simulate the provider"
                description="Sends exactly the event a payment provider would, through the same code. Not shown in production."
              />
              <div className="flex flex-wrap gap-2 p-5">
                {(
                  [
                    ['payment_method_added', 'Payment method added'],
                    ['payment_succeeded', 'Payment succeeded'],
                    ['payment_failed', 'Payment failed'],
                    ...(summary.isTrial ? [['advance_to_trial_end', 'End the trial now']] : []),
                  ] as [string, string][]
                ).map(([key, label]) => (
                  <MiniForm
                    key={key}
                    action={simulateBillingAction}
                    hidden={{ simulation: key }}
                    submitLabel={label}
                    size="sm"
                  />
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </NoticeProvider>
  )
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-ink mt-0.5 font-medium">{value}</dd>
    </div>
  )
}
