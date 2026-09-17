'use client'

import { createTemplateAction } from '@/modules/operations/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { Field, Input } from '@/ui/primitives'
import { SELECT_CLASS } from '../../../training/_components/styles'

export function NewTemplateForm({
  kinds,
  locations,
  mayTargetEveryLocation,
}: {
  kinds: { value: string; label: string }[]
  locations: { id: string; name: string }[]
  mayTargetEveryLocation: boolean
}) {
  return (
    <ActionForm action={createTemplateAction} submitLabel="Create template">
      {(state) => (
        <>
          <Field id="template-name" label="Name" required error={state.fieldErrors?.name?.[0]}>
            {(p) => (
              <Input
                {...p}
                name="name"
                maxLength={80}
                required
                autoComplete="off"
                placeholder="Bar close"
              />
            )}
          </Field>
          <Field
            id="template-kind"
            label="Kind of work"
            required
            error={state.fieldErrors?.kind?.[0]}
          >
            {(p) => (
              <select {...p} name="kind" defaultValue="side_work" className={SELECT_CLASS}>
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="flex flex-col gap-1.5" aria-describedby="template-locations-hint">
            <legend className="text-ink text-sm font-medium">Locations</legend>
            <p id="template-locations-hint" className="text-muted text-xs">
              {mayTargetEveryLocation
                ? 'Leave all unticked to use it at every location.'
                : 'Choose the locations you manage that should use it.'}
            </p>
            {state.fieldErrors?.locationIds?.[0] ? (
              <p role="alert" className="text-danger text-xs font-medium">
                {state.fieldErrors.locationIds[0]}
              </p>
            ) : null}
            {locations.map((l) => (
              <label key={l.id} className="text-ink flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="locationIds"
                  value={l.id}
                  className="size-5 accent-teal-600"
                />
                {l.name}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </ActionForm>
  )
}
