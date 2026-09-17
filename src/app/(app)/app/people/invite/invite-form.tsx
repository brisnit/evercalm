'use client'

import { useActionState, useState } from 'react'
import { sendInvitationAction, type InviteActionState } from '@/modules/invitations/actions'
import { Button, Field, Input } from '@/ui/primitives'

const INITIAL: InviteActionState = { status: 'idle' }

const SELECT_CLASS =
  'min-h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm text-ink hover:border-faint focus:border-teal-600'

const ROLES = [
  { key: 'employee', label: 'Employee', hint: 'Their own schedule, training, and tasks.' },
  {
    key: 'shift_lead',
    label: 'Shift Lead',
    hint: 'Employee, plus checklist verification and handoffs.',
  },
  {
    key: 'scheduler',
    label: 'Scheduler',
    hint: 'Availability, schedules, swaps, and open shifts.',
  },
  { key: 'general_manager', label: 'General Manager', hint: 'Runs a location day to day.' },
  {
    key: 'training_manager',
    label: 'Training Manager',
    hint: 'Courses, assignments, and verification.',
  },
  {
    key: 'hr_admin',
    label: 'HR Administrator',
    hint: 'Employee records, onboarding, and offboarding.',
  },
  { key: 'owner', label: 'Owner', hint: 'Everything, including permissions and billing.' },
]

export function InviteForm({ locations }: { locations: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(sendInvitationAction, INITIAL)
  const [roleKey, setRoleKey] = useState('employee')
  const [scope, setScope] = useState('location')

  const roleHint = ROLES.find((r) => r.key === roleKey)?.hint

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status !== 'idle' && state.message ? (
        <div
          role="status"
          className={
            state.status === 'success'
              ? 'rounded-control border-success/30 bg-success-soft text-success border px-3 py-3 text-sm'
              : 'rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-3 text-sm font-medium'
          }
        >
          <p className="font-medium">{state.message}</p>
          {state.acceptUrl ? (
            <p className="text-ink mt-2 break-all">
              Acceptance link:{' '}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs">{state.acceptUrl}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="invite-name"
          label="Full name"
          required
          error={state.fieldErrors?.displayName?.[0]}
        >
          {(p) => <Input {...p} name="displayName" required maxLength={120} autoComplete="off" />}
        </Field>
        <Field id="invite-email" label="Email" required error={state.fieldErrors?.email?.[0]}>
          {(p) => <Input {...p} name="email" type="email" required autoComplete="off" />}
        </Field>
      </div>

      <Field id="invite-title" label="Job title" hint="Optional. What they are called day to day.">
        {(p) => <Input {...p} name="jobTitle" maxLength={120} />}
      </Field>

      <Field id="invite-role" label="Role" hint={roleHint} required>
        {(p) => (
          <select
            {...p}
            name="roleKey"
            className={SELECT_CLASS}
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
            required
          >
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="invite-scope" label="Applies to" required>
          {(p) => (
            <select
              {...p}
              name="scope"
              className={SELECT_CLASS}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="location">One location</option>
              <option value="org">The whole organization</option>
            </select>
          )}
        </Field>
        <Field
          id="invite-location"
          label="Location"
          required={scope === 'location'}
          error={state.fieldErrors?.locationId?.[0]}
        >
          {(p) => (
            <select {...p} name="locationId" className={SELECT_CLASS} defaultValue="">
              <option value="">{scope === 'org' ? 'Not needed' : 'Choose a location'}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Button type="submit" loading={pending} className="self-start">
        Create invitation
      </Button>
    </form>
  )
}
