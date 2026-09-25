'use client'

import { createChannelAction } from '@/modules/messaging/actions'
import { Field, Input, Select } from '@/ui/primitives'
import { MiniForm } from '@/ui/patterns/mini-form'

/** Opening a channel: a name, why it exists, and who is in it. */
export function ChannelForm() {
  return (
    <MiniForm action={createChannelAction} hidden={{}} submitLabel="Open channel" variant="primary">
      {(state) => (
        <>
          <Field id="channel-name" label="Name" error={state.fieldErrors?.name?.[0]}>
            {(p) => <Input {...p} name="name" placeholder="Back of house" maxLength={60} />}
          </Field>
          <Field
            id="channel-purpose"
            label="What it is for"
            hint="Optional. One line people see before they post."
            error={state.fieldErrors?.purpose?.[0]}
          >
            {(p) => (
              <Input
                {...p}
                name="purpose"
                placeholder="Prep, pars and anything the kitchen needs"
                maxLength={200}
              />
            )}
          </Field>
          <Field
            id="channel-audience"
            label="Who is in it"
            error={state.fieldErrors?.audience?.[0]}
          >
            {(p) => (
              <Select {...p} name="audience" defaultValue="everyone">
                <option value="everyone">Everyone at the organization</option>
                <option value="managers">Managers only</option>
              </Select>
            )}
          </Field>
        </>
      )}
    </MiniForm>
  )
}
