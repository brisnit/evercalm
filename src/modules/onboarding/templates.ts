import { and, asc, count, eq, inArray, isNull, max } from 'drizzle-orm'
import {
  jobRoles,
  locations,
  onboardingAssignments,
  onboardingSections,
  onboardingSteps,
  onboardingTemplateJobRoles,
  onboardingTemplateLocations,
  onboardingTemplateVersions,
  onboardingTemplates,
} from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { authorize } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import {
  DUE_DATE_BASES,
  ONBOARDING_RESPONSIBILITIES,
  ONBOARDING_STEP_KINDS,
  type DueDateBasis,
  type OnboardingResponsibility,
  type OnboardingStepKind,
} from './schema'

/**
 * ONBOARDING TEMPLATE AUTHORING.
 *
 * The invariants this module exists to enforce:
 *
 *  1. **A published version is immutable.** Every content mutation calls
 *     `requireDraftVersion`, which refuses anything that is not a draft. To
 *     change a live checklist you create a new draft version, which copies the
 *     published content, and publish that.
 *  2. **In-progress runs never change.** An assignment points at a version id.
 *     Publishing v2 leaves everyone on v1 exactly where they were.
 *  3. **A draft cannot be assigned.** `resolveTemplateForAssignment` only ever
 *     considers templates with `status = 'published'` and a
 *     `published_version_id`, so an unfinished checklist cannot reach a new
 *     hire by accident.
 *  4. **Archiving hides, never deletes.** Historical runs keep their frozen
 *     name and their version rows.
 */

export const STEP_KIND_LABELS: Record<OnboardingStepKind, string> = {
  information: 'Information to read',
  employee_task: 'Employee task',
  manager_task: 'Manager task',
  document_request: 'Document request',
  policy_ack: 'Policy acknowledgement',
  training_assignment: 'Training assignment',
  practical_verification: 'Practical verification',
  credential_requirement: 'Credential or licence',
}

export const RESPONSIBILITY_LABELS: Record<OnboardingResponsibility, string> = {
  employee: 'The employee',
  manager: 'Their manager',
  hr: 'HR',
  training_manager: 'Training manager',
}

/**
 * Kinds whose backing system has not shipped. An administrator can configure
 * them today; they surface as waiting on EverCalm rather than as something the
 * new hire failed to do.
 */
export const UNRESOLVED_KINDS = new Set<string>(['training_assignment', 'policy_ack'])

/** Kinds that only a manager can ever complete. */
export const MANAGER_ONLY_KINDS = new Set<string>(['practical_verification', 'manager_task'])

export interface TemplateSummary {
  id: string
  name: string
  description: string
  status: string
  isDefault: boolean
  publishedVersionNumber: number | null
  draftVersionNumber: number | null
  hasDraft: boolean
  stepCount: number
  jobRoleNames: string[]
  locationNames: string[]
  assignedCount: number
  archivedAt: Date | null
}

export interface StepDetail {
  id: string
  sectionId: string
  title: string
  instructions: string
  kind: string
  responsibility: string
  required: boolean
  position: number
  dueOffsetDays: number | null
  dueOffsetBasis: string
  requiresManagerVerification: boolean
  blocksCompletion: boolean
  awaitingPlatform: boolean
}

export interface SectionDetail {
  id: string
  title: string
  description: string
  position: number
  steps: StepDetail[]
}

export interface VersionDetail {
  id: string
  versionNumber: number
  status: string
  publishedAt: Date | null
  sections: SectionDetail[]
}

