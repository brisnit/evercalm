'use client'

import { createTemplateAction } from '@/modules/onboarding/template-actions'
import { Field, Input } from '@/ui/primitives'
import { ActionForm } from '@/ui/patterns/action-form'

export function NewTemplateForm() {
  return (
    <ActionForm action={createTemplateAction} submitLabel="Create draft">
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="template-name"
            label="Name"
            hint="What your team would call it."
            required
            error={state.fieldErrors?.name?.[0]}
          >
            {(p) => (
              <Input
                {...p}
                name="name"
                required
                maxLength={120}
                placeholder="e.g. New Server Onboarding"
              />
            )}
          </Field>
          <Field
            id="template-description"
            label="Description"
            hint="Optional. Helps people pick the right one."
          >
            {(p) => <Input {...p} name="description" maxLength={400} />}
          </Field>
        </div>
      )}
    </ActionForm>
  )
}
