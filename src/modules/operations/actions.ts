'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import type { ActionState } from '@/modules/people/actions'
import { FROZEN_VERSION, pgErrorCode, StaleTaskError } from './access'
import { reassignTask, reopenTask, returnTask, verifyTask } from './board'
import { acknowledgeHandoff, createHandoff, reopenHandoff, resolveHandoff } from './handoffs'
import {
  addSection,
  addTask,
  archiveTemplate,
  createTemplate,
  discardDraft,
  moveSection,
  moveTask,
  publishDraft,
  removeSection,
  removeTask,
  renameSection,
  restoreTemplate,
  setDraftTargets,
  startNewDraft,
  updateDraftDetails,
  updateTask,
  type TaskInput,
} from './templates'
import {
  blockTask,
  completeHandoffTask,
  completeTask,
  skipTask,
  undoTask,
  unblockTask,
} from './work'

/**
 * Shift operations server actions.
 *
 * Each resolves the actor from the session and hands raw input to a service
 * that authorizes and validates it again. Nothing posted - a task, a
 * revision, a person - is trusted because a form offered it.
 */

const NIL = '00000000-0000-0000-0000-000000000000'

function fail(error: unknown, fallback: string): ActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof StaleTaskError) {
    return {
      status: 'error',
      message:
        'Someone changed this task a moment ago. The page has the latest; check it and try again.',
    }
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
  revalidatePath('/app/operations', 'layout')
  revalidatePath('/my', 'layout')
}

function readId(formData: FormData, name: string): string {
  const value = readString(formData, name)
  return isUuid(value) ? value : NIL
}

function readIds(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map(String)
    .filter((v) => isUuid(v))
}

function readRevision(formData: FormData): number {
  const value = Number(readString(formData, 'revision'))
  return Number.isInteger(value) && value > 0 ? value : -1
}

const checked = (formData: FormData, name: string) => readString(formData, name) === 'on'

async function tenant<T>(
  fn: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    actor: Awaited<ReturnType<typeof requireActorContext>>['actor'],
  ) => Promise<T>,
): Promise<T> {
  const { actor } = await requireActorContext()
  return withTenant(actor.organizationId, (tx) => fn(tx, actor))
}

async function run(
  work: Parameters<typeof tenant>[0],
  success: string,
  fallback: string,
): Promise<ActionState> {
  try {
    await tenant(work)
  } catch (error) {
    return fail(error, fallback)
  }
  refresh()
  return { status: 'success', message: success }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function readTask(formData: FormData): TaskInput {
  const amount = Number(readString(formData, 'offsetAmount') || '0')
  const direction = readString(formData, 'offsetDirection')
  return {
    title: readString(formData, 'title'),
    instructions: readString(formData, 'instructions'),
    required: checked(formData, 'required'),
    responseType: readString(formData, 'responseType'),
    timingAnchor: readString(formData, 'timingAnchor'),
    offsetMinutes: Number.isInteger(amount)
      ? direction === 'before'
        ? -amount
        : amount
      : Number.NaN,
    requiresVerification: checked(formData, 'requiresVerification'),
    shared: checked(formData, 'shared'),
  }
}

export async function createTemplateAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let templateId: string
  try {
    templateId = await tenant((tx, actor) =>
      createTemplate(tx, actor, {
        name: readString(formData, 'name'),
        kind: readString(formData, 'kind'),
        locationIds: readIds(formData, 'locationIds'),
      }),
    )
  } catch (error) {
    return fail(error, 'The template could not be created.')
  }
  refresh()
  redirect(`/app/operations/templates/${templateId}`)
}

export async function updateDraftDetailsAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) =>
      updateDraftDetails(tx, actor, readId(formData, 'versionId'), {
        name: readString(formData, 'name'),
        kind: readString(formData, 'kind'),
        description: readString(formData, 'description'),
      }),
    'Details saved.',
    'The details could not be saved.',
  )
}

