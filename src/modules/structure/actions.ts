'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { createDepartment, createJobRole, createStation, createValue } from './service'

export interface StructureActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function fail(error: unknown, fallback: string): StructureActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to change the structure.' }
  }
  if (error instanceof NotFoundError)
    return { status: 'error', message: 'That does not exist here.' }
  return { status: 'error', message: fallback }
}

const nameSchema = z.string().trim().min(2, 'Give it a name of at least 2 characters').max(80)

export async function createDepartmentAction(
  _previous: StructureActionState,
  formData: FormData,
): Promise<StructureActionState> {
  const { actor } = await requireActorContext()
  const parsed = z
    .object({ name: nameSchema, description: z.string().trim().max(200).optional() })
    .safeParse({ name: formData.get('name'), description: formData.get('description') ?? '' })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  try {
    await withTenant(actor.organizationId, (tx) => createDepartment(tx, actor, parsed.data))
    revalidatePath('/app/settings/structure')
    return { status: 'success', message: `Added ${parsed.data.name}.` }
  } catch (error) {
    return fail(error, 'We could not add that department.')
  }
}

export async function createJobRoleAction(
  _previous: StructureActionState,
  formData: FormData,
): Promise<StructureActionState> {
  const { actor } = await requireActorContext()
  const parsed = z
    .object({
      name: nameSchema,
      description: z.string().trim().max(200).optional(),
      departmentId: z.union([z.uuid(), z.literal('')]).optional(),
      colorToken: z.string().trim().max(20).optional(),
    })
    .safeParse({
      name: formData.get('name'),
      description: formData.get('description') ?? '',
      departmentId: formData.get('departmentId') ?? '',
      colorToken: formData.get('colorToken') ?? 'violet',
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
      createJobRole(tx, actor, {
        name: parsed.data.name,
        description: parsed.data.description,
        departmentId: parsed.data.departmentId || null,
        colorToken: parsed.data.colorToken,
      }),
    )
    revalidatePath('/app/settings/structure')
    return { status: 'success', message: `Added ${parsed.data.name}.` }
  } catch (error) {
    return fail(error, 'We could not add that job role.')
  }
}

export async function createStationAction(
  _previous: StructureActionState,
  formData: FormData,
): Promise<StructureActionState> {
  const { actor } = await requireActorContext()
  const parsed = z
    .object({
      name: nameSchema,
      locationId: z.uuid('Choose a location'),
      jobRoleId: z.union([z.uuid(), z.literal('')]).optional(),
      description: z.string().trim().max(200).optional(),
    })
    .safeParse({
      name: formData.get('name'),
      locationId: formData.get('locationId'),
      jobRoleId: formData.get('jobRoleId') ?? '',
      description: formData.get('description') ?? '',
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
      createStation(tx, actor, {
        name: parsed.data.name,
        locationId: parsed.data.locationId,
        jobRoleId: parsed.data.jobRoleId || null,
        description: parsed.data.description,
      }),
    )
    revalidatePath('/app/settings/structure')
    return { status: 'success', message: `Added ${parsed.data.name}.` }
  } catch (error) {
    return fail(error, 'We could not add that work position.')
  }
}

export async function createValueAction(
  _previous: StructureActionState,
  formData: FormData,
): Promise<StructureActionState> {
  const { actor } = await requireActorContext()
  const parsed = z
    .object({
      kind: z.enum(['value', 'standard']),
      title: z.string().trim().min(3, 'Give it a title').max(120),
      body: z.string().trim().min(10, 'Say what it means in practice').max(600),
    })
    .safeParse({
      kind: formData.get('kind'),
      title: formData.get('title'),
      body: formData.get('body'),
    })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  try {
    await withTenant(actor.organizationId, (tx) => createValue(tx, actor, parsed.data))
    revalidatePath('/app/settings/values')
    return { status: 'success', message: 'Added.' }
  } catch (error) {
    return fail(error, 'We could not add that.')
  }
}
