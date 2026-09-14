'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import {
  allowAttemptAction,
  assignCourseAction,
  moveNotStartedAction,
  withdrawAssignmentAction,
} from '@/modules/training/actions'
import type { StatusTone } from '@/modules/training/progress'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Badge, Card, CardHeader, EmptyState, Field, Input, ProgressBar } from '@/ui/primitives'
import { SELECT_CLASS, TEXTAREA_CLASS } from '../../../_components/styles'

interface Row {
  assignmentId: string
  personName: string
  locations: string
  versionNumber: number
  statusKey: string
  statusLabel: string
  statusTone: StatusTone
  percent: number
  progressLabel: string
  dueLabel: string
  completedLabel: string | null
  scoreLabel: string | null
  outOfAttempts: { lessonId: string; lessonTitle: string }[]
  canManage: boolean
  open: boolean
  movable: boolean
}

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'awaiting_signoff', label: 'Waiting for sign-off' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'not_started', label: 'Not started' },
  { key: 'completed', label: 'Completed' },
] as const

export function PeopleWorkspace({
  courseId,
  currentVersion,
  archived,
  today,
  locations,
  locationId,
  assignable,
  rows,
}: {
  courseId: string
  currentVersion: number | null
  archived: boolean
  today: string
  locations: { id: string; name: string }[]
  locationId: string | null
  assignable: {
    locationName: string
    jobRoles: { id: string; name: string; count: number }[]
    people: { id: string; name: string; roles: string; existing: string | null; open: boolean }[]
  } | null
  rows: Row[] | null
}) {
  const { notice, show, dismiss } = useActionNotice()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [formKey, setFormKey] = useState(0)

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === 'all' || r.statusKey === filter),
    [rows, filter],
  )
  const movable = (rows ?? []).filter((r) => r.movable).length

  return (
    <div className="flex flex-col gap-5">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        {rows ? (
          <Card>
            <CardHeader
              title="Progress"
              description="Overdue work first, then what is waiting on a manager."
            />
            <div
              className="border-line flex flex-wrap gap-2 border-b px-5 py-3"
              role="group"
              aria-label="Filter by status"
            >
              {FILTERS.map((f) => {
                const count =
                  f.key === 'all' ? rows.length : rows.filter((r) => r.statusKey === f.key).length
                if (f.key !== 'all' && count === 0) return null
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={
                      filter === f.key
                        ? 'inline-flex min-h-9 items-center rounded-full bg-violet-600 px-3 text-sm font-medium text-white'
                        : 'border-line-strong text-ink hover:bg-sunk inline-flex min-h-9 items-center rounded-full border bg-white px-3 text-sm'
                    }
                  >
                    {f.label} <span className="ml-1.5 tabular-nums opacity-80">{count}</span>
                  </button>
                )
              })}
            </div>

            {movable > 0 && currentVersion !== null ? (
              <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b bg-violet-50 px-5 py-3">
                <p className="text-ink min-w-0 flex-1 basis-60 text-sm">
                  {movable} {movable === 1 ? 'person has' : 'people have'} not started and{' '}
                  {movable === 1 ? 'is' : 'are'} on an older version. Anyone who has started stays
                  where they are.
                </p>
                <ActionForm
                  action={moveNotStartedAction}
                  submitLabel={`Move to version ${currentVersion}`}
                  variant="secondary"
                  onSuccess={show}
                  className="flex"
                >
                  <input type="hidden" name="courseId" value={courseId} />
                </ActionForm>
              </div>
            ) : null}

            {rows.length === 0 ? (
              <p className="text-muted px-5 py-6 text-sm">
                Nobody you look after has been assigned this course yet.
              </p>
            ) : (
              <ul className="divide-line divide-y" aria-label="People assigned this course">
                {visible.map((row) => (
                  <li
                    key={row.assignmentId}
                    className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <div className="min-w-0">
                      <p className="text-ink font-medium">{row.personName}</p>
                      <p className="text-muted text-xs">{row.locations}</p>
                      <p className="text-muted mt-1 text-xs">
                        Version {row.versionNumber}
                        {currentVersion !== null && row.versionNumber < currentVersion
                          ? ` · current is ${currentVersion}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <span>
                        <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                      </span>
                      <ProgressBar
                        value={row.percent}
                        label={row.progressLabel}
                        tone={
                          row.statusKey === 'completed'
                            ? 'success'
                            : row.statusKey === 'overdue'
                              ? 'danger'
                              : 'violet'
                        }
                      />
                      <p className="text-muted text-xs">
                        {[row.completedLabel ?? row.dueLabel, row.scoreLabel]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {row.canManage && row.open ? (
                        <div className="flex flex-col gap-2">
                          {row.outOfAttempts.map((lesson) => (
                            <div
                              key={lesson.lessonId}
                              className="rounded-control border-warning/30 bg-warning-soft border px-3 py-2"
                            >
                              <p className="text-ink text-xs">
                                Out of attempts on “{lesson.lessonTitle}”.
                              </p>
                              <ActionForm
                                action={allowAttemptAction}
                                submitLabel="Allow another attempt"
                                variant="secondary"
                                onSuccess={show}
                                className="mt-2 flex"
                              >
                                <input type="hidden" name="assignmentId" value={row.assignmentId} />
                                <input type="hidden" name="lessonId" value={lesson.lessonId} />
                              </ActionForm>
                            </div>
                          ))}
                          <ConfirmAction
                            triggerLabel="Withdraw"
                            title={`Withdraw this training from ${row.personName}?`}
                            description="They no longer need to finish it. Anything they have done stays on record."
                          >
                            <ActionForm
                              action={withdrawAssignmentAction}
                              submitLabel="Withdraw training"
                              destructive
                              variant="danger"
                              onSuccess={show}
                            >
                              {(state) => (
                                <>
                                  <input
                                    type="hidden"
                                    name="assignmentId"
                                    value={row.assignmentId}
                                  />
                                  <Field
                                    id={`reason-${row.assignmentId}`}
                                    label="Reason"
                                    required
                                    error={state.fieldErrors?.reason?.[0]}
                                  >
                                    {(p) => <Input {...p} name="reason" maxLength={500} required />}
                                  </Field>
                                </>
                              )}
                            </ActionForm>
                          </ConfirmAction>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <EmptyState
            title="Progress is not available to you"
            description="You can assign this course, but reading progress needs another permission."
          />
        )}

        <div className="flex min-w-0 flex-col gap-5">
          {currentVersion === null ? (
            <EmptyState
              title="Not published yet"
              description="Publish the course before assigning it."
            />
          ) : archived ? (
            <EmptyState title="Archived" description="Archived courses cannot be assigned." />
          ) : locations.length === 0 ? null : (
            <Card>
              <CardHeader
                title="Assign"
                description={`New assignments get version ${currentVersion}.`}
              />
              <div className="flex flex-col gap-4 p-5">
                {locations.length > 1 ? (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="assign-location" className="text-ink text-sm font-medium">
                      Location
                    </label>
                    <select
                      id="assign-location"
                      value={locationId ?? ''}
                      onChange={(e) =>
                        startTransition(() =>
                          router.push(
                            `/app/training/courses/${courseId}/people?location=${e.target.value}`,
                          ),
                        )
                      }
                      className={SELECT_CLASS}
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {assignable ? (
                  <ActionForm
                    key={`${locationId}-${formKey}`}
                    action={assignCourseAction}
                    submitLabel="Assign"
                    onSuccess={(state) => {
                      show(state)
                      setFormKey((n) => n + 1)
                    }}
                  >
                    {(state) => (
                      <>
                        <input type="hidden" name="courseId" value={courseId} />
                        <input type="hidden" name="locationId" value={locationId ?? ''} />
                        <fieldset className="flex flex-col gap-1">
                          <legend className="text-ink mb-1.5 text-sm font-medium">
                            People at {assignable.locationName}
                          </legend>
                          {assignable.people.length === 0 ? (
                            <p className="text-muted text-sm">
                              Nobody is assigned to this location yet.
                            </p>
                          ) : (
                            assignable.people.map((p) => (
                              <label
                                key={p.id}
                                className="hover:bg-sunk rounded-control flex min-h-11 items-start gap-2.5 px-2 py-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  name="employmentIds"
                                  value={p.id}
                                  disabled={p.open}
                                  className="mt-0.5 size-4 accent-violet-600"
                                />
                                <span className="min-w-0">
                                  <span className={p.open ? 'text-muted block' : 'text-ink block'}>
                                    {p.name}
                                  </span>
                                  <span className="text-muted block text-xs">
                                    {[p.roles, p.existing].filter(Boolean).join(' · ') ||
                                      'Not assigned yet'}
                                  </span>
                                </span>
                              </label>
                            ))
                          )}
                          {state.fieldErrors?.people?.[0] ? (
                            <p role="alert" className="text-danger text-xs font-medium">
                              {state.fieldErrors.people[0]}
                            </p>
                          ) : null}
                        </fieldset>
                        <Field
                          id="assign-role"
                          label="And everyone who is a…"
                          hint="Adds everyone at this location with that job role."
                          error={state.fieldErrors?.jobRoleId?.[0]}
                        >
                          {(p) => (
                            <select
                              {...p}
                              name="jobRoleId"
                              defaultValue=""
                              className={SELECT_CLASS}
                            >
                              <option value="">Nobody else</option>
                              {assignable.jobRoles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name} ({r.count})
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Field
                          id="assign-due"
                          label="Due date"
                          hint="Optional."
                          error={state.fieldErrors?.dueOn?.[0]}
                        >
                          {(p) => <Input {...p} name="dueOn" type="date" min={today} />}
                        </Field>
                        <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
                          <legend className="text-ink mb-1 text-sm font-medium">
                            Is it required?
                          </legend>
                          <label className="flex min-h-11 items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="required"
                              value="required"
                              defaultChecked
                              className="size-4 accent-violet-600"
                            />
                            Required
                          </label>
                          <label className="flex min-h-11 items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="required"
                              value="optional"
                              className="size-4 accent-violet-600"
                            />
                            Optional
                          </label>
                        </fieldset>
                        <Field
                          id="assign-note"
                          label="Note for them"
                          hint="Optional. Shown with the course."
                        >
                          {(p) => (
                            <textarea
                              {...p}
                              name="note"
                              rows={2}
                              maxLength={500}
                              className={TEXTAREA_CLASS}
                            />
                          )}
                        </Field>
                      </>
                    )}
                  </ActionForm>
                ) : null}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
