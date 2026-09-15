'use client'

import { createHandoffAction } from '@/modules/operations/actions'
import { MiniForm } from '@/ui/patterns/mini-form'
import { Field, Input } from '@/ui/primitives'
import { SELECT_CLASS, TEXTAREA_CLASS } from '../../training/_components/styles'

export function ManagerHandoffForm({
  locationId,
  categories,
}: {
  locationId: string
  categories: { value: string; label: string }[]
}) {
  return (
    <MiniForm
      action={createHandoffAction}
      hidden={{ locationId, shiftId: '' }}
      submitLabel="Leave handoff"
      variant="primary"
    >
      {(state) => (
        <>
          <Field
            id="handoff-category"
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
            id="handoff-title"
            label="In a few words"
            required
            error={state.fieldErrors?.title?.[0]}
          >
            {(p) => <Input {...p} name="title" maxLength={120} required autoComplete="off" />}
          </Field>
          <Field id="handoff-body" label="Details" hint="Optional.">
            {(p) => (
              <textarea {...p} name="body" rows={3} maxLength={1500} className={TEXTAREA_CLASS} />
            )}
          </Field>
          <label className="text-ink flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="priority"
              value="urgent"
              className="size-5 accent-violet-600"
            />
            Needs attention at the start of the next shift
          </label>
        </>
      )}
    </MiniForm>
  )
}
