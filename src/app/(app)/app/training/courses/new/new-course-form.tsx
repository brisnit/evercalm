'use client'

import { createCourseAction } from '@/modules/training/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { Field, Input } from '@/ui/primitives'
import { TEXTAREA_CLASS } from '../../_components/styles'

export function NewCourseForm() {
  return (
    <ActionForm action={createCourseAction} submitLabel="Create course">
      {(state) => (
        <>
          <Field
            id="course-title"
            label="Title"
            required
            hint="Name it the way your team would, such as “Allergen awareness for service”."
            error={state.fieldErrors?.title?.[0]}
          >
            {(p) => <Input {...p} name="title" required maxLength={120} autoComplete="off" />}
          </Field>
          <Field
            id="course-summary"
            label="Summary"
            hint="One or two sentences employees see before they start."
          >
            {(p) => (
              <textarea {...p} name="summary" rows={3} maxLength={600} className={TEXTAREA_CLASS} />
            )}
          </Field>
        </>
      )}
    </ActionForm>
  )
}
