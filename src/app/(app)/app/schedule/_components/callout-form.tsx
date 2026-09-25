'use client'

import { reportCalloutAction } from '@/modules/scheduling/slotted-actions'
import { Field, Input } from '@/ui/primitives'
import { MiniForm } from '@/ui/patterns/mini-form'

/** "They cannot work today." Recorded, then the replacement list opens. */
export function CalloutForm({ shiftId, name }: { shiftId: string; name: string }) {
  return (
    <MiniForm
      action={reportCalloutAction}
      hidden={{ shiftId }}
      submitLabel={`${name.split(' ')[0]} can’t work this`}
      variant="secondary"
      size="sm"
    >
      {(state) => (
        <Field
          id="callout-reason"
          label="What happened"
          hint="Optional. Kept with the record."
          error={state.fieldErrors?.reason?.[0]}
        >
          {(p) => <Input {...p} name="reason" placeholder="Called out sick" maxLength={200} />}
        </Field>
      )}
    </MiniForm>
  )
}
