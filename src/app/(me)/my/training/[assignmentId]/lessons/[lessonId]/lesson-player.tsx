'use client'

import Link from 'next/link'
import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import {
  completeReadingAction,
  requestSignoffAction,
  saveChecklistAction,
  submitQuizAction,
  type TrainingActionState,
} from '@/modules/training/actions'
import type { ContentItem, LearnerQuestion, LessonKind } from '@/modules/training/content'
import type { QuizReviewItem } from '@/modules/training/learner'
import { cn } from '@/lib/cn'
import { Badge, Button } from '@/ui/primitives'
import { CheckMark } from '../../../_components/check-mark'

/**
 * Doing a lesson.
 *
 * Every action answers with a moment: what was just achieved, how far along
 * the course now is, and one button to the next thing. It is a quiet panel,
 * not a celebration - it takes focus so a screen reader announces it, and
 * its small entrance is skipped for anyone who prefers reduced motion.
 */

type Action = (previous: TrainingActionState, formData: FormData) => Promise<TrainingActionState>

interface Props {
  assignmentId: string
  lessonId: string
  kind: LessonKind
  state: string
  readOnly: boolean
  checklist: { items: ContentItem[]; checked: string[] } | null
  quiz: {
    questions: LearnerQuestion[]
    neededToPass: number
    attemptsAllowed: number | null
    attemptsUsed: number
    passed: boolean
    lastAttempt: { correctCount: number; questionCount: number } | null
    review: QuizReviewItem[] | null
  } | null
  practical: {
    criteria: ContentItem[]
    requestedLabel: string | null
    returned: { byName: string; dateLabel: string; note: string } | null
    verified: { byName: string; dateLabel: string } | null
  } | null
}

export function LessonPlayer(props: Props) {
  const [moment, setMoment] = useState<TrainingActionState | null>(null)
  const momentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (moment) momentRef.current?.focus()
  }, [moment])
  const onDone = useCallback((result: TrainingActionState) => setMoment(result), [])
  const common = { assignmentId: props.assignmentId, lessonId: props.lessonId, onDone }
  const completed = props.state === 'completed'

  return (
    <div className="mt-6 flex flex-col gap-4">
      {moment ? (
        <div
          ref={momentRef}
          tabIndex={-1}
          role="status"
          data-testid="lesson-moment"
          className={cn(
            'rounded-card border p-4 outline-none motion-safe:animate-[ec-rise_320ms_ease-out]',
            moment.courseComplete
              ? 'border-success/40 bg-success-soft'
              : 'border-success/30 bg-success-soft/60',
          )}
        >
          <div className="flex items-start gap-3">
            <CheckMark />
            <p className="text-ink font-medium">{moment.message}</p>
          </div>
          {moment.nextHref ? (
            <Link
              href={moment.nextHref}
              className="rounded-control mt-3 inline-flex min-h-12 w-full items-center justify-center bg-violet-600 px-4 text-base font-semibold text-white hover:bg-violet-700"
            >
              {moment.courseComplete ? 'See your finished course' : 'Next lesson'}
            </Link>
          ) : null}
        </div>
      ) : null}

      {props.kind === 'reading' ? (
        completed ? (
          moment ? null : (
            <Done text="You finished this lesson." />
          )
        ) : props.readOnly ? null : (
          <StepForm action={completeReadingAction} submitLabel="Mark as done" {...common} />
        )
      ) : null}

      {props.checklist ? (
        <Checklist
          {...common}
          checklist={props.checklist}
          locked={completed || props.readOnly}
          completed={completed}
        />
      ) : null}
      {props.quiz ? <Quiz {...common} quiz={props.quiz} readOnly={props.readOnly} /> : null}
      {props.practical ? (
        <Practical
          {...common}
          practical={props.practical}
          state={props.state}
          readOnly={props.readOnly}
        />
      ) : null}
    </div>
  )
}

function Done({ text }: { text: string }) {
  return (
    <p className="text-success flex items-center gap-2 font-semibold">
      <CheckMark className="size-5" />
      {text}
    </p>
  )
}

const IDLE: TrainingActionState = { status: 'idle' }

function StepForm({
  action,
  assignmentId,
  lessonId,
  submitLabel,
  onDone,
  children,
}: {
  action: Action
  assignmentId: string
  lessonId: string
  submitLabel: string
  onDone: (result: TrainingActionState) => void
  children?: React.ReactNode
}) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const run = useCallback(
    async (previous: TrainingActionState, formData: FormData) => {
      const result = await action(previous, formData)
      if (result.status === 'success') onDoneRef.current(result)
      return result
    },
    [action],
  )
  const [state, formAction, pending] = useActionState(run, IDLE)
  // A knowledge check that was not passed is an outcome, not a fault.
  const notYet = state.status === 'error' && state.message?.startsWith('Not yet')

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      {children}
      {state.status === 'error' && state.message ? (
        notYet ? (
          <p
            role="status"
            className="rounded-control border-warning/30 bg-warning-soft text-ink border px-4 py-3 text-sm"
          >
            {state.message}
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-control border-danger/30 bg-danger-soft text-danger border px-4 py-3 text-sm font-medium"
          >
            {state.message}
          </p>
        )
      ) : null}
      <Button type="submit" size="lg" loading={pending} className="w-full">
        {submitLabel}
      </Button>
    </form>
  )
}

