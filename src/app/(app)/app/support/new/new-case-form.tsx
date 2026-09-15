'use client'

import { createCaseAction } from '@/modules/support/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { Field, Input } from '@/ui/primitives'
import { SELECT_CLASS, TEXTAREA_CLASS } from '../../training/_components/styles'

export function NewCaseForm({
  categories,
  severities,
}: {
  categories: { value: string; label: string }[]
  severities: { value: string; label: string }[]
}) {
  return (
    <ActionForm action={createCaseAction} submitLabel="Open case">
      {(state) => (
        <>
          <Field
            id="case-category"
            label="What is it about"
            required
            error={state.fieldErrors?.category?.[0]}
          >
            {(p) => (
              <select {...p} name="category" defaultValue="" required className={SELECT_CLASS}>
                <option value="" disabled>
                  Choose one
                </option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id="case-severity"
            label="How much is it affecting you"
            required
            error={state.fieldErrors?.severity?.[0]}
          >
            {(p) => (
              <select {...p} name="severity" defaultValue="normal" className={SELECT_CLASS}>
                {severities.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id="case-subject"
            label="In a few words"
            required
            error={state.fieldErrors?.subject?.[0]}
          >
            {(p) => <Input {...p} name="subject" maxLength={140} required autoComplete="off" />}
          </Field>
          <Field
            id="case-description"
            label="What happened"
            hint="What you did, what you expected, what you saw, and who it affects. Include the page address if you can. Attachments are not supported yet."
            required
            error={state.fieldErrors?.description?.[0]}
          >
            {(p) => (
              <textarea
                {...p}
                name="description"
                rows={6}
                maxLength={5000}
                required
                className={TEXTAREA_CLASS}
              />
            )}
          </Field>
        </>
      )}
    </ActionForm>
  )
}
