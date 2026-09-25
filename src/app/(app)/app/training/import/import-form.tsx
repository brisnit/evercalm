'use client'

import { importCourseAction } from '@/modules/training/actions'
import { Field, Input, Textarea } from '@/ui/primitives'
import { MiniForm } from '@/ui/patterns/mini-form'

/** Title, one-line summary, and the document itself. */
export function ImportForm() {
  return (
    <MiniForm
      action={importCourseAction}
      hidden={{}}
      submitLabel="Turn it into a course"
      variant="primary"
      size="lg"
    >
      {(state) => (
        <>
          <Field
            id="import-title"
            label="Course title"
            hint="What your team would call it."
            error={state.fieldErrors?.title?.[0]}
          >
            {(p) => <Input {...p} name="title" placeholder="Closing procedures" maxLength={120} />}
          </Field>
          <Field
            id="import-summary"
            label="Summary"
            hint="One or two sentences employees see before they start."
            error={state.fieldErrors?.summary?.[0]}
          >
            {(p) => (
              <Input
                {...p}
                name="summary"
                placeholder="What has to happen before the last person leaves."
                maxLength={200}
              />
            )}
          </Field>
          <Field
            id="import-text"
            label="The document"
            hint="Paste it. Headings become lessons."
            error={state.fieldErrors?.text?.[0]}
          >
            {(p) => <Textarea {...p} name="text" rows={16} />}
          </Field>
        </>
      )}
    </MiniForm>
  )
}
