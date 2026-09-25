'use server'

import { demoRestriction } from '@/server/demo'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import {
  addLocationAssignment,
  changeContactDetails,
  changeJobTitle,
  changeManager,
  grantRole,
  removeLocationAssignment,
  revokeRoleGrant,
  setEmploymentStatus,
} from './employment-service'
import {
  approveSeparation,
  cancelSeparation,
  completeSeparation,
  requestSeparation,
  SEPARATION_REASON_CATEGORIES,
} from './separation-service'
import { recordCredential } from './service'
import { assignOnboarding } from '@/modules/onboarding/service'

/**
 * Employment server actions.
 *
 * Every action resolves the actor from the SESSION, never from client input,
 * then validates, then calls a service that authorizes. A client cannot choose
 * which organization it acts on or who it acts as.
 */

export interface ActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to do that.' }
  }
  if (error instanceof NotFoundError) {
    return { status: 'error', message: 'We could not find that record.' }
  }
  return { status: 'error', message: fallback }
}

async function run(
  employmentId: string,
  work: (ctx: Awaited<ReturnType<typeof requireActorContext>>) => Promise<string>,
  fallback: string,
): Promise<ActionState> {
  const ctx = await requireActorContext()
  try {
    const message = await work(ctx)
    revalidatePath(`/app/people/${employmentId}`)
    revalidatePath('/app/people')
    revalidatePath('/app/onboarding')
    revalidatePath('/app')
    return { status: 'success', message }
  } catch (error) {
    return toState(error, fallback)
  }
}

const jobTitleSchema = z.object({
  employmentId: z.uuid(),
  jobTitle: z.string().trim().max(120, 'Job titles are limited to 120 characters'),
})

export async function changeJobTitleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = jobTitleSchema.safeParse({
    employmentId: formData.get('employmentId'),
    jobTitle: formData.get('jobTitle') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  return run(
    parsed.data.employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        changeJobTitle(tx, actor, parsed.data.employmentId, parsed.data.jobTitle),
      )
      return 'Job title updated.'
    },
    'We could not update the job title.',
  )
}

const contactSchema = z.object({
  employmentId: z.uuid(),
  phone: z.string().trim().max(40, 'That phone number is too long').optional(),
  emergencyContactName: z.string().trim().max(120, 'That name is too long').optional(),
  emergencyContactPhone: z.string().trim().max(40, 'That phone number is too long').optional(),
  dateOfBirth: z.string().trim().max(10).optional(),
})

/**
 * Used by a manager on someone's profile and by a person on their own. The
 * service decides which of those the caller is; this only shapes the input.
 */
export async function changeContactDetailsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const refusal = demoRestriction()
  if (refusal) return refusal
  const parsed = contactSchema.safeParse({
    employmentId: formData.get('employmentId'),
    phone: formData.get('phone') ?? undefined,
    emergencyContactName: formData.get('emergencyContactName') ?? undefined,
    emergencyContactPhone: formData.get('emergencyContactPhone') ?? undefined,
    dateOfBirth: formData.get('dateOfBirth') ?? undefined,
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  const { employmentId, ...fields } = parsed.data
  const state = await run(
    employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        changeContactDetails(tx, actor, employmentId, fields),
      )
      return 'Contact details saved.'
    },
    'We could not save those contact details.',
  )
  // The person's own profile lives on the employee side.
  revalidatePath('/my/profile')
  return state
}

const managerSchema = z.object({
  employmentId: z.uuid(),
  managerEmploymentId: z.union([z.uuid(), z.literal('')]),
})

export async function changeManagerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = managerSchema.safeParse({
    employmentId: formData.get('employmentId'),
    managerEmploymentId: formData.get('managerEmploymentId') ?? '',
  })
  if (!parsed.success) {
    return { status: 'error', message: 'Please check the form.' }
  }
  return run(
    parsed.data.employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        changeManager(tx, actor, parsed.data.employmentId, parsed.data.managerEmploymentId || null),
      )
      return 'Reporting line updated.'
    },
    'We could not update the reporting line.',
  )
}

const locationSchema = z.object({
  employmentId: z.uuid(),
  locationId: z.uuid(),
  intent: z.enum(['add', 'remove']),
})

export async function changeLocationAssignmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = locationSchema.safeParse({
    employmentId: formData.get('employmentId'),
    locationId: formData.get('locationId'),
    intent: formData.get('intent'),
  })
  if (!parsed.success) return { status: 'error', message: 'Please choose a location.' }

  return run(
    parsed.data.employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        parsed.data.intent === 'add'
          ? addLocationAssignment(tx, actor, parsed.data.employmentId, parsed.data.locationId)
          : removeLocationAssignment(tx, actor, parsed.data.employmentId, parsed.data.locationId),
      )
      return parsed.data.intent === 'add' ? 'Location added.' : 'Location removed.'
    },
    'We could not update location assignments.',
  )
}

const statusSchema = z.object({
  employmentId: z.uuid(),
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().min(5, 'Record why access is changing'),
})

export async function changeEmploymentStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted
  const parsed = statusSchema.safeParse({
    employmentId: formData.get('employmentId'),
    status: formData.get('status'),
    reason: formData.get('reason') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  return run(
    parsed.data.employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        setEmploymentStatus(
          tx,
          actor,
          parsed.data.employmentId,
          parsed.data.status,
          parsed.data.reason,
        ),
      )
      return parsed.data.status === 'suspended' ? 'Access suspended.' : 'Access restored.'
    },
    'We could not change access.',
  )
}

