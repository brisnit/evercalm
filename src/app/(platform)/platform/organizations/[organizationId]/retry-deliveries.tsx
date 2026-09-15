'use client'

import { retryDeliveriesAction } from '@/modules/platform/actions'
import { MiniForm } from '@/ui/patterns/mini-form'
import { Field, Input } from '@/ui/primitives'

export function RetryDeliveries({ organizationId }: { organizationId: string }) {
  return (
    <MiniForm
      action={retryDeliveriesAction}
      hidden={{ organizationId }}
      submitLabel="Retry recent failures"
    >
      <Field id="retry-reason" label="Reason" hint="Recorded in the customer’s audit log." required>
        {(p) => <Input {...p} name="reason" maxLength={300} required autoComplete="off" />}
      </Field>
    </MiniForm>
  )
}