export interface TemplateDetail {
  id: string
  name: string
  description: string
  status: string
  isDefault: boolean
  archivedAt: Date | null
  jobRoleIds: string[]
  locationIds: string[]
  publishedVersion: VersionDetail | null
  draftVersion: VersionDetail | null
  /** Runs currently attached to each version, so impact is visible. */
  runsByVersion: Record<string, number>
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTemplates(
  tx: Tx,
  actor: Actor,
  options: { includeArchived?: boolean } = {},
): Promise<TemplateSummary[]> {
  authorize(actor, 'onboarding.manage')

  const templates = await tx
    .select({
      id: onboardingTemplates.id,
      name: onboardingTemplates.name,
      description: onboardingTemplates.description,
      status: onboardingTemplates.status,
      isDefault: onboardingTemplates.isDefault,
      publishedVersionId: onboardingTemplates.publishedVersionId,
      archivedAt: onboardingTemplates.archivedAt,
    })
    .from(onboardingTemplates)
    .where(
      options.includeArchived
        ? eq(onboardingTemplates.organizationId, actor.organizationId)
        : and(
            eq(onboardingTemplates.organizationId, actor.organizationId),
            isNull(onboardingTemplates.archivedAt),
          ),
    )
    .orderBy(asc(onboardingTemplates.name))

  if (templates.length === 0) return []
  const ids = templates.map((t) => t.id)

  const versions = await tx
    .select({
      id: onboardingTemplateVersions.id,
      templateId: onboardingTemplateVersions.templateId,
      versionNumber: onboardingTemplateVersions.versionNumber,
      status: onboardingTemplateVersions.status,
    })
    .from(onboardingTemplateVersions)
    .where(
      and(
        eq(onboardingTemplateVersions.organizationId, actor.organizationId),
        inArray(onboardingTemplateVersions.templateId, ids),
      ),
    )

  const stepCounts = await tx
    .select({ versionId: onboardingSteps.versionId, total: count() })
    .from(onboardingSteps)
    .where(eq(onboardingSteps.organizationId, actor.organizationId))
    .groupBy(onboardingSteps.versionId)
  const stepsByVersion = new Map(stepCounts.map((s) => [s.versionId, s.total]))

  const roleRows = await tx
    .select({ templateId: onboardingTemplateJobRoles.templateId, name: jobRoles.name })
    .from(onboardingTemplateJobRoles)
    .innerJoin(
      jobRoles,
      and(
        eq(jobRoles.id, onboardingTemplateJobRoles.jobRoleId),
        eq(jobRoles.organizationId, onboardingTemplateJobRoles.organizationId),
      ),
    )
    .where(eq(onboardingTemplateJobRoles.organizationId, actor.organizationId))

  const locationRows = await tx
    .select({ templateId: onboardingTemplateLocations.templateId, name: locations.name })
    .from(onboardingTemplateLocations)
    .innerJoin(
      locations,
      and(
        eq(locations.id, onboardingTemplateLocations.locationId),
        eq(locations.organizationId, onboardingTemplateLocations.organizationId),
      ),
    )
    .where(eq(onboardingTemplateLocations.organizationId, actor.organizationId))

  const assignmentCounts = await tx
    .select({ templateId: onboardingAssignments.templateId, total: count() })
    .from(onboardingAssignments)
    .where(eq(onboardingAssignments.organizationId, actor.organizationId))
    .groupBy(onboardingAssignments.templateId)
  const assignedByTemplate = new Map(assignmentCounts.map((a) => [a.templateId, a.total]))

  return templates.map((t) => {
    const mine = versions.filter((v) => v.templateId === t.id)
    const published = mine.find((v) => v.id === t.publishedVersionId)
    const draft = mine.find((v) => v.status === 'draft')
    const countingVersion = published ?? draft
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      status: t.status,
      isDefault: t.isDefault,
      publishedVersionNumber: published?.versionNumber ?? null,
      draftVersionNumber: draft?.versionNumber ?? null,
      hasDraft: draft !== undefined,
      stepCount: countingVersion ? (stepsByVersion.get(countingVersion.id) ?? 0) : 0,
      jobRoleNames: roleRows.filter((r) => r.templateId === t.id).map((r) => r.name),
      locationNames: locationRows.filter((r) => r.templateId === t.id).map((r) => r.name),
      assignedCount: assignedByTemplate.get(t.id) ?? 0,
      archivedAt: t.archivedAt,
    }
  })
}

async function loadVersionDetail(
  tx: Tx,
  actor: Actor,
  version: { id: string; versionNumber: number; status: string; publishedAt: Date | null },
): Promise<VersionDetail> {
  const sections = await tx
    .select({
      id: onboardingSections.id,
      title: onboardingSections.title,
      description: onboardingSections.description,
      position: onboardingSections.position,
    })
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.versionId, version.id),
      ),
    )
    .orderBy(asc(onboardingSections.position))

  const steps = await tx
    .select()
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.versionId, version.id),
      ),
    )
    .orderBy(asc(onboardingSteps.position))

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    publishedAt: version.publishedAt,
    sections: sections.map((section) => ({
      ...section,
      steps: steps
        .filter((s) => s.sectionId === section.id)
        .map((s) => ({
          id: s.id,
          sectionId: s.sectionId,
          title: s.title,
          instructions: s.instructions,
          kind: s.kind,
          responsibility: s.responsibility,
          required: s.required,
          position: s.position,
          dueOffsetDays: s.dueOffsetDays,
          dueOffsetBasis: s.dueOffsetBasis,
          requiresManagerVerification: s.requiresManagerVerification,
          blocksCompletion: s.blocksCompletion,
          awaitingPlatform: UNRESOLVED_KINDS.has(s.kind),
        })),
    })),
  }
}