const grantSchema = z.object({
  employmentId: z.uuid(),
  roleKey: z.string().min(1),
  scope: z.enum(['org', 'location']),
  locationId: z.union([z.uuid(), z.literal('')]),
})

export async function grantRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted
  const parsed = grantSchema.safeParse({
    employmentId: formData.get('employmentId'),
    roleKey: formData.get('roleKey'),
    scope: formData.get('scope'),
    locationId: formData.get('locationId') ?? '',
  })
  if (!parsed.success) return { status: 'error', message: 'Please choose a role and scope.' }

  return run(
    parsed.data.employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        grantRole(
          tx,
          actor,
          parsed.data.employmentId,
          parsed.data.roleKey,
          parsed.data.scope,
          parsed.data.locationId || null,
        ),
      )
      return 'Role granted.'
    },
    'We could not grant that role.',
  )
}

export async function revokeRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted
  const employmentId = readString(formData, 'employmentId', '')
  const grantId = readString(formData, 'grantId', '')
  return run(
    employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) => revokeRoleGrant(tx, actor, grantId))
      return 'Role revoked.'
    },
    'We could not revoke that role.',
  )
}

const credentialSchema = z.object({
  employmentId: z.uuid(),
  name: z.string().trim().min(2, 'Name the credential'),
  issuingAuthority: z.string().trim().max(120).optional(),
  identifier: z.string().trim().max(120).optional(),
  issuedOn: z.union([z.iso.date(), z.literal('')]).optional(),
  expiresOn: z.union([z.iso.date(), z.literal('')]).optional(),
})

export async function recordCredentialAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentialSchema.safeParse({
    employmentId: formData.get('employmentId'),
    name: formData.get('name'),
    issuingAuthority: formData.get('issuingAuthority') ?? '',
    identifier: formData.get('identifier') ?? '',
    issuedOn: formData.get('issuedOn') ?? '',
    expiresOn: formData.get('expiresOn') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  return run(
    parsed.data.employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        recordCredential(tx, actor, parsed.data.employmentId, {
          name: parsed.data.name,
          issuingAuthority: parsed.data.issuingAuthority,
          identifier: parsed.data.identifier,
          issuedOn: parsed.data.issuedOn || null,
          expiresOn: parsed.data.expiresOn || null,
        }),
      )
      return 'Credential recorded.'
    },
    'We could not record that credential.',
  )
}

export async function startOnboardingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const employmentId = readString(formData, 'employmentId', '')
  return run(
    employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) => assignOnboarding(tx, actor, employmentId))
      return 'Onboarding started.'
    },
    'We could not start onboarding.',
  )
}

// --- separation ------------------------------------------------------------

const separationSchema = z.object({
  employmentId: z.uuid(),
  reasonCategory: z.enum(SEPARATION_REASON_CATEGORIES),
  reason: z.string().trim().min(10, 'Record why this employment is ending'),
  effectiveOn: z.iso.date('Choose the effective date'),
  /** Typed confirmation. A separation is never one careless click. */
  confirmation: z.string(),
})

export async function requestSeparationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted
  const expected = readString(formData, 'expectedConfirmation', '')
  const parsed = separationSchema.safeParse({
    employmentId: formData.get('employmentId'),
    reasonCategory: formData.get('reasonCategory'),
    reason: formData.get('reason') ?? '',
    effectiveOn: formData.get('effectiveOn') ?? '',
    confirmation: formData.get('confirmation') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }
  if (parsed.data.confirmation.trim() !== expected.trim() || expected.trim() === '') {
    return {
      status: 'error',
      message: 'Type the employee name exactly to confirm.',
      fieldErrors: { confirmation: ['That does not match the name shown.'] },
    }
  }

  return run(
    parsed.data.employmentId,
    async ({ actor }) => {
      await withTenant(actor.organizationId, (tx) =>
        requestSeparation(tx, actor, {
          employmentId: parsed.data.employmentId,
          reasonCategory: parsed.data.reasonCategory,
          reason: parsed.data.reason,
          effectiveOn: parsed.data.effectiveOn,
        }),
      )
      return 'Separation filed. It now needs a second person to approve it, and can be cancelled until then.'
    },
    'We could not file that separation.',
  )
}

export async function separationDecisionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted
  const employmentId = readString(formData, 'employmentId', '')
  const separationId = readString(formData, 'separationId', '')
  const intent = readString(formData, 'intent', '')

  return run(
    employmentId,
    async ({ actor }) => {
      return withTenant(actor.organizationId, async (tx) => {
        switch (intent) {
          case 'approve':
            await approveSeparation(tx, actor, separationId)
            return 'Separation approved. Completing it will revoke access.'
          case 'complete':
            await completeSeparation(tx, actor, separationId)
            return 'Separation completed and access revoked.'
          case 'cancel':
            await cancelSeparation(
              tx,
              actor,
              separationId,
              readString(formData, 'reason', 'Cancelled'),
            )
            return 'Separation cancelled. Nothing has changed for this employee.'
          default:
            throw new ValidationError({}, 'Unknown action')
        }
      })
    },
    'We could not update that separation.',
  )
}
