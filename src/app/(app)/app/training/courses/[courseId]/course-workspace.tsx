'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import {
  addLessonAction,
  archiveCourseAction,
  discardDraftAction,
  moveLessonAction,
  publishDraftAction,
  restoreCourseAction,
  startNewDraftAction,
  updateDraftDetailsAction,
  type TrainingActionState,
} from '@/modules/training/actions'
import { LESSON_KIND_LABELS, LESSON_KINDS } from '@/modules/training/content'
import { formatMinutes } from '@/modules/training/progress'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Badge, Card, CardHeader, EmptyState, Field, Input } from '@/ui/primitives'
import { SECONDARY_LINK_CLASS, SELECT_CLASS, TEXTAREA_CLASS } from '../../_components/styles'

export interface LessonRow {
  id: string
  title: string
  kindLabel: string
  minutes: number
  detail: string
  problems: string[]
}

interface Props {
  courseId: string
  archived: boolean
  canAuthor: boolean
  canPublish: boolean
  showCounts: boolean
  published: {
    versionNumber: number
    publishedLabel: string
    totalMinutes: number
    lessons: LessonRow[]
  } | null
  draft: {
    id: string
    versionNumber: number
    title: string
    summary: string
    totalMinutes: number
    lessons: LessonRow[]
    problems: string[]
  } | null
  history: {
    id: string
    versionNumber: number
    status: 'draft' | 'published'
    isCurrent: boolean
    publishedLabel: string | null
    changeNote: string
    lessonCount: number
    openAssignments: number
    completedAssignments: number
  }[]
}

const KIND_HINTS: Record<string, string> = {
  reading: 'Something to read and understand.',
  checklist: 'Steps to confirm one by one.',
  quiz: 'Questions scored against a pass mark.',
  practical: 'Something to demonstrate while a manager watches.',
}