export async function getTemplate(
  tx: Tx,
  actor: Actor,
  templateId: string,
): Promise<TemplateDetail> {
  authorize(actor, 'onboarding.manage')

  const [template] = await tx
    .select()
    .from(onboardingTemplates)
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.id, templateId),
      ),
    )
    .limit(1)
  // A template belonging to another tenant is indistinguishable from one that
  // does not exist.
  if (!template) throw new NotFoundError('Onboarding checklist not found')

  const versions = await tx
    .select()
    .from(onboardingTemplateVersions)
    .where(
      and(
        eq(onboardingTemplateVersions.organizationId, actor.organizationId),
        eq(onboardingTemplateVersions.templateId, templateId),
      ),
    )
    .orderBy(asc(onboardingTemplateVersions.versionNumber))

  const published = versions.find((v) => v.id === template.publishedVersionId)
  const draft = versions.find((v) => v.status === 'draft')

  const runs = await tx
    .select({ versionId: onboardingAssignments.templateVersionId, total: count() })
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, actor.organizationId),
        eq(onboardingAssignments.templateId, templateId),
      ),
    )
    .groupBy(onboardingAssignments.templateVersionId)

  const roleIds = await tx
    .select({ jobRoleId: onboardingTemplateJobRoles.jobRoleId })
    .from(onboardingTemplateJobRoles)
    .where(
      and(
        eq(onboardingTemplateJobRoles.organizationId, actor.organizationId),
        eq(onboardingTemplateJobRoles.templateId, templateId),
      ),
    )

  const locationIds = await tx
    .select({ locationId: onboardingTemplateLocations.locationId })
    .from(onboardingTemplateLocations)
    .where(
      and(
        eq(onboardingTemplateLocations.organizationId, actor.organizationId),
        eq(onboardingTemplateLocations.templateId, templateId),
      ),
    )

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: template.status,
    isDefault: template.isDefault,
    archivedAt: template.archivedAt,
    jobRoleIds: roleIds.map((r) => r.jobRoleId),
    locationIds: locationIds.map((r) => r.locationId),
    publishedVersion: published ? await loadVersionDetail(tx, actor, published) : null,
    draftVersion: draft ? await loadVersionDetail(tx, actor, draft) : null,
    runsByVersion: Object.fromEntries(runs.map((r) => [r.versionId, r.total])),
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * The single gate protecting published content. Every content mutation goes
 * through it, so "a published version is immutable" is enforced in one place
 * rather than remembered in twelve.
 */
async function requireDraftVersion(tx: Tx, actor: Actor, versionId: string) {
  const [version] = await tx
    .select()
    .from(onboardingTemplateVersions)
    .where(
      and(
        eq(onboardingTemplateVersions.organizationId, actor.organizationId),
        eq(onboardingTemplateVersions.id, versionId),
      ),
    )
    .limit(1)
  if (!version) throw new NotFoundError('Version not found')
  if (version.status !== 'draft') {
    throw new ValidationError(
      {},
      'This version is published and cannot be changed. Create a new draft to make edits.',
    )
  }
  return version
}

async function touchTemplate(tx: Tx, actor: Actor, templateId: string): Promise<void> {
  await tx
    .update(onboardingTemplates)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.id, templateId),
      ),
    )
}

// ---------------------------------------------------------------------------
// Template lifecycle
// ---------------------------------------------------------------------------

export async function createTemplate(
  tx: Tx,
  actor: Actor,
  input: { name: string; description?: string },
): Promise<{ templateId: string; versionId: string }> {
  authorize(actor, 'onboarding.manage')

  const name = input.name.trim()
  if (name.length < 2) {
    throw new ValidationError({ name: ['Give the checklist a name.'] }, 'Name required')
  }

  const templateId = newId()
  const versionId = newId()

  // A new template starts as a DRAFT with no published version, so it cannot
  // be assigned to anyone until somebody publishes it.
  await tx.insert(onboardingTemplates).values({
    id: templateId,
    organizationId: actor.organizationId,
    name,
    description: input.description?.trim() ?? '',
    status: 'draft',
  })

  await tx.insert(onboardingTemplateVersions).values({
    id: versionId,
    organizationId: actor.organizationId,
    templateId,
    versionNumber: 1,
    status: 'draft',
    templateName: name,
  })

  await tx.insert(onboardingSections).values({
    id: newId(),
    organizationId: actor.organizationId,
    versionId,
    title: 'First week',
    position: 0,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_CREATED,
    summary: `Created the "${name}" onboarding checklist`,
    subjectType: 'onboarding_template',
    subjectId: templateId,
  })

  return { templateId, versionId }
}

