'use client'

import { useState } from 'react'
import {
  addAvailabilityExceptionAction,
  removeAvailabilityExceptionAction,
  saveAvailabilityAction,
} from '@/modules/scheduling/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { Card, CardHeader, Field, Input, Select } from '@/ui/primitives'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

interface WeeklyDay {
  weekday: number
  preference: string
  allDay: boolean
  start: string
  end: string
  extraWindows: number
}

export function AvailabilityPanel({
  today,
  weekly,
  exceptions,
}: {
  today: string
  weekly: WeeklyDay[]
  exceptions: { id: string; label: string; note: string }[]
}) {
  const { notice, show, dismiss } = useActionNotice()
  const [days, setDays] = useState(weekly)
  const [exceptionAllDay, setExceptionAllDay] = useState(true)
  const update = (weekday: number, patch: Partial<WeeklyDay>) =>
    setDays((current) => current.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)))

  return (
    <div className="mt-6 flex flex-col gap-5">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      <Card>
        <CardHeader
          title="Every week"
          description="One setting per day. Leave a day as “Any time” if you have no limits."
        />
        <div className="p-5">
          <ActionForm
            action={saveAvailabilityAction}
            submitLabel="Save weekly availability"
            onSuccess={show}
          >
            <ul className="flex flex-col gap-4">
              {days.map((day) => {
                const name = DAY_NAMES[day.weekday - 1]!
                const limited = day.preference !== 'none'
                return (
                  <li
                    key={day.weekday}
                    className="border-line border-b pb-4 last:border-b-0 last:pb-0"
                  >
                    <fieldset className="border-0 p-0">
                      <legend className="text-ink text-sm font-semibold">{name}</legend>
                      <div className="mt-2 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                        <div>
                          <label htmlFor={`d${day.weekday}-preference`} className="sr-only">
                            {name} availability
                          </label>
                          <Select
                            id={`d${day.weekday}-preference`}
                            name={`d${day.weekday}-preference`}
                            value={day.preference}
                            onChange={(e) => update(day.weekday, { preference: e.target.value })}
                          >
                            <option value="none">Any time</option>
                            <option value="unavailable">Can’t work</option>
                            <option value="preferred">Prefer to work</option>
                          </Select>
                        </div>
                        {limited ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name={`d${day.weekday}-allDay`}
                                checked={day.allDay}
                                onChange={(e) => update(day.weekday, { allDay: e.target.checked })}
                                className="h-4 w-4"
                              />
                              All day
                            </label>
                            {!day.allDay ? (
                              <span className="flex items-center gap-2 text-sm">
                                <label htmlFor={`d${day.weekday}-start`} className="sr-only">
                                  {name} from
                                </label>
                                <Input
                                  id={`d${day.weekday}-start`}
                                  type="time"
                                  name={`d${day.weekday}-start`}
                                  value={day.start}
                                  onChange={(e) => update(day.weekday, { start: e.target.value })}
                                  className="w-32"
                                />
                                <span aria-hidden="true">to</span>
                                <label htmlFor={`d${day.weekday}-end`} className="sr-only">
                                  {name} until
                                </label>
                                <Input
                                  id={`d${day.weekday}-end`}
                                  type="time"
                                  name={`d${day.weekday}-end`}
                                  value={day.end}
                                  onChange={(e) => update(day.weekday, { end: e.target.value })}
                                  className="w-32"
                                />
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {day.extraWindows > 0 ? (
                        <p className="text-warning mt-1 text-xs">
                          You have {day.extraWindows} more{' '}
                          {day.extraWindows === 1 ? 'window' : 'windows'} on this day. Saving keeps
                          only the one shown.
                        </p>
                      ) : null}
                    </fieldset>
                  </li>
                )
              })}
            </ul>
          </ActionForm>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Just one date"
          description="A one-off change that overrides your weekly pattern for that day."
        />
        <div className="flex flex-col gap-4 p-5">
          {exceptions.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {exceptions.map((e) => (
                <li
                  key={e.id}
                  className="border-line flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0"
                >
                  <span className="text-ink text-sm">
                    {e.label}
                    {e.note ? <span className="text-muted"> · {e.note}</span> : null}
                  </span>
                  <ActionForm
                    action={removeAvailabilityExceptionAction}
                    submitLabel="Remove"
                    variant="ghost"
                    className="flex"
                    onSuccess={show}
                  >
                    <input type="hidden" name="exceptionId" value={e.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}

          <ActionForm
            action={addAvailabilityExceptionAction}
            submitLabel="Add date"
            variant="secondary"
            onSuccess={show}
          >
            {(state) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="ex-date" label="Date" required error={state.fieldErrors?.onDate?.[0]}>
                    {(p) => <Input {...p} type="date" name="onDate" required min={today} />}
                  </Field>
                  <Field id="ex-preference" label="That day" required>
                    {(p) => (
                      <Select {...p} name="preference" defaultValue="unavailable">
                        <option value="unavailable">I can’t work</option>
                        <option value="available">I can work after all</option>
                      </Select>
                    )}
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="allDay"
                    checked={exceptionAllDay}
                    onChange={(e) => setExceptionAllDay(e.target.checked)}
                    className="h-4 w-4"
                  />
                  All day
                </label>
                {!exceptionAllDay ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="ex-start" label="From" required>
                      {(p) => (
                        <Input {...p} type="time" name="startTime" required defaultValue="09:00" />
                      )}
                    </Field>
                    <Field
                      id="ex-end"
                      label="Until"
                      required
                      error={state.fieldErrors?.endTime?.[0]}
                    >
                      {(p) => (
                        <Input {...p} type="time" name="endTime" required defaultValue="17:00" />
                      )}
                    </Field>
                  </div>
                ) : null}
                <Field id="ex-note" label="Note (optional)">
                  {(p) => <Input {...p} name="note" maxLength={500} />}
                </Field>
              </>
            )}
          </ActionForm>
        </div>
      </Card>
    </div>
  )
}
