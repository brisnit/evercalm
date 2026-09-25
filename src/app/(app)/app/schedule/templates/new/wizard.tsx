'use client'

import { useActionState, useState } from 'react'
import { createTemplateSetAction } from '@/modules/scheduling/slotted-actions'
import type { SlottedActionState } from '@/modules/scheduling/slotted-actions'
import { Button, Card, CardHeader, Field, Input, Select } from '@/ui/primitives'
import { cn } from '@/lib/cn'

const IDLE: SlottedActionState = { status: 'idle' }

const DAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
]

interface Pattern {
  key: number
  name: string
  roleId: string
  start: string
  end: string
  headcount: number
  days: number[]
}

/**
 * The template wizard: four steps, one decision each.
 *
 * Setup is a wizard rather than a settings page because a manager doing this
 * for the first time should never have to guess which field matters. Every
 * step keeps the earlier answers visible in the summary, and nothing is saved
 * until the last one — so backing out costs nothing.
 */
export function TemplateWizard({
  locationId,
  roles,
}: {
  locationId: string
  roles: { id: string; name: string }[]
}) {
  const [step, setStep] = useState(1)
  const [openDays, setOpenDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [patterns, setPatterns] = useState<Pattern[]>([
    {
      key: 1,
      name: 'Day',
      roleId: roles[0]?.id ?? '',
      start: '08:00',
      end: '16:00',
      headcount: 2,
      days: [1, 2, 3, 4, 5],
    },
  ])
  const [state, formAction, pending] = useActionState(createTemplateSetAction, IDLE)

  const toggleDay = (day: number) =>
    setOpenDays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
    )

  const slots = patterns.reduce(
    (total, pattern) =>
      total + pattern.days.filter((d) => openDays.includes(d)).length * pattern.headcount,
    0,
  )
  const weeklyHours = patterns.reduce((total, pattern) => {
    const [sh, sm] = pattern.start.split(':').map(Number)
    const [eh, em] = pattern.end.split(':').map(Number)
    const startMin = (sh ?? 0) * 60 + (sm ?? 0)
    const endMin = (eh ?? 0) * 60 + (em ?? 0)
    const length = endMin > startMin ? endMin - startMin : 1440 - startMin + endMin
    return (
      total +
      (pattern.days.filter((d) => openDays.includes(d)).length * pattern.headcount * length) / 60
    )
  }, 0)

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="locationId" value={locationId} />
      {openDays.map((day) => (
        <input key={day} type="hidden" name="openDays" value={day} />
      ))}
      {patterns.map((pattern) => (
        <div key={pattern.key}>
          <input type="hidden" name="patternName" value={pattern.name} />
          <input type="hidden" name="patternRole" value={pattern.roleId} />
          <input type="hidden" name="patternStart" value={pattern.start} />
          <input type="hidden" name="patternEnd" value={pattern.end} />
          <input type="hidden" name="patternHeadcount" value={pattern.headcount} />
          <input type="hidden" name="patternDays" value={pattern.days.join(',')} />
        </div>
      ))}

      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {['Open days', 'Staffing', 'Breaks', 'Name it'].map((label, index) => {
          const number = index + 1
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(number)}
                aria-current={step === number ? 'step' : undefined}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                  step === number
                    ? 'bg-band border-band text-white'
                    : 'border-line text-muted hover:text-ink bg-white',
                )}
              >
                <span className="tabular-nums">{number}</span>
                <span className="ms-1.5">{label}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {step === 1 ? (
        <Card>
          <CardHeader
            title="Which days are you open?"
            description="Tap a day to open or close it. A closed day never gets a schedule."
          />
          <ul className="flex flex-col gap-2 p-5">
            {DAYS.map((day) => {
              const open = openDays.includes(day.value)
              return (
                <li key={day.value}>
                  <button
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    aria-pressed={open}
                    className={cn(
                      'rounded-control flex min-h-12 w-full items-center justify-between border px-4 text-start transition-colors',
                      open
                        ? 'border-success/30 bg-success-soft text-ink'
                        : 'border-line text-muted border-dashed bg-white',
                    )}
                  >
                    <span className="font-medium">{day.label}</span>
                    <span className="text-sm">{open ? 'Open' : 'Closed · no schedule'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="border-line flex items-center justify-between border-t px-5 py-4">
            <p className="text-muted text-sm">
              {openDays.length} open · {7 - openDays.length} closed. Change it any time.
            </p>
            <Button type="button" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader
            title="What staffing do you need?"
            description="You are creating slots, not assigning people. Choose who fills them later — or let autofill do it."
          />
          <ul className="flex flex-col gap-4 p-5">
            {patterns.map((pattern, index) => (
              <li key={pattern.key} className="border-line rounded-card border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id={`p-${pattern.key}-name`} label="What to call it">
                    {(p) => (
                      <Input
                        {...p}
                        value={pattern.name}
                        onChange={(event) =>
                          setPatterns((all) =>
                            all.map((x) =>
                              x.key === pattern.key ? { ...x, name: event.target.value } : x,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field id={`p-${pattern.key}-role`} label="Job role">
                    {(p) => (
                      <Select
                        {...p}
                        value={pattern.roleId}
                        onChange={(event) =>
                          setPatterns((all) =>
                            all.map((x) =>
                              x.key === pattern.key ? { ...x, roleId: event.target.value } : x,
                            ),
                          )
                        }
                      >
                        <option value="">Any role</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field id={`p-${pattern.key}-start`} label="Starts">
                    {(p) => (
                      <Input
                        {...p}
                        type="time"
                        value={pattern.start}
                        onChange={(event) =>
                          setPatterns((all) =>
                            all.map((x) =>
                              x.key === pattern.key ? { ...x, start: event.target.value } : x,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field id={`p-${pattern.key}-end`} label="Ends">
                    {(p) => (
                      <Input
                        {...p}
                        type="time"
                        value={pattern.end}
                        onChange={(event) =>
                          setPatterns((all) =>
                            all.map((x) =>
                              x.key === pattern.key ? { ...x, end: event.target.value } : x,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field id={`p-${pattern.key}-count`} label="People needed">
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        min={1}
                        max={20}
                        value={pattern.headcount}
                        onChange={(event) =>
                          setPatterns((all) =>
                            all.map((x) =>
                              x.key === pattern.key
                                ? { ...x, headcount: Number(event.target.value) || 1 }
                                : x,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                </div>
                <fieldset className="mt-4">
                  <legend className="text-muted mb-2 text-sm font-medium">Which days</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.filter((day) => openDays.includes(day.value)).map((day) => {
                      const on = pattern.days.includes(day.value)
                      return (
                        <button
                          key={day.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setPatterns((all) =>
                              all.map((x) =>
                                x.key === pattern.key
                                  ? {
                                      ...x,
                                      days: on
                                        ? x.days.filter((d) => d !== day.value)
                                        : [...x.days, day.value].sort(),
                                    }
                                  : x,
                              ),
                            )
                          }
                          className={cn(
                            'min-h-9 rounded-full border px-3 text-sm font-medium transition-colors',
                            on
                              ? 'bg-band border-band text-white'
                              : 'border-line text-muted hover:text-ink bg-white',
                          )}
                        >
                          {day.short}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                {patterns.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => setPatterns((all) => all.filter((x) => x.key !== pattern.key))}
                  >
                    Remove this shift
                  </Button>
                ) : null}
                <p className="sr-only">Shift {index + 1}</p>
              </li>
            ))}
          </ul>
          <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setPatterns((all) => [
                  ...all,
                  {
                    key: Math.max(0, ...all.map((x) => x.key)) + 1,
                    name: 'Evening',
                    roleId: roles[0]?.id ?? '',
                    start: '16:00',
                    end: '22:00',
                    headcount: 2,
                    days: openDays,
                  },
                ])
              }
            >
              Add a shift
            </Button>
            <p className="text-muted text-sm">
              {slots} slots · {Math.round(weeklyHours)} staff hours a week
            </p>
            <Button type="button" onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader
            title="Breaks, handled"
            description="Set the rules once. Every shift this template generates carries them, and nobody has to remember."
          />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <Field id="mealMinutes" label="Meal break" hint="Minutes.">
              {(p) => (
                <Input
                  {...p}
                  name="mealMinutes"
                  type="number"
                  min={0}
                  max={120}
                  defaultValue={30}
                />
              )}
            </Field>
            <Field id="mealAfterMinutes" label="On shifts longer than" hint="Minutes worked.">
              {(p) => (
                <Input
                  {...p}
                  name="mealAfterMinutes"
                  type="number"
                  min={60}
                  max={720}
                  defaultValue={300}
                />
              )}
            </Field>
            <Field id="restMinutes" label="Rest break" hint="Minutes.">
              {(p) => (
                <Input {...p} name="restMinutes" type="number" min={0} max={60} defaultValue={10} />
              )}
            </Field>
            <Field id="restEveryMinutes" label="For every" hint="Minutes worked.">
              {(p) => (
                <Input
                  {...p}
                  name="restEveryMinutes"
                  type="number"
                  min={60}
                  max={480}
                  defaultValue={240}
                />
              )}
            </Field>
          </div>
          <div className="border-line border-t px-5 py-4">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="staggerBreaks"
                defaultChecked
                className="accent-action size-4"
              />
              <span>
                <span className="text-ink font-medium">Stagger within a role</span>
                <span className="text-muted block">
                  Never send everyone at once, so at least one person per role stays on the floor.
                </span>
              </span>
            </label>
          </div>
          <div className="border-line flex justify-end border-t px-5 py-4">
            <Button type="button" onClick={() => setStep(4)}>
              Continue
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader
            title="Name it, and you're set"
            description="Every new week can start from this. You will only pick people."
          />
          <div className="p-5">
            <dl className="border-line rounded-card mb-5 grid gap-3 border p-4 sm:grid-cols-3">
              <div>
                <dt className="text-muted text-xs tracking-wide uppercase">Open days</dt>
                <dd className="text-ink text-lg font-semibold tabular-nums">{openDays.length}</dd>
              </div>
              <div>
                <dt className="text-muted text-xs tracking-wide uppercase">Slots a week</dt>
                <dd className="text-ink text-lg font-semibold tabular-nums">{slots}</dd>
              </div>
              <div>
                <dt className="text-muted text-xs tracking-wide uppercase">Staff hours</dt>
                <dd className="text-ink text-lg font-semibold tabular-nums">
                  {Math.round(weeklyHours)}
                </dd>
              </div>
            </dl>

            <Field id="name" label="Name your template" error={state.fieldErrors?.name?.[0]}>
              {(p) => <Input {...p} name="name" placeholder="Standard week" maxLength={80} />}
            </Field>

            {state.status === 'error' && state.message ? (
              <p role="alert" className="text-danger mt-3 text-sm font-medium">
                {state.message}
              </p>
            ) : null}

            <Button type="submit" size="lg" loading={pending} className="mt-5 w-full sm:w-auto">
              Save template
            </Button>
          </div>
        </Card>
      ) : null}
    </form>
  )
}
