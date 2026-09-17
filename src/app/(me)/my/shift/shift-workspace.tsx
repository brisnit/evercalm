'use client'

import { Fragment } from 'react'
import {
  blockTaskAction,
  completeHandoffTaskAction,
  completeTaskAction,
  createHandoffAction,
  skipTaskAction,
  undoTaskAction,
  unblockTaskAction,
} from '@/modules/operations/actions'
import type { HandoffView } from '@/modules/operations/handoffs'
import type { ItemState, Progress, ShiftPhase } from '@/modules/operations/rules'
import { cn } from '@/lib/cn'
import { HandoffCard } from '@/ui/patterns/handoff-card'
import { HandoffTaskFields } from '@/ui/patterns/handoff-task-fields'
import { MiniForm } from '@/ui/patterns/mini-form'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import {
  Badge,
  Card,
  Disclosure,
  Field,
  Input,
  ProgressBar,
  TextLink,
  Textarea,
} from '@/ui/primitives'

export interface TaskCardData {
  id: string
  revision: number
  title: string
  instructions: string
  context: string
  required: boolean
  responseType: string
  requiresVerification: boolean
  shared: boolean
  state: ItemState
  stateLabel: string
  stateTone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
  dueLabel: string
  reason: string
  returnedNote: string
  responseText: string
  responseNumber: string | null
  doneLine: string | null
  assignedLine: string | null
  reassignedLine: string | null
  canAct: boolean
  canUndo: boolean
}

interface Props {
  shift: {
    id: string
    locationId: string
    eyebrow: string
    day: string
    time: string
    phase: ShiftPhase
    phaseLine: string
  }
  isOpen: boolean
  opensLine: string
  progress: Progress
  sections: { key: string; title: string; description: string | null; items: TaskCardData[] }[]
  done: TaskCardData[]
  teamTasks: TaskCardData[]
  handedOver: { id: string; title: string; to: string }[]
  handoffs: HandoffView[]
  /** People at this location a handoff can be assigned to. */
  assignees: { id: string; name: string }[]
  nextShiftId: string | null
  timingHint: string
}

