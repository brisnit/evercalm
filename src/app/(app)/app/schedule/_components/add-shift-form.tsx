'use client'

import { useState } from 'react'
import { createShiftAction } from '@/modules/scheduling/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { Field, Input } from '@/ui/primitives'

export const SELECT_CLASS =
  'rounded-control border-line-strong text-ink hover:border-faint min-h-11 w-full border bg-white px-3 text-sm focus:border-teal-600 aria-[invalid=true]:border-danger'

interface TemplateOption {
  id: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  jobRoleId: string | null
  stationId: string | null
  notes: string
}

/**
 * Add one shift. Choosing a template fills in its times, role, station and
 * notes, which stay editable - a template is a starting point, not a lock.
 */
export function AddShiftForm({
  locationId,
  days,
  defaultDate,
  templates,
  jobRoles,
  stations,
  people,
}: {
  locationId: string
  days: { date: string; label: string }[]
  /** The day chosen from the week board, preselected. */
  defaultDate?: string
  templates: TemplateOption[]
  jobRoles: { id: string; name: string }[]
  stations: { id: string; name: string }[]
  people: { employmentId: string; label: string }[]
}) {
  const [templateId, setTemplateId] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [breakMinutes, setBreakMinutes] = useState('0')
  const [jobRoleId, setJobRoleId] = useState('')
  const [stationId, setStationId] = useState('')
  const [notes, setNotes] = useState('')

  function chooseTemplate(id: string) {
    setTemplateId(id)
    const template = templates.find((t) => t.id === id)
    if (!template) return
    setStartTime(template.startTime)
    setEndTime(template.endTime)
    setBreakMinutes(String(template.breakMinutes))
    setJobRoleId(template.jobRoleId ?? '')
    setStationId(template.stationId ?? '')
    setNotes(template.notes)
  }

  return (
    <ActionForm action={createShiftAction} submitLabel="Add shift">
      {(state) => (
        <>
          <input type="hidden" name="locationId" value={locationId} />

          {templates.length > 0 ? (
            <Field id="add-template" label="Template">
              {(p) => (
                <select
                  {...p}
                  name="templateId"
                  value={templateId}
                  onChange={(e) => chooseTemplate(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.startTime}–{t.endTime})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}

          <Field id="add-date" label="Day" required error={state.fieldErrors?.date?.[0]}>
            {(p) => (
              <select
                {...p}
                name="date"
                defaultValue={defaultDate ?? days[0]?.date}
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
            <Field id="add-start" label="Starts" required error={state.fieldErrors?.startTime?.[0]}>
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  name="startTime"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              )}
            </Field>
            <Field
              id="add-end"
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
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field
            id="add-break"
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
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            )}
          </Field>

          <Field id="add-role" label="Job role" error={state.fieldErrors?.jobRoleId?.[0]}>
            {(p) => (
              <select
                {...p}
                name="jobRoleId"
                value={jobRoleId}
                onChange={(e) => setJobRoleId(e.target.value)}
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
            <Field id="add-station" label="Station" error={state.fieldErrors?.stationId?.[0]}>
              {(p) => (
                <select
                  {...p}
                  name="stationId"
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value)}
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

          <Field
            id="add-assignee"
            label="Who"
            hint="Leave empty to fill later. Anyone who cannot work it is refused with the reason."
            error={state.fieldErrors?.assigneeEmploymentId?.[0]}
          >
            {(p) => (
              <select {...p} name="assigneeEmploymentId" defaultValue="" className={SELECT_CLASS}>
                <option value="">Nobody yet</option>
                {people.map((person) => (
                  <option key={person.employmentId} value={person.employmentId}>
                    {person.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="add-notes" label="Notes">
            {(p) => (
              <Input
                {...p}
                name="notes"
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
    </ActionForm>
  )
}