export async function updateTemplateMeta(
  tx: Tx,
  actor: Actor,
  templateId: string,
  input: { name?: string; description?: string; isDefault?: boolean },
): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const existing = await getTemplateRow(tx, actor, templateId)

  const name = input.name?.trim()
  if (name !== undefined && name.length < 2) {
    throw new ValidationError({ name: ['Give the checklist a name.'] }, 'Name required')
  }

  // Only one default per organization; a partial unique index also enforces it.
  if (input.isDefault === true) {
    await tx
      .update(onboardingTemplates)
      .set({ isDefault: false })
      .where(
        and(
          eq(onboardingTemplates.organizationId, actor.organizationId),
          eq(onboardingTemplates.isDefault, true),
        ),
      )
  }

  await tx
    .update(onboardingTemplates)
    .set({
      name: name ?? existing.name,
      description: input.description?.trim() ?? existing.description,
      isDefault: input.isDefault ?? existing.isDefault,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.id, templateId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_UPDATED,
    summary: `Updated the "${name ?? existing.name}" onboarding checklist`,
    subjectType: 'onboarding_template',
    subjectId: templateId,
  })
}

async function getTemplateRow(tx: Tx, actor: Actor, templateId: string) {
  const [row] = await tx
    .select()
    .from(onboardingTemplates)
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.id, templateId),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Onboarding checklist not found')
  return row
}

/**
 * Which job roles and locations this checklist applies to.
 *
 * Every id is validated against THIS tenant. RLS guarantees it too, but
 * validating here produces a usable error rather than a foreign-key failure,
 * and makes the cross-tenant refusal explicit and testable.
 */
export async function setTemplateTargeting(
  tx: Tx,
  actor: Actor,
  templateId: string,
  input: { jobRoleIds: string[]; locationIds: string[] },
): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const template = await getTemplateRow(tx, actor, templateId)

  const validRoles = await tx
    .select({ id: jobRoles.id })
    .from(jobRoles)
    .where(eq(jobRoles.organizationId, actor.organizationId))
  const validRoleIds = new Set(validRoles.map((r) => r.id))
  for (const id of input.jobRoleIds) {
    if (!validRoleIds.has(id)) throw new NotFoundError('Unknown job role')
  }

  const validLocations = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.organizationId, actor.organizationId))
  const validLocationIds = new Set(validLocations.map((l) => l.id))
  for (const id of input.locationIds) {
    if (!validLocationIds.has(id)) throw new NotFoundError('Unknown location')
  }

  // A location-scoped administrator may only target locations they manage.
  const reachable = accessibleLocationsFor(actor)
  if (reachable !== null) {
    for (const id of input.locationIds) {
      if (!reachable.includes(id)) {
        throw new ValidationError(
          { locationIds: ['You can only target locations you manage.'] },
          'Location out of scope',
        )
      }
    }
  }

  await tx
    .delete(onboardingTemplateJobRoles)
    .where(
      and(
        eq(onboardingTemplateJobRoles.organizationId, actor.organizationId),
        eq(onboardingTemplateJobRoles.templateId, templateId),
      ),
    )
  for (const jobRoleId of input.jobRoleIds) {
    await tx.insert(onboardingTemplateJobRoles).values({
      id: newId(),
      organizationId: actor.organizationId,
      templateId,
      jobRoleId,
    })
  }

  await tx
    .delete(onboardingTemplateLocations)
    .where(
      and(
        eq(onboardingTemplateLocations.organizationId, actor.organizationId),
        eq(onboardingTemplateLocations.templateId, templateId),
      ),
    )
  for (const locationId of input.locationIds) {
    await tx.insert(onboardingTemplateLocations).values({
      id: newId(),
      organizationId: actor.organizationId,
      templateId,
      locationId,
    })
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_TARGETING_CHANGED,
    summary: `Changed who the "${template.name}" checklist applies to`,
    subjectType: 'onboarding_template',
    subjectId: templateId,
    metadata: { jobRoles: input.jobRoleIds.length, locations: input.locationIds.length },
  })
}

/**
 * `onboarding.manage` is organization-scoped, so this is normally null. It
 * exists so a future location-scoped grant narrows targeting correctly rather
 * than silently allowing it.
 */
