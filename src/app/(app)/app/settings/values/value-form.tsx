'use client'

import { createValueAction } from '@/modules/structure/actions'
import { Field, Input } from '@/ui/primitives'
import { ActionForm } from '@/ui/patterns/action-form'

const SELECT_CLASS =
  'min-h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm text-ink hover:border-faint focus:border-teal-600'

export function ValueForm() {
  return (
    <ActionForm action={createValueAction} submitLabel="Add">
      {(state) => (
        <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
          <Field id="value-kind" label="Type" required>
            {(p) => (
              <select {...p} name="kind" className={SELECT_CLASS} defaultValue="value">
                <option value="value">Company value</option>
                <option value="standard">Operating standard</option>
              </select>
            )}
          </Field>
          <Field id="value-title" label="Title" required error={state.fieldErrors?.title?.[0]}>
            {(p) => <Input {...p} name="title" required maxLength={120} />}
          </Field>
          <div className="md:col-span-2">
            <Field
              id="value-body"
              label="What it means in practice"
              hint="Concrete beats aspirational. People should be able to tell whether they did it."
              required
              error={state.fieldErrors?.body?.[0]}
            >
              {(p) => (
                <textarea
                  {...p}
                  name="body"
                  required
                  rows={3}
                  maxLength={600}
                  className="rounded-control border-field text-ink hover:border-faint w-full border bg-white px-3 py-2.5 text-sm focus:border-teal-600"
                />
              )}
            </Field>
          </div>
        </div>
      )}
    </ActionForm>
  )
}
