'use client'

import { setSubscriptionStatusAction } from '@/modules/platform/actions'
import { MiniForm } from '@/ui/patterns/mini-form'
import { Field, Input, Select } from '@/ui/primitives'

const STATUSES: [string, string][] = [
  ['active', 'Active'],
  ['past_due', 'Payment overdue'],
  ['suspended', 'Suspended (administration read-only)'],
  ['canceled', 'Canceled'],
]

/**
 * Manual pilots only: EverCalm support administrators set the status by hand,
 * because no payment provider does. The reason is shown to the customer.
 */
export function SetSubscriptionStatus({
  organizationId,
  current,
}: {
  organizationId: string
  current: string
}) {
  return (
    <MiniForm
      action={setSubscriptionStatusAction}
      hidden={{ organizationId }}
      submitLabel="Set status"
    >
      <Field id="subscription-status" label="Pilot subscription status" required>
        {(p) => (
          <Select {...p} name="status" defaultValue={current} required>
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id="subscription-status-reason"
        label="Reason"
        hint="The customer sees this in their billing history, and it is recorded in their audit log."
        required
      >
        {(p) => <Input {...p} name="reason" maxLength={300} required autoComplete="off" />}
      </Field>
    </MiniForm>
  )
}