function accessibleLocationsFor(actor: Actor): string[] | null {
  for (const grant of actor.grants) {
    if (!grant.capabilities.has('onboarding.manage')) continue
    if (grant.scope === 'org') return null
  }
  const scoped = actor.grants
    .filter((g) => g.capabilities.has('onboarding.manage') && g.locationId)
    .map((g) => g.locationId as string)
  return scoped.length > 0 ? scoped : null
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function publishVersion(tx: Tx, actor: Actor, versionId: string): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const version = await requireDraftVersion(tx, actor, versionId)
  const template = await getTemplateRow(tx, actor, version.templateId)

  const steps = await tx
    .select({ id: onboardingSteps.id })
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.versionId, versionId),
      ),
    )
  if (steps.length === 0) {
    throw new ValidationError(
      { steps: ['Add at least one step before publishing.'] },
      'Add at least one step before publishing.',
    )
  }

  await tx
    .update(onboardingTemplateVersions)
    .set({
      status: 'published',
      publishedAt: new Date(),
      publishedByEmploymentId: actor.employmentId,
      templateName: template.name,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingTemplateVersions.organizationId, actor.organizationId),
        eq(onboardingTemplateVersions.id, versionId),
      ),
    )

  await tx
    .update(onboardingTemplates)
    .set({ publishedVersionId: versionId, status: 'published', updatedAt: new Date() })
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.id, version.templateId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_PUBLISHED,
    summary: `Published version ${version.versionNumber} of "${template.name}"`,
    subjectType: 'onboarding_template',
    subjectId: version.templateId,
    metadata: { versionId, versionNumber: version.versionNumber, steps: steps.length },
  })
}

/**
 * Start a new draft from the published version.
 *
 * Deep-copies sections and steps, so the published version and every run
 * attached to it are untouched.
 */
export async function createDraftVersion(
  tx: Tx,
  actor: Actor,
  templateId: string,
): Promise<string> {
  authorize(actor, 'onboarding.manage')
  const template = await getTemplateRow(tx, actor, templateId)

  const existingDraft = await tx
    .select({ id: onboardingTemplateVersions.id })
    .from(onboardingTemplateVersions)
    .where(
      and(
        eq(onboardingTemplateVersions.organizationId, actor.organizationId),
        eq(onboardingTemplateVersions.templateId, templateId),
        eq(onboardingTemplateVersions.status, 'draft'),
      ),
    )
    .limit(1)
  if (existingDraft[0]) return existingDraft[0].id

  const [highest] = await tx
    .select({ highest: max(onboardingTemplateVersions.versionNumber) })
    .from(onboardingTemplateVersions)
    .where(
      and(
        eq(onboardingTemplateVersions.organizationId, actor.organizationId),
        eq(onboardingTemplateVersions.templateId, templateId),
      ),
    )

  const nextNumber = (highest?.highest ?? 0) + 1
  const draftId = newId()

  await tx.insert(onboardingTemplateVersions).values({
    id: draftId,
    organizationId: actor.organizationId,
    templateId,
    versionNumber: nextNumber,
    status: 'draft',
    templateName: template.name,
  })

  if (template.publishedVersionId) {
    await copyVersionContent(tx, actor, template.publishedVersionId, draftId)
  } else {
    await tx.insert(onboardingSections).values({
      id: newId(),
      organizationId: actor.organizationId,
      versionId: draftId,
      title: 'First week',
      position: 0,
    })
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_DRAFTED,
    summary: `Started draft version ${nextNumber} of "${template.name}"`,
    subjectType: 'onboarding_template',
    subjectId: templateId,
    metadata: { versionId: draftId, versionNumber: nextNumber },
  })

  return draftId
}

async function copyVersionContent(
  tx: Tx,
  actor: Actor,
  fromVersionId: string,
  toVersionId: string,
): Promise<void> {
  const sections = await tx
    .select()
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.versionId, fromVersionId),
      ),
    )
    .orderBy(asc(onboardingSections.position))

  const steps = await tx
    .select()
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.versionId, fromVersionId),
      ),
    )
    .orderBy(asc(onboardingSteps.position))

  for (const section of sections) {
    const newSectionId = newId()
    await tx.insert(onboardingSections).values({
      id: newSectionId,
      organizationId: actor.organizationId,
      versionId: toVersionId,
      title: section.title,
      description: section.description,
      position: section.position,
    })

    for (const step of steps.filter((s) => s.sectionId === section.id)) {
      await tx.insert(onboardingSteps).values({
        id: newId(),
        organizationId: actor.organizationId,
        versionId: toVersionId,
        sectionId: newSectionId,
        title: step.title,
        instructions: step.instructions,
        kind: step.kind,
        responsibility: step.responsibility,
        required: step.required,
        position: step.position,
        dueOffsetDays: step.dueOffsetDays,
        dueOffsetBasis: step.dueOffsetBasis,
        requiresManagerVerification: step.requiresManagerVerification,
        blocksCompletion: step.blocksCompletion,
        referenceType: step.referenceType,
        referenceId: step.referenceId,
      })
    }
  }
}

