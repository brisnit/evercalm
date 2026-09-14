'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { ONBOARDING_RESPONSIBILITIES, ONBOARDING_STEP_KINDS, DUE_DATE_BASES } from './schema'
import {
  addSection,
  addStep,
  archiveTemplate,
  createDraftVersion,
  createTemplate,
  deleteSection,
  deleteStep,
  duplicateTemplate,
  publishVersion,
  reorder,
  restoreTemplate,
  setTemplateTargeting,
  updateSection,
  updateStep,
  updateTemplateMeta,
} from './templates'

/**
 * Onboarding template authoring actions.
 *
 * Every one resolves the actor from the session and calls a service that
 * authorizes and enforces the draft/published rule. A client cannot edit a
 * published version by posting directly, because `requireDraftVersion` runs
 * server-side regardless of what the interface offered.
 */

export interface TemplateActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function fail(error: unknown, fallback: string): TemplateActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to manage onboarding.' }
  }
  if (error instanceof NotFoundError) {
    return { status: 'error', message: 'We could not find that.' }
  }
  return { status: 'error', message: fallback }
}

function revalidateTemplate(templateId?: string): void {
  revalidatePath('/app/onboarding/templates')
  if (templateId) {
    revalidatePath(`/app/onboarding/templates/${templateId}`)
    revalidatePath(`/app/onboarding/templates/${templateId}/preview`)
  }
  revalidatePath('/app/onboarding')
  revalidatePath('/app/setup')
}

// --- template lifecycle ----------------------------------------------------

export async function createTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const parsed = z
    .object({
      name: z.string().trim().min(2, 'Give the checklist a name').max(120),
      description: z.string().trim().max(400).optional(),
    })
    .safeParse({
      name: readString(formData, 'name'),
      description: readString(formData, 'description'),
    })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  let templateId: string
  try {
    const created = await withTenant(actor.organizationId, (tx) =>
      createTemplate(tx, actor, parsed.data),
    )
    templateId = created.templateId
  } catch (error) {
    return fail(error, 'We could not create that checklist.')
  }

  revalidateTemplate(templateId)
  redirect(`/app/onboarding/templates/${templateId}`)
}

export async function updateTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const parsed = z
    .object({
      name: z.string().trim().min(2, 'Give the checklist a name').max(120),
      description: z.string().trim().max(400).optional(),
      isDefault: z.boolean(),
    })
    .safeParse({
      name: readString(formData, 'name'),
      description: readString(formData, 'description'),
      isDefault: readString(formData, 'isDefault') === 'on',
    })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  try {
    await withTenant(actor.organizationId, (tx) =>
      updateTemplateMeta(tx, actor, templateId, parsed.data),
    )
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Saved.' }
  } catch (error) {
    return fail(error, 'We could not save those details.')
  }
}

export async function setTargetingAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const jobRoleIds = formData.getAll('jobRoleIds').filter((v): v is string => typeof v === 'string')
  const locationIds = formData
    .getAll('locationIds')
    .filter((v): v is string => typeof v === 'string')

  try {
    await withTenant(actor.organizationId, (tx) =>
      setTemplateTargeting(tx, actor, templateId, { jobRoleIds, locationIds }),
    )
    revalidateTemplate(templateId)
    return {
      status: 'success',
      message:
        jobRoleIds.length === 0 && locationIds.length === 0
          ? 'This checklist now applies to anyone without a more specific match.'
          : 'Saved who this checklist applies to.',
    }
  } catch (error) {
    return fail(error, 'We could not save that targeting.')
  }
}

export async function publishVersionAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const versionId = readString(formData, 'versionId')

  try {
    await withTenant(actor.organizationId, (tx) => publishVersion(tx, actor, versionId))
    revalidateTemplate(templateId)
    return {
      status: 'success',
      message:
        'Published. New hires from now on get this version; anyone already onboarding stays on the version they started.',
    }
  } catch (error) {
    return fail(error, 'We could not publish that version.')
  }
}

export async function createDraftAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')

  try {
    await withTenant(actor.organizationId, (tx) => createDraftVersion(tx, actor, templateId))
    revalidateTemplate(templateId)
    return {
      status: 'success',
      message: 'New draft started from the published version. Nothing live has changed.',
    }
  } catch (error) {
    return fail(error, 'We could not start a draft.')
  }
}

export async function duplicateTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')

  let newId: string
  try {
    newId = await withTenant(actor.organizationId, (tx) => duplicateTemplate(tx, actor, templateId))
  } catch (error) {
    return fail(error, 'We could not duplicate that checklist.')
  }

  revalidateTemplate(newId)
  redirect(`/app/onboarding/templates/${newId}`)
}

