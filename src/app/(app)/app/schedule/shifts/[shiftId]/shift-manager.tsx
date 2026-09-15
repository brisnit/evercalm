'use client'

import Link from 'next/link'
import {
  assignShiftAction,
  cancelShiftAction,
  setShiftOpenAction,
  updateShiftAction,
} from '@/modules/scheduling/actions'
import type { ManagedShift } from '@/modules/scheduling/manager'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Badge, Card, CardHeader, Field, Input, TextLink } from '@/ui/primitives'
import { SELECT_CLASS } from '../../_components/add-shift-form'

function hours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * Everything a manager does to one shift. Results show in one notice held
 * here, because assigning someone removes them from the candidate list their
 * button was in.
 */
export function ShiftManager({
  shift,
  days,
  jobRoles,
  stations,
  weekHref,
}: {
  shift: ManagedShift
  days: { date: string; label: string }[]
  jobRoles: { id: string; name: string }[]
  stations: { id: string; name: string }[]
  weekHref: string
}) {
  const { notice, show, dismiss } = useActionNotice()
  const editable = shift.permissions.draft && shift.status === 'active'

  return (
    <div className="flex flex-col gap-5">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          {shift.conflicts.length > 0 ? (
            <Card>
              <CardHeader
                title="Conflicts"
                description={`For ${shift.assigneeName ?? 'the person on this shift'}.`}
              />
              <ul className="flex flex-col gap-2 p-5">
                {shift.conflicts.map((c) => (
                  <li
                    key={`${c.kind}-${c.relatedId ?? ''}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <Badge tone={c.severity === 'block' ? 'danger' : 'warning'}>
                      {c.severity === 'block' ? 'Must fix' : 'Check'}
                    </Badge>
                    <span className="text-ink">{c.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Details"
              description={
                shift.published
                  ? 'The team sees changes when you publish them from the week.'
                  : 'Not published yet, so nobody has been told about this shift.'
              }
            />
            <div className="p-5">
              {editable ? (
                <ActionForm action={updateShiftAction} submitLabel="Save changes" onSuccess={show}>
                  {(state) => (
                    <>
                      <input type="hidden" name="shiftId" value={shift.id} />
                      <Field
                        id="edit-date"
                        label="Day"
                        required
                        error={state.fieldErrors?.date?.[0]}
                      >
                        {(p) => (
                          <select
                            {...p}
                            name="date"
                            defaultValue={shift.date}
                            className={SELECT_CLASS}
                          >
                            {days.map((d) => (
                              <option key={d.date} value={d.date}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          id="edit-start"
                          label="Starts"
                          required
                          error={state.fieldErrors?.startTime?.[0]}
                        >
                          {(p) => (
                            <Input
                              {...p}
                              type="time"
                              name="startTime"
                              required
                              defaultValue={shift.startTime}
                            />
                          )}
                        </Field>
                        <Field
                          id="edit-end"
                          label="Ends"
                          required
                          hint="Earlier than the start means the next day."
                          error={state.fieldErrors?.endTime?.[0]}
                        >
                          {(p) => (
                            <Input
                              {...p}
                              type="time"
                              name="endTime"
                              required
                              defaultValue={shift.endTime}
                            />
                          )}
                        </Field>
                      </div>
                      <Field
                        id="edit-break"
                        label="Unpaid break (minutes)"
                        error={state.fieldErrors?.breakMinutes?.[0]}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="number"
                            name="breakMinutes"
                            min={0}
                            max={240}
                            step={5}
                            defaultValue={shift.breakMinutes}
                          />
                        )}
                      </Field>
                      <Field
                        id="edit-role"
                        label="Job role"
                        error={state.fieldErrors?.jobRoleId?.[0]}
                      >
                        {(p) => (
                          <select
                            {...p}
                            name="jobRoleId"
                            defaultValue={shift.jobRoleId ?? ''}
                            className={SELECT_CLASS}
                          >
                            <option value="">Any role</option>
                            {jobRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                      {stations.length > 0 ? (
                        <Field
                          id="edit-station"
                          label="Station"
                          error={state.fieldErrors?.stationId?.[0]}
                        >
                          {(p) => (
                            <select
                              {...p}
                              name="stationId"
                              defaultValue={shift.stationId ?? ''}
                              className={SELECT_CLASS}
                            >
                              <option value="">No station</option>
                              {stations.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                      ) : null}
                      <Field id="edit-notes" label="Notes">
                        {(p) => (
                          <Input {...p} name="notes" maxLength={500} defaultValue={shift.notes} />
                        )}
                      </Field>
                    </>
                  )}
                </ActionForm>
              ) : (
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt className="text-muted text-xs">Notes</dt>
                    <dd className="text-ink">{shift.notes || 'None'}</dd>
                  </div>
                </dl>
              )}
            </div>
          </Card>

          {shift.permissions.draft ? (
            <Card>
              <CardHeader
                title="Remove"
                description={
                  shift.published
                    ? 'Cancels the shift. Whoever is on it is told when you publish.'
                    : 'Deletes it. Nobody was ever told about it.'
                }
              />
              <div className="p-5">
                <ConfirmAction
                  triggerLabel={shift.published ? 'Cancel this shift' : 'Delete this shift'}
                  title={shift.published ? 'Cancel this shift?' : 'Delete this shift?'}
                  description={
                    shift.published
                      ? 'It stays on the week, marked cancelled, until you publish the change.'
                      : 'It is removed from the week straight away.'
                  }
                >
                  <ActionForm
                    action={cancelShiftAction}
                    submitLabel={shift.published ? 'Yes, cancel it' : 'Yes, delete it'}
                    destructive
                    onSuccess={show}
                  >
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <input type="hidden" name="returnTo" value={weekHref} />
                  </ActionForm>
                </ConfirmAction>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Who is on it"
              description={
                shift.assigneeName
                  ? shift.assigneeName
                  : shift.isOpen
                    ? 'Nobody yet. Offered as an open shift.'
                    : 'Nobody yet.'
              }
            />
            <div className="flex flex-col gap-3 p-5">
              {editable && shift.assigneeEmploymentId ? (
                <ActionForm
                  action={assignShiftAction}
                  submitLabel="Remove them from this shift"
                  variant="secondary"
                  onSuccess={show}
                >
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <input type="hidden" name="assigneeEmploymentId" value="" />
                </ActionForm>
              ) : null}

              {shift.permissions.openShifts &&
              shift.status === 'active' &&
              !shift.assigneeEmploymentId ? (
                <ActionForm
                  action={setShiftOpenAction}
                  submitLabel={shift.isOpen ? 'Stop offering it' : 'Offer as an open shift'}
                  variant="secondary"
                  onSuccess={show}
                >
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <input type="hidden" name="open" value={shift.isOpen ? 'false' : 'true'} />
                  <p className="text-muted text-sm">
                    {shift.isOpen
                      ? 'People who asked for it are told it is no longer offered.'
                      : 'Eligible people at this location can ask for it once you publish.'}
                  </p>
                </ActionForm>
              ) : null}

              {shift.swap ? (
                <p className="rounded-control border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm">
                  {shift.swap.requesterName} has asked {shift.swap.recipientName} to{' '}
                  {shift.swap.kind === 'trade' ? 'trade' : 'take'} this shift.{' '}
                  {shift.swap.status === 'pending_manager' ? (
                    <Link
                      href="/app/schedule/requests"
                      className="font-medium underline underline-offset-4"
                    >
                      Waiting for a manager
                    </Link>
                  ) : (
                    'Waiting for them to answer.'
                  )}
                </p>
              ) : null}

              {shift.claims.length > 0 ? (
                <div>
                  <h3 className="text-ink text-sm font-semibold">
                    {shift.claims.length} {shift.claims.length === 1 ? 'person has' : 'people have'}{' '}
                    asked for it
                  </h3>
                  <ul className="mt-1.5 flex flex-col gap-1 text-sm">
                    {shift.claims.map((c) => (
                      <li key={c.id} className="text-muted">
                        {c.displayName}
                        {c.conflicts.some((x) => x.severity === 'block') ? ' - cannot take it' : ''}
                      </li>
                    ))}
                  </ul>
                  <TextLink href="/app/schedule/requests" className="mt-2 inline-block text-sm">
                    Decide in Requests
                  </TextLink>
                </div>
              ) : null}
            </div>
          </Card>

          {editable ? (
            <Card>
              <CardHeader
                title={shift.assigneeEmploymentId ? 'Give it to someone else' : 'Assign someone'}
                description="Best fit first. Anyone who cannot work it says why."
              />
              <ul className="divide-line divide-y">
                {shift.candidates.map((c) => (
                  <li
                    key={c.employmentId}
                    className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-ink text-sm font-medium">
                        {c.displayName}
                        {!c.holdsRole ? (
                          <span className="text-muted font-normal"> · different role</span>
                        ) : null}
                      </p>
                      <p className="text-muted text-xs">{hours(c.weekMinutes)} already this week</p>
                      {c.conflicts.length > 0 ? (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {c.conflicts.map((x) => (
                            <li
                              key={`${x.kind}-${x.relatedId ?? ''}`}
                              className={
                                x.severity === 'block'
                                  ? 'text-danger text-xs'
                                  : 'text-warning text-xs'
                              }
                            >
                              {x.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    {c.blocked ? (
                      <span className="text-muted shrink-0 text-xs">Cannot be assigned</span>
                    ) : (
                      <ActionForm
                        action={assignShiftAction}
                        submitLabel="Assign"
                        variant="secondary"
                        className="shrink-0"
                        onSuccess={show}
                      >
                        <input type="hidden" name="shiftId" value={shift.id} />
                        <input type="hidden" name="assigneeEmploymentId" value={c.employmentId} />
                      </ActionForm>
                    )}
                  </li>
                ))}
                {shift.candidates.length === 0 ? (
                  <li className="text-muted px-5 py-3 text-sm">
                    Nobody else works at this location.
                  </li>
                ) : null}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
