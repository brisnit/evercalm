'use client'

import { useActionState } from 'react'
import { createLocationAction, type ActionState } from '@/modules/org/actions'
import { SUPPORTED_TIMEZONES } from '@/modules/org/validators'
import { Button, Field, Input } from '@/ui/primitives'

const INITIAL: ActionState = { status: 'idle' }

export function AddLocationForm() {
  const [state, formAction, pending] = useActionState(createLocationAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status !== 'idle' && state.message ? (
        <p
          role="status"
          className={
            state.status === 'success'
              ? 'rounded-control border-success/30 bg-success-soft text-success border px-3 py-2.5 text-sm font-medium'
              : 'rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2.5 text-sm font-medium'
          }
        >
          {state.message}
        </p>
      ) : null}

      <Field id="location-name" label="Location name" required error={state.fieldErrors?.name?.[0]}>
        {(props) => <Input {...props} name="name" maxLength={80} required />}
      </Field>

      <Field
        id="location-timezone"
        label="Timezone"
        hint="Shift times and business dates are calculated here."
        required
        error={state.fieldErrors?.timezone?.[0]}
      >
        {(props) => (
          <select
            {...props}
            name="timezone"
            defaultValue="America/Los_Angeles"
            required
            className="rounded-control border-field text-ink hover:border-faint min-h-11 w-full border bg-white px-3 text-sm focus:border-violet-600"
          >
            {SUPPORTED_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="location-city" label="City" error={state.fieldErrors?.city?.[0]}>
          {(props) => <Input {...props} name="city" maxLength={80} />}
        </Field>
        <Field id="location-region" label="State or region" error={state.fieldErrors?.region?.[0]}>
          {(props) => <Input {...props} name="region" maxLength={80} />}
        </Field>
      </div>

      <Button type="submit" loading={pending} className="self-start">
        Add location
      </Button>
    </form>
  )
}