export async function duplicateTemplate(tx: Tx, actor: Actor, templateId: string): Promise<string> {
  authorize(actor, 'onboarding.manage')
  const source = await getTemplateRow(tx, actor, templateId)
  const sourceVersionId =
    source.publishedVersionId ??
    (
      await tx
        .select({ id: onboardingTemplateVersions.id })
        .from(onboardingTemplateVersions)
        .where(
          and(
            eq(onboardingTemplateVersions.organizationId, actor.organizationId),
            eq(onboardingTemplateVersions.templateId, templateId),
          ),
        )
        .orderBy(asc(onboardingTemplateVersions.versionNumber))
        .limit(1)
    )[0]?.id

  const newTemplateId = newId()
  const newVersionId = newId()
  const name = `${source.name} (copy)`

  // A copy always starts as an unpublished draft, whatever the original was.
  await tx.insert(onboardingTemplates).values({
    id: newTemplateId,
    organizationId: actor.organizationId,
    name,
    description: source.description,
    status: 'draft',
    isDefault: false,
  })

  await tx.insert(onboardingTemplateVersions).values({
    id: newVersionId,
    organizationId: actor.organizationId,
    templateId: newTemplateId,
    versionNumber: 1,
    status: 'draft',
    templateName: name,
  })

  if (sourceVersionId) {
    await copyVersionContent(tx, actor, sourceVersionId, newVersionId)
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_DUPLICATED,
    summary: `Duplicated "${source.name}" as "${name}"`,
    subjectType: 'onboarding_template',
    subjectId: newTemplateId,
    metadata: { copiedFrom: templateId },
  })

  return newTemplateId
}

export async function archiveTemplate(tx: Tx, actor: Actor, templateId: string): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const template = await getTemplateRow(tx, actor, templateId)
  if (template.archivedAt) return

  await tx
    .update(onboardingTemplates)
    .set({
      archivedAt: new Date(),
      archivedByEmploymentId: actor.employmentId,
      status: 'archived',
      isDefault: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.id, templateId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_ARCHIVED,
    summary: `Archived the "${template.name}" onboarding checklist`,
    subjectType: 'onboarding_template',
    subjectId: templateId,
  })
}

export async function restoreTemplate(tx: Tx, actor: Actor, templateId: string): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const template = await getTemplateRow(tx, actor, templateId)
  if (!template.archivedAt) return

  await tx
    .update(onboardingTemplates)
    .set({
      archivedAt: null,
      archivedByEmploymentId: null,
      // Restoring never silently republishes: it returns to published only if
      // a published version still exists.
      status: template.publishedVersionId ? 'published' : 'draft',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.id, templateId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_TEMPLATE_RESTORED,
    summary: `Restored the "${template.name}" onboarding checklist`,
    subjectType: 'onboarding_template',
    subjectId: templateId,
  })
}

// ---------------------------------------------------------------------------
// Sections and steps (draft versions only)
// ---------------------------------------------------------------------------

export async function addSection(
  tx: Tx,
  actor: Actor,
  versionId: string,
  title: string,
): Promise<string> {
  authorize(actor, 'onboarding.manage')
  const version = await requireDraftVersion(tx, actor, versionId)
  if (title.trim().length < 2) {
    throw new ValidationError({ title: ['Give the section a name.'] }, 'Name required')
  }

  const existing = await tx
    .select({ total: count() })
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.versionId, versionId),
      ),
    )

  const id = newId()
  await tx.insert(onboardingSections).values({
    id,
    organizationId: actor.organizationId,
    versionId,
    title: title.trim(),
    position: existing[0]?.total ?? 0,
  })
  await touchTemplate(tx, actor, version.templateId)
  return id
}

export async function updateSection(
  tx: Tx,
  actor: Actor,
  sectionId: string,
  input: { title?: string; description?: string },
): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const [section] = await tx
    .select()
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.id, sectionId),
      ),
    )
    .limit(1)
  if (!section) throw new NotFoundError('Section not found')
  await requireDraftVersion(tx, actor, section.versionId)

  await tx
    .update(onboardingSections)
    .set({
      title: input.title?.trim() ?? section.title,
      description: input.description?.trim() ?? section.description,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.id, sectionId),
      ),
    )
}

