'use client'

import { useState } from 'react'
import {
  changeEmploymentStatusAction,
  changeJobTitleAction,
  changeLocationAssignmentAction,
  changeManagerAction,
  grantRoleAction,
  recordCredentialAction,
  requestSeparationAction,
  separationDecisionAction,
  startOnboardingAction,
} from '@/modules/people/actions'
import { SEPARATION_REASON_CATEGORIES } from '@/modules/people/separation-service'
import { Badge, Card, CardHeader, Field, Input } from '@/ui/primitives'
import { ActionForm } from '@/ui/patterns/action-form'
import { ConfirmAction } from '@/ui/patterns/confirm-action'

/**
 * Employment change panels.
 *
 * Every panel is gated on a capability the SERVER also checks. Showing or
 * hiding a panel is a courtesy; the action refuses regardless.
 *
 * The separation panel is deliberately the heaviest thing on the page: a typed
 * confirmation, a mandatory reason, a two-person approval, and a cancel path
 * that stays available until the very last step.
 */

const SELECT_CLASS =
  'min-h-11 w-full rounded-control border border-line-strong bg-white px-3 text-sm text-ink hover:border-faint focus:border-violet-600'

const ROLE_OPTIONS = [
  { key: 'employee', label: 'Employee' },
  { key: 'shift_lead', label: 'Shift Lead' },
  { key: 'scheduler', label: 'Scheduler' },
  { key: 'general_manager', label: 'General Manager' },
  { key: 'training_manager', label: 'Training Manager' },
  { key: 'hr_admin', label: 'HR Administrator' },
  { key: 'owner', label: 'Owner' },
]

const REASON_LABELS: Record<string, string> = {
  resignation: 'Resignation',
  end_of_season: 'End of season',
  end_of_contract: 'End of contract',
  redundancy: 'Redundancy',
  mutual_agreement: 'Mutual agreement',
  dismissal: 'Dismissal',
  other: 'Other',
}

export interface PanelPermissions {
  update: boolean
  manageEmployment: boolean
  manageRoles: boolean
  manageCredentials: boolean
  separate: boolean
}

