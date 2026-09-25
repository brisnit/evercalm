'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { FROZEN_VERSION, pgErrorCode } from './access'
import { adoptFromLibrary, importCourseFromText } from './library'
import {
  addLesson,
  archiveCourse,
  createCourse,
  discardDraft,
  moveLesson,
  publishDraft,
  removeLesson,
  removeQuestion,
  restoreCourse,
  saveQuestion,
  startNewDraft,
  updateDraftDetails,
  updateLesson,
} from './authoring'
import {
  allowAnotherAttempt,
  assignCourse,
  decideSignoff,
  moveNotStartedToCurrent,
  withdrawAssignment,
} from './assignments'
import {
  completeReading,
  requestSignoff,
  saveChecklist,
  submitQuiz,
  type StepResult,
} from './learner'

/**
 * Training server actions.
 *
 * Each resolves the actor from the session and passes raw input to a service
 * that authorizes and re-validates it. Nothing posted - a course, a person, a
 * version, an answer - is trusted because a form offered it.
 */

export interface TrainingActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
  /** Where "Continue" should go after a learner action. */
  nextHref?: string
  courseComplete?: boolean
}

function fail(error: unknown, fallback: string): TrainingActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: error.message || 'You do not have permission to do that.' }
  }
  if (error instanceof NotFoundError) {
    return {
      status: 'error',
      message: 'We could not find that. It may have been changed or removed.',
    }
  }
  if (pgErrorCode(error) === FROZEN_VERSION) {
    return {
      status: 'error',
      message:
        'That version has been published, so it can no longer be changed. Start a new draft.',
    }
  }
  return { status: 'error', message: fallback }
}

function refresh(): void {
  revalidatePath('/app/training', 'layout')
  revalidatePath('/my', 'layout')
  revalidatePath('/app')
}

function readId(formData: FormData, name: string): string {
  const value = readString(formData, name)
  // A malformed id is simply not found - never a database error.
  return isUuid(value) ? value : '00000000-0000-0000-0000-000000000000'
}

function readIds(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map(String)
    .filter((v) => isUuid(v))
}

function readInt(formData: FormData, name: string, fallback: number): number {
  const raw = readString(formData, name).trim()
  if (raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) ? value : Number.NaN
}

async function tenant<T>(
  fn: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    actor: Awaited<ReturnType<typeof requireActorContext>>['actor'],
  ) => Promise<T>,
): Promise<T> {
  const { actor } = await requireActorContext()
  return withTenant(actor.organizationId, (tx) => fn(tx, actor))
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export async function createCourseAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  let courseId: string
  try {
    courseId = await tenant((tx, actor) =>
      createCourse(tx, actor, {
        title: readString(formData, 'title'),
        summary: readString(formData, 'summary'),
      }),
    )
  } catch (error) {
    return fail(error, 'The course could not be created.')
  }
  refresh()
  redirect(`/app/training/courses/${courseId}`)
}

export async function updateDraftDetailsAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) =>
      updateDraftDetails(tx, actor, readId(formData, 'versionId'), {
        title: readString(formData, 'title'),
        summary: readString(formData, 'summary'),
      }),
    )
  } catch (error) {
    return fail(error, 'The details could not be saved.')
  }
  refresh()
  return { status: 'success', message: 'Details saved.' }
}

export async function addLessonAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const courseId = readId(formData, 'courseId')
  let lessonId: string
  try {
    lessonId = await tenant((tx, actor) =>
      addLesson(tx, actor, readId(formData, 'versionId'), {
        title: readString(formData, 'title'),
        kind: readString(formData, 'kind'),
        estimatedMinutes: readInt(formData, 'estimatedMinutes', 5),
      }),
    )
  } catch (error) {
    return fail(error, 'The lesson could not be added.')
  }
  refresh()
  redirect(`/app/training/courses/${courseId}/lessons/${lessonId}`)
}

export async function updateLessonAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) =>
      updateLesson(tx, actor, readId(formData, 'lessonId'), {
        title: readString(formData, 'title'),
        estimatedMinutes: readInt(formData, 'estimatedMinutes', 5),
        body: readString(formData, 'body'),
        itemsText: formData.has('itemsText') ? readString(formData, 'itemsText') : undefined,
        passPercent: formData.has('passPercent') ? readInt(formData, 'passPercent', 80) : undefined,
        maxAttempts: formData.has('maxAttempts') ? readInt(formData, 'maxAttempts', 0) : undefined,
      }),
    )
  } catch (error) {
    return fail(error, 'The lesson could not be saved.')
  }
  refresh()
  return { status: 'success', message: 'Lesson saved.' }
}

export async function saveQuestionAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const questionId = readString(formData, 'questionId')
  try {
    await tenant((tx, actor) =>
      saveQuestion(tx, actor, readId(formData, 'lessonId'), questionId ? questionId : null, {
        kind: readString(formData, 'kind'),
        prompt: readString(formData, 'prompt'),
        options: Array.from({ length: 6 }, (_, i) => readString(formData, `option${i}`)),
        correct: formData
          .getAll('correct')
          .map((v) => Number(v))
          .filter((n) => Number.isInteger(n)),
        explanation: readString(formData, 'explanation'),
      }),
    )
  } catch (error) {
    return fail(error, 'The question could not be saved.')
  }
  refresh()
  return { status: 'success', message: questionId ? 'Question saved.' : 'Question added.' }
}