export function ShiftWorkspace(props: Props) {
  const { shift, progress, sections } = props
  const visible = sections.filter((s) => s.items.length > 0)
  const finished = progress.total > 0 && progress.open === 0 && progress.waiting === 0
  const openHandoffs = props.handoffs.filter((h) => h.status === 'open')
  // One primary action on the page: the first thing that can be done.
  const leadId =
    visible
      .flatMap((sec) => sec.items)
      .find((t) => t.canAct && !['done', 'skipped', 'waiting', 'cancelled'].includes(t.state))
      ?.id ?? null
  const handoffsIn =
    openHandoffs.length > 0 ? (
      <section aria-labelledby="handoffs-in" className="mt-6">
        <h2 id="handoffs-in" className="font-display text-ink text-lg font-bold">
          From earlier shifts
        </h2>
        <p className="text-muted text-sm">Read these before you start.</p>
        <div className="mt-3 flex flex-col gap-3">
          {openHandoffs.map((h) => (
            <HandoffCard key={h.id} handoff={h} />
          ))}
        </div>
      </section>
    ) : null

  return (
    <NoticeProvider>
      <header>
        <p className="text-muted text-sm font-medium">{shift.eyebrow}</p>
        <h1 className="font-display text-ink text-[1.625rem] leading-tight font-extrabold tracking-tight">
          {shift.day}
        </h1>
        <p className="text-ink mt-0.5 text-base font-semibold tabular-nums">{shift.time}</p>
        <p
          className={cn(
            'mt-1 text-sm font-medium',
            shift.phase === 'during' ? 'text-teal-700' : 'text-muted',
          )}
        >
          {shift.phaseLine}
        </p>
      </header>

      <Card className="mt-5 p-4">
        <ProgressBar
          value={progress.percent}
          tone={finished ? 'success' : 'accent'}
          label={`${progress.done + progress.skipped} of ${progress.total} finished`}
        />
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Where things stand">
          {progress.overdue + progress.blocked + progress.returned > 0 ? (
            <li>
              <Badge tone="danger">
                {progress.overdue + progress.blocked + progress.returned}{' '}
                {progress.overdue + progress.blocked + progress.returned === 1 ? 'needs' : 'need'}{' '}
                attention
              </Badge>
            </li>
          ) : null}
          {progress.waiting > 0 ? (
            <li>
              <Badge tone="accent">{progress.waiting} waiting for a manager</Badge>
            </li>
          ) : null}
          <li>
            <Badge tone="neutral">{progress.open} still to do</Badge>
          </li>
        </ul>
        {!props.isOpen ? <p className="text-muted mt-3 text-sm">{props.opensLine}</p> : null}
      </Card>

      {finished ? (
        <Card className="border-success/30 bg-success-soft/40 mt-4 p-4">
          <p className="text-success font-semibold">
            Everything on this shift is finished. Nice work.
          </p>
          <p className="text-muted mt-1 text-sm">
            {props.nextShiftId ? (
              <TextLink href={`/my/shift?shift=${props.nextShiftId}`}>See your next shift</TextLink>
            ) : (
              'Nothing else is waiting for you.'
            )}
          </p>
        </Card>
      ) : null}

      {visible.map((section, index) => (
        <Fragment key={section.key}>
          <section aria-labelledby={`section-${section.key}`} className="mt-7">
            <h2 id={`section-${section.key}`} className="font-display text-ink text-lg font-bold">
              {section.title}{' '}
              <span className="text-faint text-sm font-medium">({section.items.length})</span>
            </h2>
            {section.description ? (
              <p className="text-muted text-sm">{section.description}</p>
            ) : null}
            <ol className="mt-3 flex flex-col gap-3">
              {section.items.map((task) => (
                <li key={task.id}>
                  <TaskCard task={task} assignees={props.assignees} lead={task.id === leadId} />
                </li>
              ))}
            </ol>
          </section>
          {/* Notes from earlier shifts come after what is urgent, before the rest. */}
          {index === (visible[0]?.key === 'now' ? 0 : -1) ? handoffsIn : null}
        </Fragment>
      ))}
      {visible[0]?.key !== 'now' ? handoffsIn : null}

      {progress.total === 0 ? (
        <p className="text-muted mt-6 text-sm">No duties are attached to this shift.</p>
      ) : null}

      {props.done.length > 0 ? (
        <section aria-labelledby="section-done" className="mt-7">
          <h2 id="section-done" className="sr-only">
            Finished
          </h2>
          <Disclosure label="Finished" count={props.done.length}>
            <ol className="flex flex-col gap-3 pt-2">
              {props.done.map((task) => (
                <li key={task.id}>
                  <TaskCard task={task} assignees={props.assignees} />
                </li>
              ))}
            </ol>
          </Disclosure>
        </section>
      ) : null}

      {props.teamTasks.length > 0 ? (
        <section aria-labelledby="section-team" className="mt-4">
          <h2 id="section-team" className="sr-only">
            Shared tasks
          </h2>
          <Disclosure label="Shared tasks you can help with" count={props.teamTasks.length}>
            <p className="text-muted pt-1 text-sm">Anyone on shift here today can finish these.</p>
            <ol className="flex flex-col gap-3 pt-2">
              {props.teamTasks.map((task) => (
                <li key={task.id}>
                  <TaskCard task={task} assignees={props.assignees} />
                </li>
              ))}
            </ol>
          </Disclosure>
        </section>
      ) : null}

      {props.handedOver.length > 0 ? (
        <section aria-labelledby="section-handed" className="mt-4">
          <h2 id="section-handed" className="font-display text-ink text-base font-bold">
            Handed to someone else
          </h2>
          <ul className="text-muted mt-2 flex flex-col gap-1 text-sm">
            {props.handedOver.map((t) => (
              <li key={t.id}>
                {t.title} <span className="text-faint">· now {t.to}’s</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="leave-handoff" className="mt-8">
        <h2 id="leave-handoff" className="sr-only">
          Leave a handoff
        </h2>
        <Disclosure label="Leave a handoff for the next shift">
          <p className="text-muted pt-1 text-sm">
            A task for the next shift, or for one person who works here.
          </p>
          <MiniForm
            action={createHandoffAction}
            hidden={{ shiftId: shift.id, locationId: shift.locationId }}
            submitLabel="Leave handoff"
            fullWidth
            className="mt-3"
          >
            {(state) => (
              <HandoffTaskFields
                prefix="new"
                assignees={props.assignees}
                errors={state.fieldErrors}
              />
            )}
          </MiniForm>
        </Disclosure>
      </section>

      {props.handoffs.some((h) => h.status === 'resolved') ? (
        <section aria-labelledby="handoffs-resolved" className="mt-6">
          <h2 id="handoffs-resolved" className="sr-only">
            Recently resolved handoffs
          </h2>
          <Disclosure
            label="Recently resolved"
            count={props.handoffs.filter((h) => h.status === 'resolved').length}
          >
            <div className="flex flex-col gap-3 pt-2">
              {props.handoffs
                .filter((h) => h.status === 'resolved')
                .map((h) => (
                  <HandoffCard key={h.id} handoff={h} allowAcknowledge={false} />
                ))}
            </div>
          </Disclosure>
        </section>
      ) : null}
    </NoticeProvider>
  )
}

function TaskCard({
  task,
  assignees,
  lead = false,
}: {
  task: TaskCardData
  assignees: { id: string; name: string }[]
  /** The single task whose button is the page's primary action. */
  lead?: boolean
}) {
  const open = !['done', 'skipped', 'waiting', 'cancelled'].includes(task.state)
  const hidden = { itemId: task.id, revision: task.revision }
  const attention =
    task.state === 'overdue' || task.state === 'blocked' || task.state === 'returned'

  return (
    <article
      aria-label={task.title}
      className={cn(
        'rounded-card border bg-white p-4',
        attention ? 'border-warning/40' : 'border-line',
        !open && 'bg-raise',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className={cn(
              'text-ink font-semibold text-balance',
              task.state === 'done' && 'text-muted',
            )}
          >
            {task.title}
          </h3>
          <p className="text-muted mt-0.5 text-xs">
            Due {task.dueLabel}
            {task.context ? ` · ${task.context}` : ''}
          </p>
        </div>
        <Badge tone={task.stateTone} className="shrink-0">
          {task.stateLabel}
        </Badge>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="About this task">
        <li className="text-muted">{task.required ? 'Required' : 'Optional'}</li>
        {task.requiresVerification ? <li className="text-muted">· A manager checks this</li> : null}
        {task.shared ? <li className="text-muted">· Shared</li> : null}
        {task.assignedLine ? <li className="text-muted">· {task.assignedLine}</li> : null}
        {task.reassignedLine ? <li className="text-muted">· {task.reassignedLine}</li> : null}
      </ul>

      {task.state === 'returned' ? (
        <p className="rounded-control bg-warning-soft text-ink mt-3 px-3 py-2 text-sm">
          <span className="text-warning font-semibold">Sent back:</span> {task.returnedNote}
        </p>
      ) : null}
      {task.state === 'blocked' ? (
        <p className="rounded-control bg-warning-soft text-ink mt-3 px-3 py-2 text-sm">
          <span className="text-warning font-semibold">Blocked:</span> {task.reason}
        </p>
      ) : null}
      {task.state === 'skipped' && task.reason ? (
        <p className="text-muted mt-2 text-sm">Reason: {task.reason}</p>
      ) : null}
      {task.responseText && !open ? (
        <p className="text-ink mt-2 text-sm">“{task.responseText}”</p>
      ) : null}
      {task.responseNumber && !open ? (
        <p className="text-ink mt-2 text-sm tabular-nums">
          Recorded: {Number(task.responseNumber)}
        </p>
      ) : null}
      {task.doneLine ? <p className="text-muted mt-2 text-xs">{task.doneLine}</p> : null}

      {task.instructions ? (
        <Disclosure label="How to do it" className="mt-3">
          <p className="text-ink/85 text-sm whitespace-pre-line">{task.instructions}</p>
        </Disclosure>
      ) : null}

      {open && task.canAct ? (
        <div className="mt-3 flex flex-col gap-2">
          {task.responseType === 'handoff' ? (
            <>
              <MiniForm
                action={completeHandoffTaskAction}
                hidden={hidden}
                submitLabel="Save handoff"
                variant={lead ? 'primary' : 'secondary'}
                size={lead ? 'lg' : 'md'}
                fullWidth
              >
                {(state) => (
                  <HandoffTaskFields
                    prefix={`task-${task.id}`}
                    assignees={assignees}
                    errors={state.fieldErrors}
                  />
                )}
              </MiniForm>
              <MiniForm
                action={completeHandoffTaskAction}
                hidden={{
                  ...hidden,
                  nothing: 'yes',
                  category: 'follow_up',
                  title: '-',
                  priority: 'normal',
                  body: '',
                }}
                submitLabel="Nothing to hand over"
                fullWidth
              />
            </>
          ) : (
            <MiniForm
              action={completeTaskAction}
              hidden={hidden}
              submitLabel={task.requiresVerification ? 'Done – send to a manager' : 'Mark done'}
              variant={lead ? 'primary' : 'secondary'}
              size={lead ? 'lg' : 'md'}
              fullWidth
            >
              {(state) =>
                task.responseType === 'text' ? (
                  <Field
                    id={`text-${task.id}`}
                    label="Your note"
                    required
                    error={state.fieldErrors?.response?.[0]}
                  >
                    {(p) => (
                      <Textarea {...p} name="responseText" rows={2} maxLength={500} required />
                    )}
                  </Field>
                ) : task.responseType === 'number' ? (
                  <Field
                    id={`number-${task.id}`}
                    label="Reading or count"
                    required
                    error={state.fieldErrors?.response?.[0]}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        name="responseNumber"
                        inputMode="decimal"
                        required
                        autoComplete="off"
                        className="text-base sm:text-sm"
                      />
                    )}
                  </Field>
                ) : null
              }
            </MiniForm>
          )}

          {task.state === 'blocked' ? (
            <MiniForm
              action={unblockTaskAction}
              hidden={hidden}
              submitLabel="It’s not blocked any more"
              fullWidth
            />
          ) : (
            <Disclosure label="Can’t do it?" className="border-transparent">
              <div className="flex flex-col gap-4 pt-2">
                <MiniForm
                  action={blockTaskAction}
                  hidden={hidden}
                  submitLabel="Mark blocked"
                  fullWidth
                >
                  {(state) => (
                    <Field
                      id={`block-${task.id}`}
                      label="What’s stopping you"
                      hint="Your manager sees this straight away."
                      required
                      error={state.fieldErrors?.reason?.[0]}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          name="reason"
                          maxLength={300}
                          required
                          autoComplete="off"
                          className="text-base sm:text-sm"
                        />
                      )}
                    </Field>
                  )}
                </MiniForm>
                <MiniForm
                  action={skipTaskAction}
                  hidden={hidden}
                  submitLabel="Skip this task"
                  fullWidth
                >
                  {(state) => (
                    <Field
                      id={`skip-${task.id}`}
                      label="Why it’s being skipped"
                      required
                      error={state.fieldErrors?.reason?.[0]}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          name="reason"
                          maxLength={300}
                          required
                          autoComplete="off"
                          className="text-base sm:text-sm"
                        />
                      )}
                    </Field>
                  )}
                </MiniForm>
              </div>
            </Disclosure>
          )}
        </div>
      ) : null}

      {!open && task.canUndo ? (
        <MiniForm
          action={undoTaskAction}
          hidden={hidden}
          submitLabel="Undo"
          variant="ghost"
          className="mt-2"
        />
      ) : null}
    </article>
  )
}