export async function setDraftTargetsAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) =>
      setDraftTargets(tx, actor, readId(formData, 'versionId'), {
        locationIds: readIds(formData, 'locationIds'),
        jobRoleIds: readIds(formData, 'jobRoleIds'),
        stationIds: readIds(formData, 'stationIds'),
      }),
    'Who this applies to is saved.',
    'That could not be saved.',
  )
}

export async function addSectionAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      addSection(tx, actor, readId(formData, 'versionId'), readString(formData, 'title')),
    'Section added.',
    'The section could not be added.',
  )
}

export async function renameSectionAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) =>
      renameSection(tx, actor, readId(formData, 'sectionId'), readString(formData, 'title')),
    'Section renamed.',
    'The section could not be renamed.',
  )
}

export async function removeSectionAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) => removeSection(tx, actor, readId(formData, 'sectionId')),
    'Section removed.',
    'The section could not be removed.',
  )
}

export async function moveSectionAction(formData: FormData): Promise<void> {
  try {
    await tenant((tx, actor) =>
      moveSection(
        tx,
        actor,
        readId(formData, 'sectionId'),
        readString(formData, 'direction') === 'up' ? 'up' : 'down',
      ),
    )
  } catch {
    // The page shows the order as it is; a refused move changes nothing.
  }
  refresh()
}

export async function addTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) => addTask(tx, actor, readId(formData, 'sectionId'), readTask(formData)),
    'Task added.',
    'The task could not be added.',
  )
}

export async function updateTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) => updateTask(tx, actor, readId(formData, 'taskId'), readTask(formData)),
    'Task saved.',
    'The task could not be saved.',
  )
}

export async function removeTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) => removeTask(tx, actor, readId(formData, 'taskId')),
    'Task removed.',
    'The task could not be removed.',
  )
}

export async function moveTaskAction(formData: FormData): Promise<void> {
  try {
    await tenant((tx, actor) =>
      moveTask(
        tx,
        actor,
        readId(formData, 'taskId'),
        readString(formData, 'direction') === 'up' ? 'up' : 'down',
      ),
    )
  } catch {
    // As above.
  }
  refresh()
}

export async function publishDraftAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const result = await tenant((tx, actor) =>
      publishDraft(tx, actor, readId(formData, 'versionId'), readString(formData, 'changeNote')),
    )
    refresh()
    const shifts = result.shiftsWithNewWork
    return {
      status: 'success',
      message:
        `Version ${result.versionNumber} published.` +
        (shifts > 0
          ? ` ${shifts} upcoming ${shifts === 1 ? 'shift now has' : 'shifts now have'} this work.`
          : ' Shifts published from now on will include it.'),
    }
  } catch (error) {
    return fail(error, 'The template could not be published.')
  }
}

export async function startNewDraftAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) => startNewDraft(tx, actor, readId(formData, 'templateId')).then(() => undefined),
    'New draft started. Nothing changes for anyone until you publish it.',
    'A new draft could not be started.',
  )
}

export async function discardDraftAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) => discardDraft(tx, actor, readId(formData, 'versionId')),
    'Draft discarded.',
    'The draft could not be discarded.',
  )
}

export async function archiveTemplateAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) => archiveTemplate(tx, actor, readId(formData, 'templateId')),
    'Template archived. Shifts that already have this work keep it.',
    'The template could not be archived.',
  )
}

export async function restoreTemplateAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) => restoreTemplate(tx, actor, readId(formData, 'templateId')),
    'Template restored.',
    'The template could not be restored.',
  )
}

// ---------------------------------------------------------------------------
// The employee's work
// ---------------------------------------------------------------------------

export async function completeTaskAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const result = await tenant((tx, actor) =>
      completeTask(tx, actor, readId(formData, 'itemId'), {
        revision: readRevision(formData),
        text: readString(formData, 'responseText'),
        number: readString(formData, 'responseNumber'),
      }),
    )
    refresh()
    return {
      status: 'success',
      message: result.status === 'done' ? 'Done.' : 'Sent to a manager to verify.',
    }
  } catch (error) {
    return fail(error, 'That could not be saved.')
  }
}

