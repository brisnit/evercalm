'use client'

import { useState } from 'react'
import {
  removeLessonAction,
  removeQuestionAction,
  saveQuestionAction,
  updateLessonAction,
} from '@/modules/training/actions'
import {
  QUESTION_KIND_LABELS,
  QUESTION_KINDS,
  type LessonKind,
  type QuestionKind,
  type QuizQuestion,
} from '@/modules/training/content'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Badge, Card, CardHeader, Field, Input } from '@/ui/primitives'
import { SELECT_CLASS, TEXTAREA_CLASS } from '../../../../_components/styles'

interface EditableLesson {
  id: string
  title: string
  kind: LessonKind
  body: string
  estimatedMinutes: number
  itemsText: string
  passPercent: number
  maxAttempts: number
  questions: QuizQuestion[]
}

const BODY_LABELS: Record<LessonKind, { label: string; hint: string }> = {
  reading: { label: 'What to read', hint: '' },
  checklist: { label: 'Introduction', hint: 'Optional. When and why to use this checklist.' },
  quiz: { label: 'Introduction', hint: 'Optional. Shown above the questions.' },
  practical: {
    label: 'What to demonstrate',
    hint: 'Tell them when and how the manager will watch.',
  },
}

const FORMATTING_HINT =
  'Plain text. Start a line with “- ” for a bullet or “1. ” for a numbered step, and wrap words in **double asterisks** for bold.'

export function LessonEditor({
  courseId,
  lesson,
  problems,
}: {
  courseId: string
  lesson: EditableLesson
  problems: string[]
}) {
  const { notice, show, dismiss } = useActionNotice()
  const [adding, setAdding] = useState(0)
  const body = BODY_LABELS[lesson.kind]

  return (
    <div className="flex flex-col gap-5">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      {problems.length > 0 ? (
        <div className="rounded-card border-warning/30 bg-warning-soft border px-4 py-3">
          <h2 className="text-ink text-sm font-semibold">Before this lesson can be published</h2>
          <ul className="text-ink mt-1 list-disc pl-5 text-sm">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Lesson" />
        <div className="p-5">
          <ActionForm action={updateLessonAction} submitLabel="Save lesson" onSuccess={show}>
            {(state) => (
              <>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                  <Field
                    id="edit-title"
                    label="Title"
                    required
                    error={state.fieldErrors?.title?.[0]}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        name="title"
                        defaultValue={lesson.title}
                        maxLength={120}
                        required
                      />
                    )}
                  </Field>
                  <Field
                    id="edit-minutes"
                    label="Minutes"
                    error={state.fieldErrors?.estimatedMinutes?.[0]}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        name="estimatedMinutes"
                        type="number"
                        min={1}
                        max={240}
                        defaultValue={lesson.estimatedMinutes}
                      />
                    )}
                  </Field>
                </div>
                <Field
                  id="edit-body"
                  label={body.label}
                  hint={[body.hint, FORMATTING_HINT].filter(Boolean).join(' ')}
                >
                  {(p) => (
                    <textarea
                      {...p}
                      name="body"
                      rows={lesson.kind === 'reading' ? 12 : 4}
                      defaultValue={lesson.body}
                      className={TEXTAREA_CLASS}
                    />
                  )}
                </Field>
                {lesson.kind === 'checklist' || lesson.kind === 'practical' ? (
                  <Field
                    id="edit-items"
                    label={
                      lesson.kind === 'checklist'
                        ? 'Checklist items'
                        : 'What the manager will look for'
                    }
                    hint={
                      lesson.kind === 'checklist'
                        ? 'One per line. The employee ticks each one.'
                        : 'One per line. The manager confirms every point before signing off.'
                    }
                  >
                    {(p) => (
                      <textarea
                        {...p}
                        name="itemsText"
                        rows={6}
                        defaultValue={lesson.itemsText}
                        className={TEXTAREA_CLASS}
                      />
                    )}
                  </Field>
                ) : null}
                {lesson.kind === 'quiz' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="edit-pass"
                      label="Pass mark (%)"
                      error={state.fieldErrors?.passPercent?.[0]}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          name="passPercent"
                          type="number"
                          min={1}
                          max={100}
                          defaultValue={lesson.passPercent}
                        />
                      )}
                    </Field>
                    <Field
                      id="edit-attempts"
                      label="Attempts allowed"
                      hint="0 means as many as they need."
                      error={state.fieldErrors?.maxAttempts?.[0]}
                    >
                      {(p) => (
                        <Input
                          {...p}
                          name="maxAttempts"
                          type="number"
                          min={0}
                          max={10}
                          defaultValue={lesson.maxAttempts}
                        />
                      )}
                    </Field>
                  </div>
                ) : null}
              </>
            )}
          </ActionForm>
        </div>
      </Card>

      {lesson.kind === 'quiz' ? (
        <>
          <Card>
            <CardHeader
              title={`Questions (${lesson.questions.length})`}
              description="Answers are checked on the server. Employees see the correct answers only after they pass."
            />
            {lesson.questions.length === 0 ? (
              <p className="text-muted px-5 py-4 text-sm">No questions yet.</p>
            ) : (
              <ol className="divide-line divide-y">
                {lesson.questions.map((question, index) => (
                  <QuestionRow
                    key={question.id}
                    lessonId={lesson.id}
                    question={question}
                    number={index + 1}
                    onSaved={show}
                  />
                ))}
              </ol>
            )}
          </Card>
          <Card>
            <CardHeader title="Add a question" />
            <div className="p-5">
              <QuestionForm
                key={adding}
                lessonId={lesson.id}
                idPrefix="new-question"
                onSaved={(state) => {
                  show(state)
                  setAdding((n) => n + 1)
                }}
              />
            </div>
          </Card>
        </>
      ) : null}

      <div>
        <ConfirmAction
          triggerLabel="Remove this lesson"
          title="Remove this lesson from the draft?"
          description="It is removed from this draft only. Published versions keep it."
        >
          <ActionForm
            action={removeLessonAction}
            submitLabel="Yes, remove it"
            destructive
            variant="danger"
          >
            <input type="hidden" name="lessonId" value={lesson.id} />
            <input type="hidden" name="courseId" value={courseId} />
          </ActionForm>
        </ConfirmAction>
      </div>
    </div>
  )
}