export async function removeQuestionAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) =>
      removeQuestion(tx, actor, readId(formData, 'lessonId'), readString(formData, 'questionId')),
    )
  } catch (error) {
    return fail(error, 'The question could not be removed.')
  }
  refresh()
  return { status: 'success', message: 'Question removed.' }
}

export async function moveLessonAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) =>
      moveLesson(
        tx,
        actor,
        readId(formData, 'lessonId'),
        readString(formData, 'direction') === 'up' ? 'up' : 'down',
      ),
    )
  } catch (error) {
    return fail(error, 'The lesson could not be moved.')
  }
  refresh()
  return { status: 'success', message: 'Order saved.' }
}

export async function removeLessonAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const courseId = readId(formData, 'courseId')
  try {
    await tenant((tx, actor) => removeLesson(tx, actor, readId(formData, 'lessonId')))
  } catch (error) {
    return fail(error, 'The lesson could not be removed.')
  }
  refresh()
  redirect(`/app/training/courses/${courseId}`)
}

export async function publishDraftAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    const result = await tenant((tx, actor) =>
      publishDraft(tx, actor, readId(formData, 'versionId'), {
        changeNote: readString(formData, 'changeNote'),
      }),
    )
    refresh()
    const waiting = result.notStartedOnOlderVersions
    return {
      status: 'success',
      message:
        `Version ${result.versionNumber} is published. New assignments get it from now on; nobody already assigned was moved.` +
        (waiting > 0
          ? ` ${waiting} ${waiting === 1 ? 'person has' : 'people have'} not started an older version and can be moved from People.`
          : ''),
    }
  } catch (error) {
    return fail(error, 'The draft could not be published.')
  }
}

export async function startNewDraftAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) => startNewDraft(tx, actor, readId(formData, 'courseId')))
  } catch (error) {
    return fail(error, 'A new draft could not be started.')
  }
  refresh()
  return {
    status: 'success',
    message: 'New draft started. Nothing changes for anyone until you publish it.',
  }
}

export async function discardDraftAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) => discardDraft(tx, actor, readId(formData, 'versionId')))
  } catch (error) {
    return fail(error, 'The draft could not be discarded.')
  }
  refresh()
  return { status: 'success', message: 'Draft discarded.' }
}

export async function archiveCourseAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    const { openAssignments } = await tenant((tx, actor) =>
      archiveCourse(tx, actor, readId(formData, 'courseId')),
    )
    refresh()
    return {
      status: 'success',
      message:
        openAssignments > 0
          ? `Course archived. ${openAssignments} ${openAssignments === 1 ? 'person is' : 'people are'} still assigned it and can finish.`
          : 'Course archived.',
    }
  } catch (error) {
    return fail(error, 'The course could not be archived.')
  }
}

export async function restoreCourseAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) => restoreCourse(tx, actor, readId(formData, 'courseId')))
  } catch (error) {
    return fail(error, 'The course could not be restored.')
  }
  refresh()
  return { status: 'success', message: 'Course restored.' }
}

// ---------------------------------------------------------------------------
// Assigning and following up
// ---------------------------------------------------------------------------

export async function assignCourseAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    const result = await tenant((tx, actor) =>
      assignCourse(tx, actor, {
        courseId: readId(formData, 'courseId'),
        locationId: readId(formData, 'locationId'),
        employmentIds: readIds(formData, 'employmentIds'),
        jobRoleId: isUuid(readString(formData, 'jobRoleId'))
          ? readString(formData, 'jobRoleId')
          : null,
        dueOn: readString(formData, 'dueOn') || null,
        required: readString(formData, 'required') !== 'optional',
        note: readString(formData, 'note'),
      }),
    )
    refresh()
    const parts = [
      result.assigned > 0
        ? `Assigned version ${result.versionNumber} to ${result.assigned} ${result.assigned === 1 ? 'person' : 'people'}.`
        : 'Nobody new was assigned.',
    ]
    if (result.alreadyAssigned.length > 0) {
      parts.push(`Already working on it: ${result.alreadyAssigned.join(', ')}.`)
    }
    return { status: 'success', message: parts.join(' ') }
  } catch (error) {
    return fail(error, 'The training could not be assigned.')
  }
}

export async function withdrawAssignmentAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) =>
      withdrawAssignment(
        tx,
        actor,
        readId(formData, 'assignmentId'),
        readString(formData, 'reason'),
      ),
    )
  } catch (error) {
    return fail(error, 'The training could not be withdrawn.')
  }
  refresh()
  return { status: 'success', message: 'Training withdrawn. Their progress stays on record.' }
}

