'use client'

import {
  createDepartmentAction,
  createJobRoleAction,
  createStationAction,
} from '@/modules/structure/actions'
import { Card, CardHeader, Field, Input } from '@/ui/primitives'
import { ActionForm } from '@/ui/patterns/action-form'

const SELECT_CLASS =
  'min-h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm text-ink hover:border-faint focus:border-teal-600'

export function StructureForms({
  departments,
  locations,
  jobRoles,
}: {
  departments: { id: string; name: string }[]
  locations: { id: string; name: string }[]
  jobRoles: { id: string; name: string }[]
}) {
  return (
    <Card>
      <CardHeader title="Add to your structure" description="Use your own vocabulary." />
      <div className="grid gap-6 p-5 md:grid-cols-3">
        <ActionForm
          action={createDepartmentAction}
          submitLabel="Add department"
          variant="secondary"
        >
          {(state) => (
            <>
              <h3 className="font-display text-ink text-sm font-bold">Department</h3>
              <Field id="dept-name" label="Name" required error={state.fieldErrors?.name?.[0]}>
                {(p) => <Input {...p} name="name" required maxLength={80} />}
              </Field>
              <Field id="dept-desc" label="Description">
                {(p) => <Input {...p} name="description" maxLength={200} />}
              </Field>
            </>
          )}
        </ActionForm>

        <ActionForm action={createJobRoleAction} submitLabel="Add job role" variant="secondary">
          {(state) => (
            <>
              <h3 className="font-display text-ink text-sm font-bold">Job role</h3>
              <Field id="role-name" label="Name" required error={state.fieldErrors?.name?.[0]}>
                {(p) => <Input {...p} name="name" required maxLength={80} />}
              </Field>
              <Field id="role-dept" label="Department">
                {(p) => (
                  <select {...p} name="departmentId" className={SELECT_CLASS} defaultValue="">
                    <option value="">No department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </>
          )}
        </ActionForm>

        <ActionForm
          action={createStationAction}
          submitLabel="Add work position"
          variant="secondary"
        >
          {(state) => (
            <>
              <h3 className="font-display text-ink text-sm font-bold">Work position</h3>
              <Field id="station-name" label="Name" required error={state.fieldErrors?.name?.[0]}>
                {(p) => (
                  <Input
                    {...p}
                    name="name"
                    required
                    maxLength={80}
                    placeholder="e.g. Bar, Chair 3"
                  />
                )}
              </Field>
              <Field id="station-location" label="Location" required>
                {(p) => (
                  <select {...p} name="locationId" className={SELECT_CLASS} required>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field id="station-role" label="Usually worked by">
                {(p) => (
                  <select {...p} name="jobRoleId" className={SELECT_CLASS} defaultValue="">
                    <option value="">Any role</option>
                    {jobRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </>
          )}
        </ActionForm>
      </div>
    </Card>
  )
}