export function CourseWorkspace(props: Props) {
  const { notice, show, dismiss } = useActionNotice()
  const { courseId, draft, published, archived, canAuthor, canPublish } = props
  const editing = draft !== null && canAuthor && !archived

  return (
    <div className="flex flex-col gap-5">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {editing ? (
            <>
              <Card>
                <CardHeader
                  title={`Draft of version ${draft.versionNumber}`}
                  description="Changes here affect nobody until the draft is published."
                />
                <div className="p-5">
                  <ActionForm
                    action={updateDraftDetailsAction}
                    submitLabel="Save details"
                    variant="secondary"
                  >
                    {(state) => (
                      <>
                        <input type="hidden" name="versionId" value={draft.id} />
                        <Field
                          id="draft-title"
                          label="Title"
                          required
                          error={state.fieldErrors?.title?.[0]}
                        >
                          {(p) => (
                            <Input
                              {...p}
                              name="title"
                              defaultValue={draft.title}
                              maxLength={120}
                              required
                            />
                          )}
                        </Field>
                        <Field
                          id="draft-summary"
                          label="Summary"
                          hint="Employees see this before they start."
                        >
                          {(p) => (
                            <textarea
                              {...p}
                              name="summary"
                              rows={2}
                              maxLength={600}
                              defaultValue={draft.summary}
                              className={TEXTAREA_CLASS}
                            />
                          )}
                        </Field>
                      </>
                    )}
                  </ActionForm>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Lessons"
                  description={
                    draft.lessons.length === 0
                      ? 'Add the first lesson below.'
                      : `${draft.lessons.length} ${draft.lessons.length === 1 ? 'lesson' : 'lessons'} · about ${formatMinutes(draft.totalMinutes)}`
                  }
                />
                <LessonList courseId={courseId} lessons={draft.lessons} editable />
                <div className="border-line bg-raise border-t p-5">
                  <h3 className="font-display text-ink text-sm font-bold">Add a lesson</h3>
                  <ActionForm
                    action={addLessonAction}
                    submitLabel="Add lesson"
                    variant="secondary"
                    className="mt-3 flex flex-col gap-3"
                  >
                    {(state) => (
                      <>
                        <input type="hidden" name="courseId" value={courseId} />
                        <input type="hidden" name="versionId" value={draft.id} />
                        <Field
                          id="lesson-title"
                          label="Lesson title"
                          required
                          error={state.fieldErrors?.title?.[0]}
                        >
                          {(p) => (
                            <Input
                              {...p}
                              name="title"
                              maxLength={120}
                              required
                              autoComplete="off"
                            />
                          )}
                        </Field>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                          <Field
                            id="lesson-kind"
                            label="Kind of lesson"
                            required
                            error={state.fieldErrors?.kind?.[0]}
                          >
                            {(p) => (
                              <select
                                {...p}
                                name="kind"
                                defaultValue="reading"
                                className={SELECT_CLASS}
                              >
                                {LESSON_KINDS.map((kind) => (
                                  <option key={kind} value={kind}>
                                    {LESSON_KIND_LABELS[kind]}: {KIND_HINTS[kind]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </Field>
                          <Field
                            id="lesson-minutes"
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
                                defaultValue={5}
                              />
                            )}
                          </Field>
                        </div>
                      </>
                    )}
                  </ActionForm>
                </div>
              </Card>
            </>
          ) : published ? (
            <Card>
              <CardHeader
                title={`Version ${published.versionNumber}`}
                description={`${published.publishedLabel}. Published versions cannot be edited.`}
              />
              <LessonList courseId={courseId} lessons={published.lessons} editable={false} />
            </Card>
          ) : (
            <EmptyState
              title="No content yet"
              description="This course has no published version."
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {canAuthor || canPublish ? (
            <Card>
              <CardHeader title="Publishing" />
              <div className="flex flex-col gap-4 p-5">
                {archived ? (
                  <>
                    <p className="text-muted text-sm">
                      This course is archived. It cannot be assigned, and people already assigned
                      can still finish it.
                    </p>
                    {canPublish ? (
                      <ActionForm
                        action={restoreCourseAction}
                        submitLabel="Restore course"
                        variant="secondary"
                        onSuccess={show}
                      >
                        <input type="hidden" name="courseId" value={courseId} />
                      </ActionForm>
                    ) : null}
                  </>
                ) : draft ? (
                  <>
                    <div className="rounded-control border border-violet-200 bg-violet-50 px-4 py-3">
                      <p className="text-ink text-sm font-medium">
                        Draft of version {draft.versionNumber} is not live
                      </p>
                      <p className="text-muted mt-1 text-sm">
                        {published
                          ? `Everyone assigned version ${published.versionNumber} keeps it. Publishing changes only what new assignments receive.`
                          : 'Nobody can be assigned this course until it is published.'}
                      </p>
                    </div>

                    {draft.problems.length > 0 ? (
                      <div className="rounded-control border-warning/30 bg-warning-soft border px-4 py-3">
                        <h3 className="text-ink text-sm font-semibold">
                          Before it can be published
                        </h3>
                        <ul className="text-ink mt-1.5 list-disc pl-5 text-sm">
                          {draft.problems.map((problem) => (
                            <li key={problem}>{problem}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <Link
                      href={`/app/training/courses/${courseId}/preview?version=${draft.versionNumber}`}
                      className={SECONDARY_LINK_CLASS}
                    >
                      Preview as an employee
                    </Link>

                    {canPublish ? (
                      <ActionForm
                        action={publishDraftAction}
                        submitLabel={`Publish version ${draft.versionNumber}`}
                        onSuccess={show}
                      >
                        {(state) => (
                          <>
                            <input type="hidden" name="versionId" value={draft.id} />
                            <Field
                              id="change-note"
                              label={published ? 'What changed' : 'Note (optional)'}
                              required={published !== null}
                              hint={
                                published
                                  ? 'Managers read this when deciding whether to move people who have not started.'
                                  : undefined
                              }
                              error={state.fieldErrors?.changeNote?.[0]}
                            >
                              {(p) => (
                                <textarea
                                  {...p}
                                  name="changeNote"
                                  rows={3}
                                  maxLength={600}
                                  className={TEXTAREA_CLASS}
                                />
                              )}
                            </Field>
                            {state.fieldErrors?.publish ? (
                              <ul role="alert" className="text-danger list-disc pl-5 text-sm">
                                {state.fieldErrors.publish.map((p) => (
                                  <li key={p}>{p}</li>
                                ))}
                              </ul>
                            ) : null}
                          </>
                        )}
                      </ActionForm>
                    ) : (
                      <p className="text-muted text-sm">
                        Someone with the “Publish training” permission publishes it.
                      </p>
                    )}

                    {canAuthor && published ? (
                      <ConfirmAction
                        triggerLabel="Discard draft"
                        title="Discard this draft?"
                        description={`The draft and its changes are deleted. Version ${published.versionNumber} stays exactly as it is.`}
                      >
                        <ActionForm
                          action={discardDraftAction}
                          submitLabel="Yes, discard it"
                          destructive
                          variant="danger"
                          onSuccess={show}
                        >
                          <input type="hidden" name="versionId" value={draft.id} />
                        </ActionForm>
                      </ConfirmAction>
                    ) : null}
                  </>
                ) : published ? (
                  <>
                    <p className="text-muted text-sm">
                      Version {published.versionNumber} is live. To change it, start a new draft: it
                      copies these lessons, and nothing changes for anyone until you publish it.
                    </p>
                    {canAuthor ? (
                      <ActionForm
                        action={startNewDraftAction}
                        submitLabel="Start a new draft"
                        variant="secondary"
                        onSuccess={show}
                      >
                        <input type="hidden" name="courseId" value={courseId} />
                      </ActionForm>
                    ) : null}
                  </>
                ) : null}

                {!archived && canPublish ? (
                  <div className="border-line border-t pt-4">
                    <ConfirmAction
                      triggerLabel="Archive course"
                      title="Archive this course?"
                      description="It can no longer be assigned. People already working on it keep it and can finish."
                    >
                      <ActionForm
                        action={archiveCourseAction}
                        submitLabel="Yes, archive it"
                        destructive
                        variant="danger"
                        onSuccess={show}
                      >
                        <input type="hidden" name="courseId" value={courseId} />
                      </ActionForm>
                    </ConfirmAction>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : published ? (
            <Card className="p-5">
              <p className="text-muted text-sm">
                Version {published.versionNumber}. {published.publishedLabel}.
              </p>
              <Link
                href={`/app/training/courses/${courseId}/people`}
                className={`${SECONDARY_LINK_CLASS} mt-4 w-full`}
              >
                Assign and follow up
              </Link>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Version history"
              description="Every published version is kept, unchanged."
            />
            <ol className="divide-line divide-y">
              {props.history.map((entry) => (
                <li key={entry.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink text-sm font-semibold">
                      Version {entry.versionNumber}
                    </span>
                    {entry.status === 'draft' ? (
                      <Badge tone="violet">Draft</Badge>
                    ) : entry.isCurrent ? (
                      <Badge tone="success">Current</Badge>
                    ) : (
                      <Badge tone="neutral">Earlier</Badge>
                    )}
                  </div>
                  <p className="text-muted mt-0.5 text-xs">
                    {entry.publishedLabel ? `Published ${entry.publishedLabel}` : 'Not published'} ·{' '}
                    {entry.lessonCount} {entry.lessonCount === 1 ? 'lesson' : 'lessons'}
                  </p>
                  {entry.changeNote ? (
                    <p className="text-ink mt-2 text-sm">{entry.changeNote}</p>
                  ) : null}
                  {props.showCounts && entry.status === 'published' ? (
                    <p className="text-muted mt-1.5 text-xs">
                      {entry.openAssignments} still working on it · {entry.completedAssignments}{' '}
                      completed
                    </p>
                  ) : null}
                  <Link
                    href={`/app/training/courses/${courseId}/preview?version=${entry.versionNumber}`}
                    className="mt-2 inline-flex min-h-9 items-center text-sm font-medium text-violet-700 underline underline-offset-4"
                  >
                    Preview version {entry.versionNumber}
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}

function LessonList({
  courseId,
  lessons,
  editable,
}: {
  courseId: string
  lessons: LessonRow[]
  editable: boolean
}) {
  if (lessons.length === 0) return <p className="text-muted px-5 py-4 text-sm">No lessons yet.</p>
  return (
    <ol className="divide-line divide-y">
      {lessons.map((lesson, index) => (
        <li key={lesson.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
          <span
            aria-hidden="true"
            className="bg-sunk text-muted mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-ink text-sm font-medium">{lesson.title}</p>
            <p className="text-muted text-xs">
              {[lesson.kindLabel, `${lesson.minutes} min`, lesson.detail]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {editable && lesson.problems.length > 0 ? (
              <p className="text-warning mt-1 text-xs font-medium">
                Needs work: {lesson.problems.join(' ')}
              </p>
            ) : null}
          </div>
          {editable ? (
            <div className="flex items-center gap-1">
              <MoveButton
                lessonId={lesson.id}
                direction="up"
                disabled={index === 0}
                title={lesson.title}
              />
              <MoveButton
                lessonId={lesson.id}
                direction="down"
                disabled={index === lessons.length - 1}
                title={lesson.title}
              />
              <Link
                href={`/app/training/courses/${courseId}/lessons/${lesson.id}`}
                aria-label={`Edit ${lesson.title}`}
                className="text-ink hover:bg-sunk rounded-control inline-flex min-h-9 items-center px-2.5 text-sm font-medium underline underline-offset-4"
              >
                Edit
              </Link>
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

const IDLE: TrainingActionState = { status: 'idle' }

function MoveButton({
  lessonId,
  direction,
  disabled,
  title,
}: {
  lessonId: string
  direction: 'up' | 'down'
  disabled: boolean
  title: string
}) {
  const [, formAction, pending] = useActionState(moveLessonAction, IDLE)
  return (
    <form action={formAction}>
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled || pending}
        aria-label={`Move ${title} ${direction}`}
        className="text-muted hover:bg-sunk hover:text-ink rounded-control inline-flex size-9 items-center justify-center text-base disabled:opacity-35"
      >
        <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
      </button>
    </form>
  )
}