export async function archiveTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const intent = readString(formData, 'intent')

  try {
    await withTenant(actor.organizationId, (tx) =>
      intent === 'restore'
        ? restoreTemplate(tx, actor, templateId)
        : archiveTemplate(tx, actor, templateId),
    )
    revalidateTemplate(templateId)
    return {
      status: 'success',
      message:
        intent === 'restore'
          ? 'Restored. It can be assigned again.'
          : 'Archived. Nobody new will be assigned it, and everyone already onboarding keeps their checklist.',
    }
  } catch (error) {
    return fail(error, 'We could not change that checklist.')
  }
}

// --- sections --------------------------------------------------------------

export async function addSectionAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const versionId = readString(formData, 'versionId')
  const title = readString(formData, 'title')

  try {
    await withTenant(actor.organizationId, (tx) => addSection(tx, actor, versionId, title))
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Section added.' }
  } catch (error) {
    return fail(error, 'We could not add that section.')
  }
}

export async function updateSectionAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const sectionId = readString(formData, 'sectionId')

  try {
    await withTenant(actor.organizationId, (tx) =>
      updateSection(tx, actor, sectionId, {
        title: readString(formData, 'title'),
        description: readString(formData, 'description'),
      }),
    )
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Section updated.' }
  } catch (error) {
    return fail(error, 'We could not update that section.')
  }
}

export async function deleteSectionAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const sectionId = readString(formData, 'sectionId')

  try {
    await withTenant(actor.organizationId, (tx) => deleteSection(tx, actor, sectionId))
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Section removed.' }
  } catch (error) {
    return fail(error, 'We could not remove that section.')
  }
}

// --- steps -----------------------------------------------------------------

const stepSchema = z.object({
  title: z.string().trim().min(2, 'Give the step a title').max(200),
  instructions: z.string().trim().max(1000).optional(),
  kind: z.enum(ONBOARDING_STEP_KINDS),
  responsibility: z.enum(ONBOARDING_RESPONSIBILITIES),
  required: z.boolean(),
  dueOffsetDays: z.union([z.coerce.number().int().min(0).max(365), z.literal('')]).optional(),
  dueOffsetBasis: z.enum(DUE_DATE_BASES),
  requiresManagerVerification: z.boolean(),
  blocksCompletion: z.boolean(),
  courseId: z.string().trim().max(64).optional(),
})

function parseStep(formData: FormData) {
  return stepSchema.safeParse({
    courseId: readString(formData, 'courseId'),
    title: readString(formData, 'title'),
    instructions: readString(formData, 'instructions'),
    kind: readString(formData, 'kind'),
    responsibility: readString(formData, 'responsibility'),
    required: readString(formData, 'required') === 'on',
    dueOffsetDays: readString(formData, 'dueOffsetDays'),
    dueOffsetBasis: readString(formData, 'dueOffsetBasis') || 'onboarding_start',
    requiresManagerVerification: readString(formData, 'requiresManagerVerification') === 'on',
    blocksCompletion: readString(formData, 'blocksCompletion') === 'on',
  })
}

export async function addStepAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const sectionId = readString(formData, 'sectionId')
  const parsed = parseStep(formData)
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the step.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  try {
    await withTenant(actor.organizationId, (tx) =>
      addStep(tx, actor, sectionId, {
        ...parsed.data,
        dueOffsetDays:
          parsed.data.dueOffsetDays === '' ? null : (parsed.data.dueOffsetDays ?? null),
      }),
    )
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Step added.' }
  } catch (error) {
    return fail(error, 'We could not add that step.')
  }
}

export async function updateStepAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const stepId = readString(formData, 'stepId')
  const parsed = parseStep(formData)
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the step.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  try {
    await withTenant(actor.organizationId, (tx) =>
      updateStep(tx, actor, stepId, {
        ...parsed.data,
        dueOffsetDays:
          parsed.data.dueOffsetDays === '' ? null : (parsed.data.dueOffsetDays ?? null),
      }),
    )
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Step saved.' }
  } catch (error) {
    return fail(error, 'We could not save that step.')
  }
}

export async function deleteStepAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const stepId = readString(formData, 'stepId')

  try {
    await withTenant(actor.organizationId, (tx) => deleteStep(tx, actor, stepId))
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Step removed.' }
  } catch (error) {
    return fail(error, 'We could not remove that step.')
  }
}

export async function reorderAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const { actor } = await requireActorContext()
  const templateId = readString(formData, 'templateId')
  const kind = readString(formData, 'reorderKind') === 'section' ? 'section' : 'step'
  const direction = readString(formData, 'direction') === 'up' ? 'up' : 'down'
  const id = readString(formData, 'reorderId')

  try {
    await withTenant(actor.organizationId, (tx) => reorder(tx, actor, { kind, id, direction }))
    revalidateTemplate(templateId)
    return { status: 'success', message: 'Order updated.' }
  } catch (error) {
    return fail(error, 'We could not reorder that.')
  }
}