type Notify = Parameters<typeof ActionForm>[0]['onSuccess']

function QuestionRow({
  lessonId,
  question,
  number,
  onSaved,
}: {
  lessonId: string
  question: QuizQuestion
  number: number
  onSaved: Notify
}) {
  const [open, setOpen] = useState(false)
  const correct = question.options.filter((o) => question.correctOptionIds.includes(o.id))
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-ink text-sm font-medium">
            {number}. {question.prompt}
          </p>
          <p className="text-muted mt-0.5 text-xs">
            {QUESTION_KIND_LABELS[question.kind]} · Correct: {correct.map((o) => o.text).join(', ')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Edit'} question ${number}`}
          className="text-ink hover:bg-sunk rounded-control inline-flex min-h-9 items-center px-2.5 text-sm font-medium underline underline-offset-4"
        >
          {open ? 'Close' : 'Edit'}
        </button>
      </div>
      {open ? (
        <div className="border-line bg-raise rounded-card mt-3 border p-4">
          <QuestionForm
            lessonId={lessonId}
            question={question}
            idPrefix={`q-${question.id}`}
            onSaved={onSaved}
          />
          <div className="mt-4">
            <ActionForm
              action={removeQuestionAction}
              submitLabel="Remove question"
              variant="ghost"
              destructive
              onSuccess={onSaved}
            >
              <input type="hidden" name="lessonId" value={lessonId} />
              <input type="hidden" name="questionId" value={question.id} />
            </ActionForm>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function QuestionForm({
  lessonId,
  question,
  idPrefix,
  onSaved,
}: {
  lessonId: string
  question?: QuizQuestion
  idPrefix: string
  onSaved: Notify
}) {
  const [kind, setKind] = useState<QuestionKind>(question?.kind ?? 'single')
  const texts =
    question && question.kind !== 'true_false' ? question.options.map((o) => o.text) : []
  const correct = new Set(
    (question?.options ?? []).flatMap((o, i) =>
      question!.correctOptionIds.includes(o.id) ? [i] : [],
    ),
  )
  const slots = Array.from({ length: 6 }, (_, i) => texts[i] ?? '')

  return (
    <ActionForm
      action={saveQuestionAction}
      submitLabel={question ? 'Save question' : 'Add question'}
      onSuccess={onSaved}
    >
      {(state) => (
        <>
          <input type="hidden" name="lessonId" value={lessonId} />
          <input type="hidden" name="questionId" value={question?.id ?? ''} />
          <Field id={`${idPrefix}-kind`} label="Type of question">
            {(p) => (
              <select
                {...p}
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as QuestionKind)}
                className={SELECT_CLASS}
              >
                {QUESTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {QUESTION_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${idPrefix}-prompt`}
            label="Question"
            required
            error={state.fieldErrors?.prompt?.[0]}
          >
            {(p) => (
              <textarea
                {...p}
                name="prompt"
                rows={2}
                maxLength={400}
                defaultValue={question?.prompt}
                className={TEXTAREA_CLASS}
                required
              />
            )}
          </Field>

          {kind === 'true_false' ? (
            <fieldset key="tf" className="flex flex-col gap-2">
              <legend className="text-ink mb-1 text-sm font-medium">Correct answer</legend>
              {['True', 'False'].map((label, i) => (
                <label key={label} className="flex min-h-11 items-center gap-2.5 text-sm">
                  <input
                    type="radio"
                    name="correct"
                    value={i}
                    defaultChecked={question?.kind === 'true_false' ? correct.has(i) : i === 0}
                    className="size-4 accent-teal-600"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : (
            <fieldset key={kind} className="flex flex-col gap-2">
              <legend className="text-ink mb-1 text-sm font-medium">Answers</legend>
              <p className="text-muted -mt-1 text-xs">
                {kind === 'multiple'
                  ? 'Tick every correct answer. Leave spare boxes empty.'
                  : 'Choose the one correct answer. Leave spare boxes empty.'}
              </p>
              {slots.map((text, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type={kind === 'multiple' ? 'checkbox' : 'radio'}
                    name="correct"
                    value={i}
                    defaultChecked={correct.has(i)}
                    aria-label={`Answer ${i + 1} is correct`}
                    className="size-5 shrink-0 accent-teal-600"
                  />
                  <Input
                    name={`option${i}`}
                    defaultValue={text}
                    maxLength={240}
                    aria-label={`Answer ${i + 1}`}
                  />
                </div>
              ))}
            </fieldset>
          )}
          {state.fieldErrors?.options?.[0] || state.fieldErrors?.correct?.[0] ? (
            <p role="alert" className="text-danger text-xs font-medium">
              {state.fieldErrors?.options?.[0] ?? state.fieldErrors?.correct?.[0]}
            </p>
          ) : null}

          <Field
            id={`${idPrefix}-explanation`}
            label="Explanation"
            hint="Shown to employees after they pass."
          >
            {(p) => (
              <textarea
                {...p}
                name="explanation"
                rows={2}
                maxLength={600}
                defaultValue={question?.explanation}
                className={TEXTAREA_CLASS}
              />
            )}
          </Field>
          {question ? null : <Badge tone="neutral">Added to the end of the knowledge check</Badge>}
        </>
      )}
    </ActionForm>
  )
}