export async function deleteSection(tx: Tx, actor: Actor, sectionId: string): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const [section] = await tx
    .select()
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.id, sectionId),
      ),
    )
    .limit(1)
  if (!section) throw new NotFoundError('Section not found')
  await requireDraftVersion(tx, actor, section.versionId)

  const remaining = await tx
    .select({ total: count() })
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.versionId, section.versionId),
      ),
    )
  if ((remaining[0]?.total ?? 0) <= 1) {
    throw new ValidationError({}, 'A checklist needs at least one section.')
  }

  // Steps cascade with the section.
  await tx
    .delete(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.id, sectionId),
      ),
    )
}

export interface StepInput {
  title: string
  instructions?: string
  kind: OnboardingStepKind
  responsibility: OnboardingResponsibility
  required: boolean
  dueOffsetDays?: number | null
  dueOffsetBasis?: DueDateBasis
  requiresManagerVerification?: boolean
  blocksCompletion?: boolean
}

function validateStep(input: StepInput): void {
  const errors: Record<string, string[]> = {}
  if (input.title.trim().length < 2) errors.title = ['Give the step a title.']
  if (!ONBOARDING_STEP_KINDS.includes(input.kind)) errors.kind = ['Choose a step type.']
  if (!ONBOARDING_RESPONSIBILITIES.includes(input.responsibility)) {
    errors.responsibility = ['Choose who is responsible.']
  }
  if (input.dueOffsetBasis && !DUE_DATE_BASES.includes(input.dueOffsetBasis)) {
    errors.dueOffsetBasis = ['Choose what the due date counts from.']
  }
  if (input.dueOffsetDays !== null && input.dueOffsetDays !== undefined) {
    if (
      !Number.isInteger(input.dueOffsetDays) ||
      input.dueOffsetDays < 0 ||
      input.dueOffsetDays > 365
    ) {
      errors.dueOffsetDays = ['Use a whole number of days between 0 and 365.']
    }
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors, 'Please check the step')
}

export async function addStep(
  tx: Tx,
  actor: Actor,
  sectionId: string,
  input: StepInput,
): Promise<string> {
  authorize(actor, 'onboarding.manage')
  validateStep(input)

  const [section] = await tx
    .select()
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.id, sectionId),
      ),
    )
    .limit(1)
  if (!section) throw new NotFoundError('Section not found')
  const version = await requireDraftVersion(tx, actor, section.versionId)

  const existing = await tx
    .select({ total: count() })
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.versionId, section.versionId),
      ),
    )

  const id = newId()
  await tx.insert(onboardingSteps).values({
    id,
    organizationId: actor.organizationId,
    versionId: section.versionId,
    sectionId,
    title: input.title.trim(),
    instructions: input.instructions?.trim() ?? '',
    kind: input.kind,
    responsibility: input.responsibility,
    required: input.required,
    position: existing[0]?.total ?? 0,
    dueOffsetDays: input.dueOffsetDays ?? null,
    dueOffsetBasis: input.dueOffsetBasis ?? 'onboarding_start',
    requiresManagerVerification: input.requiresManagerVerification ?? false,
    blocksCompletion: input.blocksCompletion ?? true,
  })

  await touchTemplate(tx, actor, version.templateId)
  return id
}

export async function updateStep(
  tx: Tx,
  actor: Actor,
  stepId: string,
  input: StepInput,
): Promise<void> {
  authorize(actor, 'onboarding.manage')
  validateStep(input)

  const [step] = await tx
    .select()
    .from(onboardingSteps)
    .where(
      and(eq(onboardingSteps.organizationId, actor.organizationId), eq(onboardingSteps.id, stepId)),
    )
    .limit(1)
  if (!step) throw new NotFoundError('Step not found')
  await requireDraftVersion(tx, actor, step.versionId)

  await tx
    .update(onboardingSteps)
    .set({
      title: input.title.trim(),
      instructions: input.instructions?.trim() ?? '',
      kind: input.kind,
      responsibility: input.responsibility,
      required: input.required,
      dueOffsetDays: input.dueOffsetDays ?? null,
      dueOffsetBasis: input.dueOffsetBasis ?? 'onboarding_start',
      requiresManagerVerification: input.requiresManagerVerification ?? false,
      blocksCompletion: input.blocksCompletion ?? true,
      updatedAt: new Date(),
    })
    .where(
      and(eq(onboardingSteps.organizationId, actor.organizationId), eq(onboardingSteps.id, stepId)),
    )
}