export async function moveNotStartedAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    const result = await tenant((tx, actor) =>
      moveNotStartedToCurrent(tx, actor, readId(formData, 'courseId')),
    )
    refresh()
    return {
      status: 'success',
      message:
        result.moved === 0
          ? 'Nobody needed moving: everyone on an older version has already started it.'
          : `Moved ${result.moved} ${result.moved === 1 ? 'person' : 'people'} to version ${result.versionNumber}. Anyone who had started stays on their version.`,
    }
  } catch (error) {
    return fail(error, 'People could not be moved to the current version.')
  }
}

export async function allowAttemptAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    await tenant((tx, actor) =>
      allowAnotherAttempt(
        tx,
        actor,
        readId(formData, 'assignmentId'),
        readId(formData, 'lessonId'),
      ),
    )
  } catch (error) {
    return fail(error, 'Another attempt could not be allowed.')
  }
  refresh()
  return { status: 'success', message: 'Another attempt allowed.' }
}

export async function decideSignoffAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  try {
    const result = await tenant((tx, actor) =>
      decideSignoff(tx, actor, readId(formData, 'progressId'), {
        decision: readString(formData, 'decision'),
        note: readString(formData, 'note'),
        criteriaConfirmed: formData.getAll('criteria').map(String),
      }),
    )
    refresh()
    return {
      status: 'success',
      message:
        result.decision === 'verified'
          ? `Signed off for ${result.personName}.${result.courseComplete ? ' That completes their course.' : ''}`
          : `Sent back to ${result.personName} with your note.`,
    }
  } catch (error) {
    return fail(error, 'The sign-off could not be saved.')
  }
}

// ---------------------------------------------------------------------------
// The learner
// ---------------------------------------------------------------------------

function stepState(assignmentId: string, result: StepResult): TrainingActionState {
  return {
    status: 'success',
    message: result.message,
    courseComplete: result.courseComplete,
    nextHref: result.courseComplete
      ? `/my/training/${assignmentId}`
      : result.nextLessonId
        ? `/my/training/${assignmentId}/lessons/${result.nextLessonId}`
        : undefined,
  }
}

export async function completeReadingAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const assignmentId = readId(formData, 'assignmentId')
  try {
    const result = await tenant((tx, actor) =>
      completeReading(tx, actor, assignmentId, readId(formData, 'lessonId')),
    )
    refresh()
    return stepState(assignmentId, result)
  } catch (error) {
    return fail(error, 'That could not be saved. Please try again.')
  }
}

export async function saveChecklistAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const assignmentId = readId(formData, 'assignmentId')
  try {
    const result = await tenant((tx, actor) =>
      saveChecklist(
        tx,
        actor,
        assignmentId,
        readId(formData, 'lessonId'),
        formData.getAll('items').map(String),
      ),
    )
    refresh()
    return stepState(assignmentId, result)
  } catch (error) {
    return fail(error, 'Your checklist could not be saved. Please try again.')
  }
}

export async function submitQuizAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const assignmentId = readId(formData, 'assignmentId')
  const answers: Record<string, string[]> = {}
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('q:')) continue
    const questionId = key.slice(2)
    if (typeof value === 'string') answers[questionId] = [...(answers[questionId] ?? []), value]
  }
  try {
    const result = await tenant((tx, actor) =>
      submitQuiz(tx, actor, assignmentId, readId(formData, 'lessonId'), answers),
    )
    refresh()
    if (result.passed === false) return { status: 'error', message: result.message }
    return stepState(assignmentId, result)
  } catch (error) {
    return fail(error, 'Your answers could not be submitted. Please try again.')
  }
}

export async function requestSignoffAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const assignmentId = readId(formData, 'assignmentId')
  try {
    const result = await tenant((tx, actor) =>
      requestSignoff(tx, actor, assignmentId, readId(formData, 'lessonId')),
    )
    refresh()
    return stepState(assignmentId, result)
  } catch (error) {
    return fail(error, 'Your request could not be sent. Please try again.')
  }
}

// ---------------------------------------------------------------------------
// The library and the import path (round 2)
// ---------------------------------------------------------------------------

/**
 * Take a ready-made course into this organization.
 *
 * It arrives as a draft the manager owns: they edit it in their own words and
 * publish it themselves, and nothing reaches an employee until they do.
 */
export async function adoptFromLibraryAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const { actor } = await requireActorContext()
  let courseId: string
  try {
    courseId = await withTenant(actor.organizationId, (tx) =>
      adoptFromLibrary(tx, actor, readString(formData, 'key')),
    )
  } catch (error) {
    return fail(error, 'We could not add that course.')
  }
  revalidatePath('/app/training', 'layout')
  redirect(`/app/training/courses/${courseId}`)
}

/** Paste a policy you already have; each section becomes a reading lesson. */
export async function importCourseAction(
  _previous: TrainingActionState,
  formData: FormData,
): Promise<TrainingActionState> {
  const { actor } = await requireActorContext()
  let courseId: string
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      importCourseFromText(tx, actor, {
        title: readString(formData, 'title'),
        summary: readString(formData, 'summary'),
        text: readString(formData, 'text'),
      }),
    )
    courseId = result.courseId
  } catch (error) {
    return fail(error, 'We could not turn that into a course.')
  }
  revalidatePath('/app/training', 'layout')
  redirect(`/app/training/courses/${courseId}`)
}