function Checklist({
  checklist,
  locked,
  completed,
  ...common
}: {
  checklist: { items: ContentItem[]; checked: string[] }
  locked: boolean
  completed: boolean
  assignmentId: string
  lessonId: string
  onDone: (result: TrainingActionState) => void
}) {
  const [checked, setChecked] = useState(
    () => new Set(completed ? checklist.items.map((i) => i.id) : checklist.checked),
  )
  const all = checked.size === checklist.items.length

  const list = (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ink mb-2 text-sm font-semibold">Tick each step</legend>
      <ul className="flex flex-col gap-2">
        {checklist.items.map((item) => {
          const on = checked.has(item.id)
          return (
            <li key={item.id}>
              <label
                className={cn(
                  'rounded-control flex min-h-12 items-start gap-3 border px-3.5 py-3 text-[0.9375rem]',
                  on ? 'border-success/40 bg-success-soft/40' : 'border-line bg-white',
                )}
              >
                <input
                  type="checkbox"
                  name="items"
                  value={item.id}
                  checked={on}
                  disabled={locked}
                  onChange={(e) =>
                    setChecked((current) => {
                      const nextSet = new Set(current)
                      if (e.target.checked) nextSet.add(item.id)
                      else nextSet.delete(item.id)
                      return nextSet
                    })
                  }
                  className="mt-0.5 size-5 shrink-0 accent-violet-600"
                />
                <span className="text-ink">{item.text}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="text-muted text-sm" aria-live="polite">
        {checked.size} of {checklist.items.length} ticked
      </p>
    </fieldset>
  )

  if (locked) {
    return (
      <div className="flex flex-col gap-3">
        {list}
        {completed ? <Done text="Checklist complete." /> : null}
      </div>
    )
  }
  return (
    <StepForm
      action={saveChecklistAction}
      submitLabel={all ? 'Mark as done' : 'Save progress'}
      {...common}
    >
      {list}
    </StepForm>
  )
}

function Quiz({
  quiz,
  readOnly,
  ...common
}: {
  quiz: NonNullable<Props['quiz']>
  readOnly: boolean
  assignmentId: string
  lessonId: string
  onDone: (result: TrainingActionState) => void
}) {
  const count = quiz.questions.length
  if (quiz.passed) {
    return (
      <div className="flex flex-col gap-4">
        <Done
          text={`Passed${quiz.lastAttempt ? `: ${quiz.lastAttempt.correctCount} of ${quiz.lastAttempt.questionCount} correct` : ''}.`}
        />
        {quiz.review ? (
          <section aria-labelledby="answers-heading">
            <h2 id="answers-heading" className="font-display text-ink text-base font-bold">
              Your answers
            </h2>
            <ol className="mt-3 flex flex-col gap-3">
              {quiz.review.map((item, i) => (
                <li key={item.questionId} className="rounded-card border-line border bg-white p-4">
                  <p className="text-ink font-medium">
                    {i + 1}. {item.prompt}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {item.options.map((option) => {
                      const chosen = item.chosenOptionIds.includes(option.id)
                      const right = item.correctOptionIds?.includes(option.id) ?? false
                      return (
                        <li
                          key={option.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <span className={right ? 'text-ink font-medium' : 'text-muted'}>
                            {option.text}
                          </span>
                          <span className="flex gap-1.5">
                            {chosen ? <Badge tone="violet">Your answer</Badge> : null}
                            {right ? <Badge tone="success">Correct</Badge> : null}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  {item.explanation ? (
                    <p className="text-muted mt-2 text-sm">{item.explanation}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    )
  }

  const exhausted = quiz.attemptsAllowed !== null && quiz.attemptsUsed >= quiz.attemptsAllowed
  const last = new Map((quiz.review ?? []).map((r) => [r.questionId, r.correct]))
  const intro = (
    <div className="rounded-control border-line bg-raise border px-4 py-3 text-sm">
      <p className="text-ink">
        A pass needs {quiz.neededToPass} of {count} correct.{' '}
        {quiz.attemptsAllowed === null
          ? 'You can try as many times as you need.'
          : `Attempt ${Math.min(quiz.attemptsUsed + 1, quiz.attemptsAllowed)} of ${quiz.attemptsAllowed}.`}
      </p>
      {quiz.lastAttempt ? (
        <p className="text-muted mt-1">
          Last try: {quiz.lastAttempt.correctCount} of {quiz.lastAttempt.questionCount} correct.
        </p>
      ) : null}
    </div>
  )

  if (readOnly) return intro
  if (exhausted) {
    // The answer form is gone, so say here which questions the last try missed.
    // The correct answers stay hidden until a pass.
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <p className="rounded-card border-warning/30 bg-warning-soft text-ink border px-4 py-3 text-sm">
          You have used all your attempts. Talk to your manager: they can give you another one.
        </p>
        {quiz.review ? (
          <section aria-labelledby="last-try-heading">
            <h2 id="last-try-heading" className="text-ink text-sm font-semibold">
              Your last try
            </h2>
            <ol className="mt-2 flex flex-col gap-2">
              {quiz.review.map((item, i) => (
                <li
                  key={item.questionId}
                  className="rounded-control border-line flex flex-wrap items-start justify-between gap-2 border bg-white px-3.5 py-3 text-sm"
                >
                  <span className="text-ink min-w-0 flex-1">
                    {i + 1}. {item.prompt}
                  </span>
                  <Badge tone={item.correct ? 'success' : 'warning'}>
                    {item.correct ? 'Right' : 'Not quite'}
                  </Badge>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <StepForm action={submitQuizAction} submitLabel="Submit answers" {...common}>
      {intro}
      <ol className="flex flex-col gap-4">
        {quiz.questions.map((question, i) => (
          <li key={question.id} className="rounded-card border-line border bg-white p-4">
            <fieldset>
              <legend className="text-ink font-medium">
                {i + 1}. {question.prompt}
              </legend>
              {question.kind === 'multiple' ? (
                <p className="text-muted mt-0.5 text-xs">Choose all that apply.</p>
              ) : null}
              {last.has(question.id) ? (
                <p
                  className={cn(
                    'mt-1 text-xs font-medium',
                    last.get(question.id) ? 'text-success' : 'text-warning',
                  )}
                >
                  {last.get(question.id) ? 'You got this one last time.' : 'Not quite last time.'}
                </p>
              ) : null}
              <div className="mt-3 flex flex-col gap-2">
                {question.options.map((option) => (
                  <label
                    key={option.id}
                    className="rounded-control border-line flex min-h-12 items-center gap-3 border bg-white px-3.5 py-2.5 text-[0.9375rem] has-[:checked]:border-violet-500 has-[:checked]:bg-violet-50"
                  >
                    <input
                      type={question.kind === 'multiple' ? 'checkbox' : 'radio'}
                      name={`q:${question.id}`}
                      value={option.id}
                      className="size-5 shrink-0 accent-violet-600"
                    />
                    <span className="text-ink">{option.text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
    </StepForm>
  )
}

function Practical({
  practical,
  state,
  readOnly,
  ...common
}: {
  practical: NonNullable<Props['practical']>
  state: string
  readOnly: boolean
  assignmentId: string
  lessonId: string
  onDone: (result: TrainingActionState) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="criteria-heading">
        <h2 id="criteria-heading" className="text-ink text-sm font-semibold">
          What your manager will look for
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {practical.criteria.map((c) => (
            <li
              key={c.id}
              className="rounded-control border-line text-ink flex items-start gap-3 border bg-white px-3.5 py-3 text-[0.9375rem]"
            >
              <span
                aria-hidden="true"
                className="mt-2 size-1.5 shrink-0 rounded-full bg-violet-600"
              />
              {c.text}
            </li>
          ))}
        </ul>
      </section>

      {state === 'completed' ? (
        <Done
          text={
            practical.verified
              ? `Signed off by ${practical.verified.byName} on ${practical.verified.dateLabel}.`
              : 'Signed off.'
          }
        />
      ) : state === 'awaiting_signoff' ? (
        <div className="rounded-card border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="text-ink font-medium">Waiting for sign-off</p>
          <p className="text-muted mt-0.5 text-sm">
            You asked{practical.requestedLabel ? ` on ${practical.requestedLabel}` : ''}. A manager
            will watch you do this and confirm it here.
          </p>
        </div>
      ) : readOnly ? null : (
        <>
          {practical.returned ? (
            <div className="rounded-card border-warning/30 bg-warning-soft border px-4 py-3">
              <p className="text-muted text-xs">
                {practical.returned.byName} · {practical.returned.dateLabel}
              </p>
              <p className="text-ink mt-0.5">{practical.returned.note}</p>
            </div>
          ) : (
            <p className="text-muted text-sm">
              When you are ready, ask a manager on shift to watch you, then let them know here.
            </p>
          )}
          <StepForm
            action={requestSignoffAction}
            submitLabel={practical.returned ? 'Ask for sign-off again' : 'I’m ready for sign-off'}
            {...common}
          />
        </>
      )}
    </div>
  )
}