export async function deleteStep(tx: Tx, actor: Actor, stepId: string): Promise<void> {
  authorize(actor, 'onboarding.manage')
  const [step] = await tx
    .select()
    .from(onboardingSteps)
    .where(
      and(eq(onboardingSteps.organizationId, actor.organizationId), eq(onboardingSteps.id, stepId)),
    )
    .limit(1)
  if (!step) throw new NotFoundError('Step not found')
  await requireDraftVersion(tx, actor, step.versionId)

  await tx
    .delete(onboardingSteps)
    .where(
      and(eq(onboardingSteps.organizationId, actor.organizationId), eq(onboardingSteps.id, stepId)),
    )
}

/** Move a step or section up or down within its parent. */
export async function reorder(
  tx: Tx,
  actor: Actor,
  target: { kind: 'section' | 'step'; id: string; direction: 'up' | 'down' },
): Promise<void> {
  authorize(actor, 'onboarding.manage')

  if (target.kind === 'section') {
    const [section] = await tx
      .select()
      .from(onboardingSections)
      .where(
        and(
          eq(onboardingSections.organizationId, actor.organizationId),
          eq(onboardingSections.id, target.id),
        ),
      )
      .limit(1)
    if (!section) throw new NotFoundError('Section not found')
    await requireDraftVersion(tx, actor, section.versionId)

    const siblings = await tx
      .select({ id: onboardingSections.id, position: onboardingSections.position })
      .from(onboardingSections)
      .where(
        and(
          eq(onboardingSections.organizationId, actor.organizationId),
          eq(onboardingSections.versionId, section.versionId),
        ),
      )
      .orderBy(asc(onboardingSections.position))

    const index = siblings.findIndex((s) => s.id === target.id)
    const swapWith = target.direction === 'up' ? siblings[index - 1] : siblings[index + 1]
    if (!swapWith) return

    // Normalise positions rather than trusting stored values, so a sequence
    // with gaps or duplicates still reorders predictably.
    const ordered = [...siblings]
    ordered.splice(index, 1)
    ordered.splice(target.direction === 'up' ? index - 1 : index + 1, 0, siblings[index]!)
    for (const [position, row] of ordered.entries()) {
      await tx
        .update(onboardingSections)
        .set({ position })
        .where(
          and(
            eq(onboardingSections.organizationId, actor.organizationId),
            eq(onboardingSections.id, row.id),
          ),
        )
    }
    return
  }

  const [step] = await tx
    .select()
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.id, target.id),
      ),
    )
    .limit(1)
  if (!step) throw new NotFoundError('Step not found')
  await requireDraftVersion(tx, actor, step.versionId)

  const siblings = await tx
    .select({ id: onboardingSteps.id, position: onboardingSteps.position })
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.sectionId, step.sectionId),
      ),
    )
    .orderBy(asc(onboardingSteps.position))

  const index = siblings.findIndex((s) => s.id === target.id)
  const neighbour = target.direction === 'up' ? siblings[index - 1] : siblings[index + 1]
  if (!neighbour) return

  const ordered = [...siblings]
  ordered.splice(index, 1)
  ordered.splice(target.direction === 'up' ? index - 1 : index + 1, 0, siblings[index]!)
  for (const [position, row] of ordered.entries()) {
    await tx
      .update(onboardingSteps)
      .set({ position })
      .where(
        and(
          eq(onboardingSteps.organizationId, actor.organizationId),
          eq(onboardingSteps.id, row.id),
        ),
      )
  }
}

/**
 * What assigning this template would do, shown before an administrator
 * archives or replaces a published version.
 */
export async function templateImpact(
  tx: Tx,
  actor: Actor,
  templateId: string,
): Promise<{ activeRuns: number; completedRuns: number; targetedRoles: number }> {
  authorize(actor, 'onboarding.manage')

  const rows = await tx
    .select({
      completed: onboardingAssignments.completedAt,
    })
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, actor.organizationId),
        eq(onboardingAssignments.templateId, templateId),
      ),
    )

  const roles = await tx
    .select({ total: count() })
    .from(onboardingTemplateJobRoles)
    .where(
      and(
        eq(onboardingTemplateJobRoles.organizationId, actor.organizationId),
        eq(onboardingTemplateJobRoles.templateId, templateId),
      ),
    )

  return {
    activeRuns: rows.filter((r) => r.completed === null).length,
    completedRuns: rows.filter((r) => r.completed !== null).length,
    targetedRoles: roles[0]?.total ?? 0,
  }
}
