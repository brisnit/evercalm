import { Field, Input, Select } from '@/ui/primitives'

/**
 * A handoff, as simply as it can be asked for: the task, and who it is for.
 * Leaving "Assigned to" on the first option hands it to whoever is on next.
 */
export function HandoffTaskFields({
  prefix,
  assignees,
  errors,
}: {
  prefix: string
  assignees: { id: string; name: string }[]
  errors?: Record<string, string[]>
}) {
  return (
    <>
      <Field id={`${prefix}-title`} label="Task" required error={errors?.title?.[0]}>
        {(p) => (
          <Input
            {...p}
            name="title"
            maxLength={120}
            required
            autoComplete="off"
            placeholder="What needs doing"
            className="text-base sm:text-sm"
          />
        )}
      </Field>
      <Field
        id={`${prefix}-assignee`}
        label="Assigned to"
        error={errors?.assignedEmploymentId?.[0]}
      >
        {(p) => (
          <Select {...p} name="assignedEmploymentId" defaultValue="">
            <option value="">Whoever is on next</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  )
}