export async function skipTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      skipTask(tx, actor, readId(formData, 'itemId'), {
        revision: readRevision(formData),
        reason: readString(formData, 'reason'),
      }),
    'Skipped. Your manager can see why.',
    'That could not be saved.',
  )
}

export async function blockTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      blockTask(tx, actor, readId(formData, 'itemId'), {
        revision: readRevision(formData),
        reason: readString(formData, 'reason'),
      }),
    'Marked blocked. Your manager can see what is stopping you.',
    'That could not be saved.',
  )
}

export async function unblockTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      unblockTask(tx, actor, readId(formData, 'itemId'), { revision: readRevision(formData) }),
    'No longer blocked.',
    'That could not be saved.',
  )
}

export async function undoTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      undoTask(tx, actor, readId(formData, 'itemId'), { revision: readRevision(formData) }),
    'Undone. It is back on your list.',
    'That could not be undone.',
  )
}

export async function completeHandoffTaskAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) =>
      completeHandoffTask(tx, actor, readId(formData, 'itemId'), {
        revision: readRevision(formData),
        nothingToHandOver: readString(formData, 'nothing') === 'yes',
        category: readString(formData, 'category'),
        priority: readString(formData, 'priority'),
        title: readString(formData, 'title'),
        body: readString(formData, 'body'),
      }).then(() => undefined),
    'Handoff saved. The next shift will see it.',
    'The handoff could not be saved.',
  )
}

// ---------------------------------------------------------------------------
// The manager's board
// ---------------------------------------------------------------------------

export async function verifyTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      verifyTask(tx, actor, readId(formData, 'itemId'), { revision: readRevision(formData) }),
    'Verified.',
    'That could not be verified.',
  )
}

export async function returnTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      returnTask(tx, actor, readId(formData, 'itemId'), {
        revision: readRevision(formData),
        note: readString(formData, 'note'),
      }),
    'Sent back with your note.',
    'That could not be sent back.',
  )
}

export async function reassignTaskAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) =>
      reassignTask(tx, actor, readId(formData, 'itemId'), {
        revision: readRevision(formData),
        toEmploymentId: readId(formData, 'toEmploymentId'),
        note: readString(formData, 'note'),
      }),
    'Reassigned. They have been told.',
    'That could not be reassigned.',
  )
}

export async function reopenTaskAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) =>
      reopenTask(tx, actor, readId(formData, 'itemId'), {
        revision: readRevision(formData),
        note: readString(formData, 'note'),
      }),
    'Reopened.',
    'That could not be reopened.',
  )
}

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export async function createHandoffAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const shiftId = readString(formData, 'shiftId')
  return run(
    (tx, actor) =>
      createHandoff(tx, actor, {
        locationId: readId(formData, 'locationId'),
        shiftId: isUuid(shiftId) ? shiftId : null,
        category: readString(formData, 'category'),
        priority: readString(formData, 'priority'),
        title: readString(formData, 'title'),
        body: readString(formData, 'body'),
      }).then(() => undefined),
    'Handoff left for the next shift.',
    'The handoff could not be saved.',
  )
}

export async function acknowledgeHandoffAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) => acknowledgeHandoff(tx, actor, readId(formData, 'handoffId')),
    'Marked as read.',
    'That could not be saved.',
  )
}

export async function resolveHandoffAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) =>
      resolveHandoff(tx, actor, readId(formData, 'handoffId'), readString(formData, 'note')),
    'Handoff resolved.',
    'The handoff could not be resolved.',
  )
}

export async function reopenHandoffAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) => reopenHandoff(tx, actor, readId(formData, 'handoffId')),
    'Handoff reopened.',
    'The handoff could not be reopened.',
  )
}