export function EmploymentPanels({
  employmentId,
  displayName,
  jobTitle,
  status,
  managerEmploymentId,
  locations,
  assignedLocationIds,
  colleagues,
  openSeparation,
  permissions,
}: {
  employmentId: string
  displayName: string
  jobTitle: string
  status: string
  managerEmploymentId: string
  locations: { id: string; name: string }[]
  assignedLocationIds: string[]
  colleagues: { id: string; name: string }[]
  openSeparation: { id: string; status: string; requestedBy: string | null } | null
  permissions: PanelPermissions
}) {
  const [tab, setTab] = useState<'employment' | 'access' | 'credentials' | 'offboarding'>(
    'employment',
  )
  const separated = status === 'separated'

  const tabs = [
    {
      key: 'employment' as const,
      label: 'Employment',
      show: permissions.update || permissions.manageEmployment,
    },
    { key: 'access' as const, label: 'Access', show: permissions.manageRoles },
    { key: 'credentials' as const, label: 'Credentials', show: permissions.manageCredentials },
    { key: 'offboarding' as const, label: 'Offboarding', show: permissions.separate },
  ].filter((t) => t.show)

  if (tabs.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Manage this employment"
        description="Every change here is recorded in the audit log with your name against it."
      />

      <div className="border-line border-b px-2">
        <div role="tablist" aria-label="Employment management" className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={
                tab === t.key
                  ? 'text-ink inline-flex min-h-11 items-center border-b-2 border-violet-600 px-3 text-sm font-semibold'
                  : 'text-muted hover:text-ink inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === 'employment' ? (
          <div
            role="tabpanel"
            id="panel-employment"
            aria-labelledby="tab-employment"
            className="grid gap-6 md:grid-cols-2"
          >
            {permissions.update ? (
              <ActionForm
                action={changeJobTitleAction}
                submitLabel="Save job title"
                variant="secondary"
              >
                {(state) => (
                  <>
                    <input type="hidden" name="employmentId" value={employmentId} />
                    <Field
                      id="job-title"
                      label="Job title"
                      hint="What this person is called. Job roles for scheduling are separate."
                      error={state.fieldErrors?.jobTitle?.[0]}
                    >
                      {(p) => (
                        <Input {...p} name="jobTitle" defaultValue={jobTitle} maxLength={120} />
                      )}
                    </Field>
                  </>
                )}
              </ActionForm>
            ) : null}

            {permissions.manageEmployment ? (
              <ActionForm
                action={changeManagerAction}
                submitLabel="Save reporting line"
                variant="secondary"
              >
                <input type="hidden" name="employmentId" value={employmentId} />
                <Field id="manager" label="Reports to">
                  {(p) => (
                    <select
                      {...p}
                      name="managerEmploymentId"
                      defaultValue={managerEmploymentId}
                      className={SELECT_CLASS}
                    >
                      <option value="">Nobody</option>
                      {colleagues.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </ActionForm>
            ) : null}

            {permissions.manageEmployment ? (
              <ActionForm
                action={changeLocationAssignmentAction}
                submitLabel="Update locations"
                variant="secondary"
              >
                <input type="hidden" name="employmentId" value={employmentId} />
                <Field id="location-assign" label="Location assignment">
                  {(p) => (
                    <select {...p} name="locationId" className={SELECT_CLASS}>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                          {assignedLocationIds.includes(l.id) ? ' (assigned)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="location-intent" label="Action">
                  {(p) => (
                    <select {...p} name="intent" className={SELECT_CLASS}>
                      <option value="add">Add to this location</option>
                      <option value="remove">Remove from this location</option>
                    </select>
                  )}
                </Field>
              </ActionForm>
            ) : null}

            {permissions.manageEmployment && !separated ? (
              <div className="md:col-span-2">
                <ConfirmAction
                  triggerLabel={status === 'suspended' ? 'Restore access' : 'Suspend access'}
                  title={status === 'suspended' ? 'Restore access' : 'Suspend access'}
                  description={
                    status === 'suspended'
                      ? `${displayName} will be able to sign in again immediately.`
                      : `${displayName} will be signed out and unable to sign in. Their employment and records are untouched, and this is fully reversible.`
                  }
                >
                  <ActionForm
                    action={changeEmploymentStatusAction}
                    submitLabel={status === 'suspended' ? 'Restore access' : 'Suspend access'}
                    destructive={status !== 'suspended'}
                  >
                    {(state) => (
                      <>
                        <input type="hidden" name="employmentId" value={employmentId} />
                        <input
                          type="hidden"
                          name="status"
                          value={status === 'suspended' ? 'active' : 'suspended'}
                        />
                        <Field
                          id="status-reason"
                          label="Reason"
                          required
                          error={state.fieldErrors?.reason?.[0]}
                        >
                          {(p) => <Input {...p} name="reason" required maxLength={200} />}
                        </Field>
                      </>
                    )}
                  </ActionForm>
                </ConfirmAction>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'access' ? (
          <div role="tabpanel" id="panel-access" aria-labelledby="tab-access">
            <ActionForm action={grantRoleAction} submitLabel="Grant role">
              <input type="hidden" name="employmentId" value={employmentId} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="grant-role" label="Role">
                  {(p) => (
                    <select {...p} name="roleKey" className={SELECT_CLASS} defaultValue="employee">
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="grant-scope" label="Applies to">
                  {(p) => (
                    <select {...p} name="scope" className={SELECT_CLASS} defaultValue="location">
                      <option value="location">One location</option>
                      <option value="org">The whole organization</option>
                    </select>
                  )}
                </Field>
                <Field id="grant-location" label="Location">
                  {(p) => (
                    <select {...p} name="locationId" className={SELECT_CLASS}>
                      <option value="">—</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              <p className="text-faint text-xs">
                A location-scoped role applies only at that site. Organization-level controls such
                as billing and permissions can only ever be granted organization-wide.
              </p>
            </ActionForm>
          </div>
        ) : null}

        {tab === 'credentials' ? (
          <div role="tabpanel" id="panel-credentials" aria-labelledby="tab-credentials">
            <ActionForm action={recordCredentialAction} submitLabel="Record credential">
              {(state) => (
                <>
                  <input type="hidden" name="employmentId" value={employmentId} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      id="cred-name"
                      label="Credential"
                      hint="Licence, certification, or card"
                      required
                      error={state.fieldErrors?.name?.[0]}
                    >
                      {(p) => <Input {...p} name="name" required maxLength={120} />}
                    </Field>
                    <Field id="cred-authority" label="Issued by">
                      {(p) => <Input {...p} name="issuingAuthority" maxLength={120} />}
                    </Field>
                    <Field
                      id="cred-identifier"
                      label="Number"
                      hint="Stored as sensitive information"
                    >
                      {(p) => <Input {...p} name="identifier" maxLength={120} />}
                    </Field>
                    <Field id="cred-expires" label="Expires on">
                      {(p) => <Input {...p} name="expiresOn" type="date" />}
                    </Field>
                  </div>
                </>
              )}
            </ActionForm>
          </div>
        ) : null}

        {tab === 'offboarding' ? (
          <div role="tabpanel" id="panel-offboarding" aria-labelledby="tab-offboarding">
            {separated ? (
              <p className="text-muted text-sm">
                This employment ended. The record is retained for history and cannot be reopened
                here.
              </p>
            ) : openSeparation ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-control border-warning/40 bg-warning-soft border px-4 py-3">
                  <p className="text-ink text-sm font-medium">
                    Separation{' '}
                    {openSeparation.status === 'approved' ? 'approved' : 'awaiting approval'}
                  </p>
                  <p className="text-muted mt-1 text-sm">
                    {openSeparation.status === 'approved'
                      ? 'Completing it will end the employment and revoke access. Until you do, nothing has changed.'
                      : `Filed by ${openSeparation.requestedBy ?? 'a colleague'}. A different person holding the separation permission has to approve it.`}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  {openSeparation.status === 'pending_approval' ? (
                    <ActionForm action={separationDecisionAction} submitLabel="Approve separation">
                      <input type="hidden" name="employmentId" value={employmentId} />
                      <input type="hidden" name="separationId" value={openSeparation.id} />
                      <input type="hidden" name="intent" value="approve" />
                      <p className="text-faint text-xs">
                        You cannot approve a separation you filed yourself.
                      </p>
                    </ActionForm>
                  ) : (
                    <ConfirmAction
                      triggerLabel="Complete separation"
                      title="Complete this separation"
                      description={`${displayName} will be marked as separated and every role grant revoked. This is the only step that cannot be undone.`}
                    >
                      <ActionForm
                        action={separationDecisionAction}
                        submitLabel="Complete and revoke access"
                        destructive
                      >
                        <input type="hidden" name="employmentId" value={employmentId} />
                        <input type="hidden" name="separationId" value={openSeparation.id} />
                        <input type="hidden" name="intent" value="complete" />
                      </ActionForm>
                    </ConfirmAction>
                  )}

                  <ActionForm
                    action={separationDecisionAction}
                    submitLabel="Cancel separation"
                    variant="secondary"
                  >
                    <input type="hidden" name="employmentId" value={employmentId} />
                    <input type="hidden" name="separationId" value={openSeparation.id} />
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="reason" value="Cancelled by a manager" />
                  </ActionForm>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-control border-line bg-sunk border px-4 py-3">
                  <p className="text-ink text-sm font-medium">How this works</p>
                  <ul className="text-muted mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
                    <li>Filing a separation changes nothing on its own.</li>
                    <li>A second person holding the separation permission must approve it.</li>
                    <li>It can be cancelled at any point before completion.</li>
                    <li>Completing it ends the employment and revokes access.</li>
                  </ul>
                  <p className="text-faint mt-2 text-xs">
                    EverCalm records this decision. It does not make it, and offers no
                    jurisdiction-specific advice about it.
                  </p>
                </div>

                <ConfirmAction
                  triggerLabel="Begin offboarding"
                  title={`Begin offboarding for ${displayName}`}
                  description="This files a separation for a second person to review. Nothing changes for this employee yet."
                >
                  <ActionForm
                    action={requestSeparationAction}
                    submitLabel="File separation"
                    destructive
                  >
                    {(state) => (
                      <>
                        <input type="hidden" name="employmentId" value={employmentId} />
                        <input type="hidden" name="expectedConfirmation" value={displayName} />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field id="sep-category" label="Category" required>
                            {(p) => (
                              <select
                                {...p}
                                name="reasonCategory"
                                className={SELECT_CLASS}
                                required
                              >
                                {SEPARATION_REASON_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {REASON_LABELS[c] ?? c}
                                  </option>
                                ))}
                              </select>
                            )}
                          </Field>
                          <Field
                            id="sep-effective"
                            label="Effective on"
                            required
                            error={state.fieldErrors?.effectiveOn?.[0]}
                          >
                            {(p) => <Input {...p} name="effectiveOn" type="date" required />}
                          </Field>
                        </div>
                        <Field
                          id="sep-reason"
                          label="Reason"
                          hint="Recorded permanently in the audit history."
                          required
                          error={state.fieldErrors?.reason?.[0]}
                        >
                          {(p) => <Input {...p} name="reason" required maxLength={500} />}
                        </Field>
                        <Field
                          id="sep-confirm"
                          label={`Type "${displayName}" to confirm`}
                          required
                          error={state.fieldErrors?.confirmation?.[0]}
                        >
                          {(p) => <Input {...p} name="confirmation" required autoComplete="off" />}
                        </Field>
                      </>
                    )}
                  </ActionForm>
                </ConfirmAction>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {separated ? (
        <div className="border-line border-t px-5 py-3">
          <Badge tone="neutral">Employment ended</Badge>
        </div>
      ) : null}
    </Card>
  )
}

/**
 * Starting onboarding.
 *
 * Lives next to the "Onboarding has not started" empty state rather than in
 * the management panels below: the empty state is where an administrator is
 * told to assign a checklist, and the control to do it was a full screen away
 * from that instruction.
 */
export function StartOnboardingForm({ employmentId }: { employmentId: string }) {
  return (
    <ActionForm action={startOnboardingAction} submitLabel="Start onboarding">
      <input type="hidden" name="employmentId" value={employmentId} />
    </ActionForm>
  )
}
