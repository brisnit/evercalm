'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  archiveTemplateAction,
  createTemplateAction,
  updateTemplateAction,
} from '@/modules/scheduling/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Card, CardHeader, EmptyState, Field, Input } from '@/ui/primitives'
import { SELECT_CLASS } from '../_components/add-shift-form'

interface Template {
  id: string
  name: string
  jobRoleId: string | null
  jobRoleName: string | null
  stationId: string | null
  stationName: string | null
  startTime: string
  endTime: string
  breakMinutes: number
  daysOfWeek: number[]
  headcount: number
  notes: string
}

const DAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
]

export function TemplatesManager({
  locations,
  locationId,
  canManage,
  templates,
  jobRoles,
  stations,
}: {
  locations: { id: string; name: string }[]
  locationId: string
  canManage: boolean
  templates: Template[]
  jobRoles: { id: string; name: string }[]
  stations: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { notice, show, dismiss } = useActionNotice()
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-5">
      {locations.length > 1 ? (
        <div className="rounded-card border-line bg-raise flex flex-wrap items-end gap-3 border p-3">
          <div className="flex min-w-44 flex-col gap-1.5">
            <label htmlFor="templates-location" className="text-muted text-xs font-medium">
              Location
            </label>
            <select
              id="templates-location"
              value={locationId}
              onChange={(e) =>
                startTransition(() =>
                  router.push(`/app/schedule/templates?location=${e.target.value}`),
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
        </div>
      ) : null}

      <ActionNotice notice={notice} onDismiss={dismiss} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start [&>*]:min-w-0">
        <div className="flex flex-col gap-3">
          {templates.length === 0 ? (
            <EmptyState
              title="No templates yet"
              description="Create one for each shift pattern you repeat."
            />
          ) : (
            templates.map((t) => (
              <Card key={t.id}>
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="font-display text-ink text-base font-bold">{t.name}</h2>
                    <p className="text-ink text-sm tabular-nums">
                      {t.startTime}–{t.endTime}
                      {t.endTime <= t.startTime ? ' (ends next day)' : ''}
                      {t.breakMinutes > 0 ? ` · ${t.breakMinutes} min break` : ''}
                    </p>
                    <p className="text-muted text-sm">
                      {[t.jobRoleName, t.stationName].filter(Boolean).join(' · ') || 'Any role'} ·{' '}
                      {t.headcount} {t.headcount === 1 ? 'person' : 'people'} ·{' '}
                      {t.daysOfWeek.length === 0
                        ? 'no fixed days'
                        : DAYS.filter((d) => t.daysOfWeek.includes(d.value))
                            .map((d) => d.short)
                            .join(', ')}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-expanded={editing === t.id}
                        onClick={() => setEditing(editing === t.id ? null : t.id)}
                        className="rounded-control border-line-strong text-ink hover:bg-sunk min-h-9 border bg-white px-3 text-sm font-medium"
                      >
                        {editing === t.id ? 'Close' : 'Edit'}
                      </button>
                      <ConfirmAction
                        triggerLabel="Archive"
                        title={`Archive “${t.name}”?`}
                        description="It stops being offered for new shifts. Shifts already made from it stay as they are."
                      >
                        <ActionForm
                          action={archiveTemplateAction}
                          submitLabel="Archive it"
                          destructive
                          onSuccess={show}
                        >
                          <input type="hidden" name="templateId" value={t.id} />
                        </ActionForm>
                      </ConfirmAction>
                    </div>
                  ) : null}
                </div>
                {editing === t.id ? (
                  <div className="border-line border-t p-5">
                    <TemplateForm
                      idPrefix={`edit-${t.id}`}
                      template={t}
                      hidden={{ templateId: t.id }}
                      jobRoles={jobRoles}
                      stations={stations}
                      onSuccess={(state) => {
                        show(state)
                        setEditing(null)
                      }}
                    />
                  </div>
                ) : null}
              </Card>
            ))
          )}
        </div>

        {canManage ? (
          <Card>
            <CardHeader title="New template" />
            <div className="p-5">
              <TemplateForm
                idPrefix="new"
                hidden={{ locationId }}
                jobRoles={jobRoles}
                stations={stations}
                onSuccess={show}
              />
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function TemplateForm({
  idPrefix,
  template,
  hidden,
  jobRoles,
  stations,
  onSuccess,
}: {
  idPrefix: string
  template?: Template
  hidden: Record<string, string>
  jobRoles: { id: string; name: string }[]
  stations: { id: string; name: string }[]
  onSuccess: Parameters<typeof ActionForm>[0]['onSuccess']
}) {
  return (
    <ActionForm
      action={template ? updateTemplateAction : createTemplateAction}
      submitLabel={template ? 'Save template' : 'Create template'}
      onSuccess={onSuccess}
    >
      {(state) => (
        <>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <Field id={`${idPrefix}-name`} label="Name" required error={state.fieldErrors?.name?.[0]}>
            {(p) => (
              <Input
                {...p}
                name="name"
                required
                maxLength={80}
                defaultValue={template?.name}
                placeholder="e.g. Closing shift"
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              id={`${idPrefix}-start`}
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
                  defaultValue={template?.startTime ?? '09:00'}
                />
              )}
            </Field>
            <Field
              id={`${idPrefix}-end`}
              label="Ends"
              required
              error={state.fieldErrors?.endTime?.[0]}
            >
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  name="endTime"
                  required
                  defaultValue={template?.endTime ?? '17:00'}
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              id={`${idPrefix}-break`}
              label="Break (min)"
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
                  defaultValue={template?.breakMinutes ?? 0}
                />
              )}
            </Field>
            <Field
              id={`${idPrefix}-headcount`}
              label="People"
              error={state.fieldErrors?.headcount?.[0]}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  name="headcount"
                  min={1}
                  max={20}
                  defaultValue={template?.headcount ?? 1}
                />
              )}
            </Field>
          </div>
          <fieldset className="border-0 p-0">
            <legend className="text-ink text-sm font-medium">Days it normally runs</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <label
                  key={d.value}
                  className="border-line-strong rounded-control flex min-h-11 items-center gap-2 border bg-white px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    name="days"
                    value={d.value}
                    defaultChecked={template?.daysOfWeek.includes(d.value)}
                    className="h-4 w-4"
                  />
                  <span aria-hidden="true">{d.short}</span>
                  <span className="sr-only">{d.long}</span>
                </label>
              ))}
            </div>
            {state.fieldErrors?.daysOfWeek?.[0] ? (
              <p role="alert" className="text-danger mt-1 text-xs font-medium">
                {state.fieldErrors.daysOfWeek[0]}
              </p>
            ) : null}
          </fieldset>
          <Field id={`${idPrefix}-role`} label="Job role" error={state.fieldErrors?.jobRoleId?.[0]}>
            {(p) => (
              <select
                {...p}
                name="jobRoleId"
                defaultValue={template?.jobRoleId ?? ''}
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
              id={`${idPrefix}-station`}
              label="Station"
              error={state.fieldErrors?.stationId?.[0]}
            >
              {(p) => (
                <select
                  {...p}
                  name="stationId"
                  defaultValue={template?.stationId ?? ''}
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
          <Field id={`${idPrefix}-notes`} label="Notes for whoever works it">
            {(p) => <Input {...p} name="notes" maxLength={500} defaultValue={template?.notes} />}
          </Field>
        </>
      )}
    </ActionForm>
  )
}
