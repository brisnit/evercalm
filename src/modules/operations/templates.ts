import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employments, jobRoles, locations, stations } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { accessibleLocationIds, can } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { OPERATIONS_CAPABILITIES, pgErrorCode, UNIQUE_VIOLATION } from './access'
import { generateForUpcomingShifts, loadTargets } from './generation'
import type { Targets } from './rules'
import {
  OPS_RESPONSE_TYPES,
  OPS_TEMPLATE_KINDS,
  OPS_TIMING_ANCHORS,
  opsSections,
  opsTasks,
  opsTemplateVersions,
  opsTemplates,
  opsVersionJobRoles,
  opsVersionLocations,
  opsVersionStations,
  type OpsResponseType,
  type OpsTemplateKind,
  type OpsTimingAnchor,
} from './schema'

/*
 * OPERATIONAL TEMPLATES: pre-shift, opening, side work, station setup, shift
 * duties, closing, handoff.
 *
 * Versioned the way courses are. ONCE A VERSION IS PUBLISHED, IT NEVER
 * CHANGES. Editing a live template starts a new draft that copies the
 * published sections, tasks and targets; publishing the draft makes it what
 * shifts WITHOUT work yet receive. A shift that already has its run keeps the
 * version it was given, so a record of what someone was asked to do on
 * Saturday is still true on Monday.
 *
 * Every content change passes `requireDraft()`, which locks the version and
 * refuses anything that is not a draft of an active template. The triggers in
 * migration 0018 refuse the same again.
 *
 * WHO. `checklist.author` held organization-wide authors anything, including
 * templates for every location. Held at locations, it authors templates that
 * target only those locations: a Riverside manager cannot quietly change the
 * closing checklist Downtown works from. Other operations roles can read
 * templates that apply where they work.
 */

export const LIMITS = {
  name: 80,
  description: 600,
  sectionTitle: 80,
  taskTitle: 140,
  instructions: 1500,
  changeNote: 300,
  sections: 12,
  tasks: 60,
} as const

export interface TaskDetail {
  id: string
  sectionId: string
  position: number
  title: string
  instructions: string
  required: boolean
  responseType: OpsResponseType
  timingAnchor: OpsTimingAnchor
  offsetMinutes: number
  requiresVerification: boolean
  shared: boolean
}

export interface SectionDetail {
  id: string
  title: string
  position: number
  tasks: TaskDetail[]
}

export interface TargetNames {
  locations: { id: string; name: string }[]
  jobRoles: { id: string; name: string }[]
  stations: { id: string; name: string; locationId: string }[]
}

export interface TemplateVersionDetail {
  id: string
  versionNumber: number
  status: 'draft' | 'published'
  name: string
  kind: OpsTemplateKind
  description: string
  changeNote: string
  publishedAt: Date | null
  publishedByName: string | null
  targets: Targets
  targetNames: TargetNames
  sections: SectionDetail[]
  taskCount: number
}

export interface TemplateSummary {
  id: string
  name: string
  kind: OpsTemplateKind
  status: 'active' | 'archived'
  publishedVersionNumber: number | null
  draftVersionNumber: number | null
  taskCount: number
  targetNames: TargetNames
  canEdit: boolean
  updatedAt: Date
}

export interface TemplateDetail {
  id: string
  name: string
  kind: OpsTemplateKind
  status: 'active' | 'archived'
  published: TemplateVersionDetail | null
  draft: TemplateVersionDetail | null
  history: {
    id: string
    versionNumber: number
    publishedAt: Date | null
    publishedByName: string | null
    changeNote: string
  }[]
  canEdit: boolean
}

export interface TemplateOptions {
  locations: { id: string; name: string }[]
  jobRoles: { id: string; name: string }[]
  stations: { id: string; name: string; locationId: string; locationName: string }[]
  /** False for location-scoped authors: they must choose at least one location. */
  mayTargetEveryLocation: boolean
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/** Anyone in operations may read templates that apply somewhere they have access. */
function readScope(actor: Actor): string[] | null {
  const ids = new Set<string>()
  for (const capability of OPERATIONS_CAPABILITIES) {
    const scope = accessibleLocationIds(actor, capability)
    if (scope === null) return null
    for (const id of scope) ids.add(id)
  }
  return [...ids]
}

function canRead(actor: Actor, locationIds: readonly string[]): boolean {
  const scope = readScope(actor)
  if (scope === null) return true
  if (scope.length === 0) return false
  // "Every location" includes the ones this person works at.
  return locationIds.length === 0 || locationIds.some((id) => scope.includes(id))
}

/** May the actor author a template aimed at exactly these locations? */
export function canAuthorFor(actor: Actor, locationIds: readonly string[]): boolean {
  if (can(actor, 'checklist.author')) return true
  if (locationIds.length === 0) return false
  return locationIds.every((locationId) => can(actor, 'checklist.author', { locationId }))
}

function requireAuthorFor(actor: Actor, locationIds: readonly string[]): void {
  if (canAuthorFor(actor, locationIds)) return
  if (canRead(actor, locationIds)) throw new ForbiddenError('checklist.author')
  throw new NotFoundError('Template not found')
}

function requireAnyAuthoring(actor: Actor): void {
  const scope = accessibleLocationIds(actor, 'checklist.author')
  if (scope === null || scope.length > 0) return
  if (readScope(actor)?.length !== 0) throw new ForbiddenError('checklist.author')
  throw new NotFoundError('Template not found')
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const clean = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max)

function nameFrom(raw: string): string {
  const name = clean(raw, LIMITS.name)
  if (!name) throw new ValidationError({ name: ['Give the template a name.'] })
  return name
}

function kindFrom(raw: string): OpsTemplateKind {
  if (!(OPS_TEMPLATE_KINDS as readonly string[]).includes(raw)) {
    throw new ValidationError({ kind: ['Choose what kind of work this is.'] })
  }
  return raw as OpsTemplateKind
}

export interface TaskInput {
  title: string
  instructions: string
  required: boolean
  responseType: string
  timingAnchor: string
  offsetMinutes: number
  requiresVerification: boolean
  shared: boolean
}

function taskFrom(input: TaskInput) {
  const errors: Record<string, string[]> = {}
  const title = clean(input.title, LIMITS.taskTitle)
  if (!title) errors.title = ['Say what needs doing.']
  if (!(OPS_RESPONSE_TYPES as readonly string[]).includes(input.responseType)) {
    errors.responseType = ['Choose how the task is completed.']
  }
  if (!(OPS_TIMING_ANCHORS as readonly string[]).includes(input.timingAnchor)) {
    errors.timingAnchor = ['Choose whether the time counts from the start or the end of the shift.']
  }
  if (!Number.isInteger(input.offsetMinutes) || Math.abs(input.offsetMinutes) > 720) {
    errors.offsetMinutes = ['Enter whole minutes, up to 12 hours before or after.']
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors)
  return {
    title,
    instructions: input.instructions.replace(/\r\n/g, '\n').trim().slice(0, LIMITS.instructions),
    required: input.required,
    responseType: input.responseType,
    timingAnchor: input.timingAnchor,
    offsetMinutes: input.offsetMinutes,
    requiresVerification: input.requiresVerification,
    shared: input.shared,
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function names(tx: Tx, organizationId: string, ids: readonly (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return new Map<string, string>()
  const rows = await tx
    .select({ id: employments.id, name: employments.displayName })
    .from(employments)
    .where(and(eq(employments.organizationId, organizationId), inArray(employments.id, unique)))
  return new Map(rows.map((r) => [r.id, r.name]))
}

async function targetNames(tx: Tx, organizationId: string, targets: Targets): Promise<TargetNames> {
  const [locs, roles, stns] = await Promise.all([
    targets.locationIds.length
      ? tx
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(
            and(
              eq(locations.organizationId, organizationId),
              inArray(locations.id, [...targets.locationIds]),
            ),
          )
          .orderBy(asc(locations.name))
      : [],
    targets.jobRoleIds.length
      ? tx
          .select({ id: jobRoles.id, name: jobRoles.name })
          .from(jobRoles)
          .where(
            and(
              eq(jobRoles.organizationId, organizationId),
              inArray(jobRoles.id, [...targets.jobRoleIds]),
            ),
          )
          .orderBy(asc(jobRoles.name))
      : [],
    targets.stationIds.length
      ? tx
          .select({ id: stations.id, name: stations.name, locationId: stations.locationId })
          .from(stations)
          .where(
            and(
              eq(stations.organizationId, organizationId),
              inArray(stations.id, [...targets.stationIds]),
            ),
          )
          .orderBy(asc(stations.name))
      : [],
  ])
  return { locations: locs, jobRoles: roles, stations: stns }
}

export async function loadSections(
  tx: Tx,
  organizationId: string,
  versionId: string,
): Promise<SectionDetail[]> {
  const [sectionRows, taskRows] = await Promise.all([
    tx
      .select()
      .from(opsSections)
      .where(
        and(eq(opsSections.organizationId, organizationId), eq(opsSections.versionId, versionId)),
      )
      .orderBy(asc(opsSections.position), asc(opsSections.createdAt)),
    tx
      .select()
      .from(opsTasks)
      .where(and(eq(opsTasks.organizationId, organizationId), eq(opsTasks.versionId, versionId)))
      .orderBy(asc(opsTasks.position), asc(opsTasks.createdAt)),
  ])
  return sectionRows.map((section) => ({
    id: section.id,
    title: section.title,
    position: section.position,
    tasks: taskRows
      .filter((t) => t.sectionId === section.id)
      .map((t) => ({
        id: t.id,
        sectionId: t.sectionId,
        position: t.position,
        title: t.title,
        instructions: t.instructions,
        required: t.required,
        responseType: t.responseType as OpsResponseType,
        timingAnchor: t.timingAnchor as OpsTimingAnchor,
        offsetMinutes: t.offsetMinutes,
        requiresVerification: t.requiresVerification,
        shared: t.shared,
      })),
  }))
}

async function versionDetail(
  tx: Tx,
  organizationId: string,
  version: typeof opsTemplateVersions.$inferSelect,
): Promise<TemplateVersionDetail> {
  const targets = (await loadTargets(tx, organizationId, [version.id])).get(version.id)!
  const [sections, targetLabels, publisher] = await Promise.all([
    loadSections(tx, organizationId, version.id),
    targetNames(tx, organizationId, targets),
    names(tx, organizationId, [version.publishedByEmploymentId]),
  ])
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status as 'draft' | 'published',
    name: version.name,
    kind: version.kind as OpsTemplateKind,
    description: version.description,
    changeNote: version.changeNote,
    publishedAt: version.publishedAt,
    publishedByName: version.publishedByEmploymentId
      ? (publisher.get(version.publishedByEmploymentId) ?? null)
      : null,
    targets,
    targetNames: targetLabels,
    sections,
    taskCount: sections.reduce((sum, s) => sum + s.tasks.length, 0),
  }
}

/** The locations that decide who may see and change a template: the draft's, else the published. */
async function governingLocations(
  tx: Tx,
  organizationId: string,
  template: typeof opsTemplates.$inferSelect,
): Promise<string[]> {
  const [draft] = await tx
    .select({ id: opsTemplateVersions.id })
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, organizationId),
        eq(opsTemplateVersions.templateId, template.id),
        eq(opsTemplateVersions.status, 'draft'),
      ),
    )
    .limit(1)
  const versionId = draft?.id ?? template.publishedVersionId
  if (!versionId) return []
  const targets = await loadTargets(tx, organizationId, [versionId])
  return [...(targets.get(versionId)?.locationIds ?? [])]
}

export async function listTemplates(tx: Tx, actor: Actor): Promise<TemplateSummary[]> {
  const scope = readScope(actor)
  if (scope !== null && scope.length === 0) throw new NotFoundError('Template not found')

  const rows = await tx
    .select()
    .from(opsTemplates)
    .where(eq(opsTemplates.organizationId, actor.organizationId))
    .orderBy(asc(opsTemplates.status), asc(opsTemplates.name))
  if (rows.length === 0) return []

  const versions = await tx
    .select()
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, actor.organizationId),
        inArray(
          opsTemplateVersions.templateId,
          rows.map((r) => r.id),
        ),
      ),
    )
  const counts = await tx
    .select({ versionId: opsTasks.versionId, n: sql<number>`count(*)::int` })
    .from(opsTasks)
    .where(eq(opsTasks.organizationId, actor.organizationId))
    .groupBy(opsTasks.versionId)
  const countByVersion = new Map(counts.map((c) => [c.versionId, c.n]))
  const targets = await loadTargets(
    tx,
    actor.organizationId,
    versions.map((v) => v.id),
  )

  const out: TemplateSummary[] = []
  for (const template of rows) {
    const mine = versions.filter((v) => v.templateId === template.id)
    const published = mine.find((v) => v.id === template.publishedVersionId) ?? null
    const draft = mine.find((v) => v.status === 'draft') ?? null
    const governing = draft ?? published
    const locationIds = governing ? [...(targets.get(governing.id)?.locationIds ?? [])] : []
    if (!canRead(actor, locationIds)) continue
    const shown = published ?? draft
    out.push({
      id: template.id,
      name: template.name,
      kind: template.kind as OpsTemplateKind,
      status: template.status as 'active' | 'archived',
      publishedVersionNumber: published?.versionNumber ?? null,
      draftVersionNumber: draft?.versionNumber ?? null,
      taskCount: shown ? (countByVersion.get(shown.id) ?? 0) : 0,
      targetNames: await targetNames(
        tx,
        actor.organizationId,
        targets.get(shown?.id ?? '') ?? { locationIds: [], jobRoleIds: [], stationIds: [] },
      ),
      canEdit: canAuthorFor(actor, locationIds),
      updatedAt: template.updatedAt,
    })
  }
  return out
}

export async function getTemplate(
  tx: Tx,
  actor: Actor,
  templateId: string,
): Promise<TemplateDetail> {
  const [template] = await tx
    .select()
    .from(opsTemplates)
    .where(
      and(eq(opsTemplates.organizationId, actor.organizationId), eq(opsTemplates.id, templateId)),
    )
    .limit(1)
  if (!template) throw new NotFoundError('Template not found')
  const governing = await governingLocations(tx, actor.organizationId, template)
  if (!canRead(actor, governing)) throw new NotFoundError('Template not found')

  const versions = await tx
    .select()
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, actor.organizationId),
        eq(opsTemplateVersions.templateId, templateId),
      ),
    )
    .orderBy(desc(opsTemplateVersions.versionNumber))
  const publishedRow = versions.find((v) => v.id === template.publishedVersionId) ?? null
  const draftRow = versions.find((v) => v.status === 'draft') ?? null
  const publishers = await names(
    tx,
    actor.organizationId,
    versions.map((v) => v.publishedByEmploymentId),
  )

  return {
    id: template.id,
    name: template.name,
    kind: template.kind as OpsTemplateKind,
    status: template.status as 'active' | 'archived',
    published: publishedRow ? await versionDetail(tx, actor.organizationId, publishedRow) : null,
    draft: draftRow ? await versionDetail(tx, actor.organizationId, draftRow) : null,
    history: versions
      .filter((v) => v.status === 'published')
      .map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        publishedAt: v.publishedAt,
        publishedByName: v.publishedByEmploymentId
          ? (publishers.get(v.publishedByEmploymentId) ?? null)
          : null,
        changeNote: v.changeNote,
      })),
    canEdit: canAuthorFor(actor, governing),
  }
}

/** A published version from the history, read-only. */
export async function getTemplateVersion(
  tx: Tx,
  actor: Actor,
  templateId: string,
  versionNumber: number,
): Promise<{ template: TemplateDetail; version: TemplateVersionDetail }> {
  const template = await getTemplate(tx, actor, templateId)
  const [row] = await tx
    .select()
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, actor.organizationId),
        eq(opsTemplateVersions.templateId, templateId),
        eq(opsTemplateVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Version not found')
  return { template, version: await versionDetail(tx, actor.organizationId, row) }
}

/** Everything the builder may offer this author. */
export async function templateOptions(tx: Tx, actor: Actor): Promise<TemplateOptions> {
  requireAnyAuthoring(actor)
  const scope = accessibleLocationIds(actor, 'checklist.author')
  const [locs, roles, stns] = await Promise.all([
    tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(
        and(
          eq(locations.organizationId, actor.organizationId),
          isNull(locations.archivedAt),
          scope === null ? undefined : inArray(locations.id, scope),
        ),
      )
      .orderBy(asc(locations.name)),
    tx
      .select({ id: jobRoles.id, name: jobRoles.name })
      .from(jobRoles)
      .where(and(eq(jobRoles.organizationId, actor.organizationId), isNull(jobRoles.archivedAt)))
      .orderBy(asc(jobRoles.position), asc(jobRoles.name)),
    tx
      .select({
        id: stations.id,
        name: stations.name,
        locationId: stations.locationId,
        locationName: locations.name,
      })
      .from(stations)
      .innerJoin(
        locations,
        and(
          eq(locations.organizationId, stations.organizationId),
          eq(locations.id, stations.locationId),
        ),
      )
      .where(
        and(
          eq(stations.organizationId, actor.organizationId),
          isNull(stations.archivedAt),
          scope === null ? undefined : inArray(stations.locationId, scope),
        ),
      )
      .orderBy(asc(locations.name), asc(stations.position), asc(stations.name)),
  ])
  return {
    locations: locs,
    jobRoles: roles,
    stations: stns,
    mayTargetEveryLocation: scope === null,
  }
}

// ---------------------------------------------------------------------------
// Creating and drafting
// ---------------------------------------------------------------------------

async function validLocationIds(tx: Tx, actor: Actor, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  const rows = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.organizationId, actor.organizationId), inArray(locations.id, unique)))
  if (rows.length !== unique.length) {
    throw new ValidationError({ locationIds: ['Choose locations from the list.'] })
  }
  return unique
}

export async function createTemplate(
  tx: Tx,
  actor: Actor,
  input: { name: string; kind: string; locationIds: readonly string[] },
): Promise<string> {
  requireAnyAuthoring(actor)
  const name = nameFrom(input.name)
  const kind = kindFrom(input.kind)
  const locationIds = await validLocationIds(tx, actor, input.locationIds)
  if (!canAuthorFor(actor, locationIds)) {
    throw new ValidationError({
      locationIds: [
        locationIds.length === 0
          ? 'Choose the locations this is for. You can build templates only for locations you manage.'
          : 'You can build templates only for locations you manage.',
      ],
    })
  }

  const templateId = newId()
  const versionId = newId()
  try {
    await tx.insert(opsTemplates).values({
      id: templateId,
      organizationId: actor.organizationId,
      name,
      kind,
      createdByEmploymentId: actor.employmentId,
    })
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError({ name: ['There is already a template with this name.'] })
    }
    throw error
  }
  await tx.insert(opsTemplateVersions).values({
    id: versionId,
    organizationId: actor.organizationId,
    templateId,
    versionNumber: 1,
    name,
    kind,
    createdByEmploymentId: actor.employmentId,
  })
  if (locationIds.length > 0) {
    await tx.insert(opsVersionLocations).values(
      locationIds.map((locationId) => ({
        id: newId(),
        organizationId: actor.organizationId,
        versionId,
        locationId,
      })),
    )
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TEMPLATE_CREATED,
    summary: `Created the operations template "${name}"`,
    subjectType: 'ops_template',
    subjectId: templateId,
    locationId: locationIds.length === 1 ? locationIds[0] : undefined,
  })
  return templateId
}

interface DraftContext {
  version: typeof opsTemplateVersions.$inferSelect
  template: typeof opsTemplates.$inferSelect
  locationIds: string[]
}

/**
 * THE GATE for every content change. Locks the version and refuses anything
 * that is not a draft of an active template this person may author.
 */
async function requireDraft(tx: Tx, actor: Actor, versionId: string): Promise<DraftContext> {
  requireAnyAuthoring(actor)
  const [version] = await tx
    .select()
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, actor.organizationId),
        eq(opsTemplateVersions.id, versionId),
      ),
    )
    .for('update')
    .limit(1)
  if (!version) throw new NotFoundError('Template not found')
  const targets = (await loadTargets(tx, actor.organizationId, [version.id])).get(version.id)!
  requireAuthorFor(actor, targets.locationIds)
  if (version.status !== 'draft') {
    throw new ValidationError(
      {},
      `Version ${version.versionNumber} is published and cannot be changed. Start a new draft to make changes.`,
    )
  }
  const [template] = await tx
    .select()
    .from(opsTemplates)
    .where(
      and(
        eq(opsTemplates.organizationId, actor.organizationId),
        eq(opsTemplates.id, version.templateId),
      ),
    )
    .limit(1)
  if (!template) throw new NotFoundError('Template not found')
  if (template.status !== 'active') {
    throw new ValidationError({}, 'This template is archived. Restore it before changing it.')
  }
  return { version, template, locationIds: [...targets.locationIds] }
}

async function touch(tx: Tx, context: DraftContext): Promise<void> {
  const now = new Date()
  await tx
    .update(opsTemplateVersions)
    .set({ updatedAt: now })
    .where(eq(opsTemplateVersions.id, context.version.id))
  await tx
    .update(opsTemplates)
    .set({ updatedAt: now })
    .where(eq(opsTemplates.id, context.template.id))
}

export async function updateDraftDetails(
  tx: Tx,
  actor: Actor,
  versionId: string,
  input: { name: string; kind: string; description: string },
): Promise<void> {
  const context = await requireDraft(tx, actor, versionId)
  const name = nameFrom(input.name)
  const kind = kindFrom(input.kind)
  const description = input.description.replace(/\r\n/g, '\n').trim().slice(0, LIMITS.description)
  await tx
    .update(opsTemplateVersions)
    .set({ name, kind, description, updatedAt: new Date() })
    .where(eq(opsTemplateVersions.id, versionId))
  // The template's own name follows the draft only until it is first
  // published; afterwards it changes when the new version is published.
  if (!context.template.publishedVersionId) {
    try {
      await tx
        .update(opsTemplates)
        .set({ name, kind, updatedAt: new Date() })
        .where(eq(opsTemplates.id, context.template.id))
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        throw new ValidationError({ name: ['There is already a template with this name.'] })
      }
      throw error
    }
  }
}

export async function setDraftTargets(
  tx: Tx,
  actor: Actor,
  versionId: string,
  input: {
    locationIds: readonly string[]
    jobRoleIds: readonly string[]
    stationIds: readonly string[]
  },
): Promise<void> {
  const context = await requireDraft(tx, actor, versionId)
  const locationIds = await validLocationIds(tx, actor, input.locationIds)
  if (!canAuthorFor(actor, locationIds)) {
    throw new ValidationError({
      locationIds: [
        locationIds.length === 0
          ? 'Choose at least one location. Only someone who manages every location can aim a template at all of them.'
          : 'You can aim templates only at locations you manage.',
      ],
    })
  }
  const jobRoleIds = [...new Set(input.jobRoleIds)]
  if (jobRoleIds.length > 0) {
    const found = await tx
      .select({ id: jobRoles.id })
      .from(jobRoles)
      .where(
        and(eq(jobRoles.organizationId, actor.organizationId), inArray(jobRoles.id, jobRoleIds)),
      )
    if (found.length !== jobRoleIds.length) {
      throw new ValidationError({ jobRoleIds: ['Choose job roles from the list.'] })
    }
  }
  const stationIds = [...new Set(input.stationIds)]
  if (stationIds.length > 0) {
    const found = await tx
      .select({ id: stations.id, locationId: stations.locationId })
      .from(stations)
      .where(
        and(eq(stations.organizationId, actor.organizationId), inArray(stations.id, stationIds)),
      )
    if (found.length !== stationIds.length) {
      throw new ValidationError({ stationIds: ['Choose stations from the list.'] })
    }
    if (locationIds.length > 0 && found.some((s) => !locationIds.includes(s.locationId))) {
      throw new ValidationError({
        stationIds: ['Every station must be at one of the locations you chose.'],
      })
    }
    if (
      !can(actor, 'checklist.author') &&
      found.some((s) => !can(actor, 'checklist.author', { locationId: s.locationId }))
    ) {
      throw new ValidationError({ stationIds: ['Choose stations at locations you manage.'] })
    }
  }

  const org = actor.organizationId
  await tx
    .delete(opsVersionLocations)
    .where(
      and(
        eq(opsVersionLocations.organizationId, org),
        eq(opsVersionLocations.versionId, versionId),
      ),
    )
  await tx
    .delete(opsVersionJobRoles)
    .where(
      and(eq(opsVersionJobRoles.organizationId, org), eq(opsVersionJobRoles.versionId, versionId)),
    )
  await tx
    .delete(opsVersionStations)
    .where(
      and(eq(opsVersionStations.organizationId, org), eq(opsVersionStations.versionId, versionId)),
    )
  if (locationIds.length) {
    await tx
      .insert(opsVersionLocations)
      .values(
        locationIds.map((id) => ({ id: newId(), organizationId: org, versionId, locationId: id })),
      )
  }
  if (jobRoleIds.length) {
    await tx
      .insert(opsVersionJobRoles)
      .values(
        jobRoleIds.map((id) => ({ id: newId(), organizationId: org, versionId, jobRoleId: id })),
      )
  }
  if (stationIds.length) {
    await tx
      .insert(opsVersionStations)
      .values(
        stationIds.map((id) => ({ id: newId(), organizationId: org, versionId, stationId: id })),
      )
  }
  await touch(tx, context)
}

// ---------------------------------------------------------------------------
// Sections and tasks
// ---------------------------------------------------------------------------

export async function addSection(
  tx: Tx,
  actor: Actor,
  versionId: string,
  rawTitle: string,
): Promise<string> {
  const context = await requireDraft(tx, actor, versionId)
  const title = clean(rawTitle, LIMITS.sectionTitle)
  if (!title) throw new ValidationError({ title: ['Give the section a title.'] })
  const [{ count, last } = { count: 0, last: -1 }] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      last: sql<number>`coalesce(max(${opsSections.position}), -1)::int`,
    })
    .from(opsSections)
    .where(
      and(
        eq(opsSections.organizationId, actor.organizationId),
        eq(opsSections.versionId, versionId),
      ),
    )
  if (count >= LIMITS.sections) {
    throw new ValidationError({}, `A template can have up to ${LIMITS.sections} sections.`)
  }
  const id = newId()
  await tx.insert(opsSections).values({
    id,
    organizationId: actor.organizationId,
    versionId,
    title,
    position: last + 1,
  })
  await touch(tx, context)
  return id
}

async function requireDraftSection(tx: Tx, actor: Actor, sectionId: string) {
  requireAnyAuthoring(actor)
  const [section] = await tx
    .select()
    .from(opsSections)
    .where(and(eq(opsSections.organizationId, actor.organizationId), eq(opsSections.id, sectionId)))
    .limit(1)
  if (!section) throw new NotFoundError('Section not found')
  return { ...(await requireDraft(tx, actor, section.versionId)), section }
}

async function requireDraftTask(tx: Tx, actor: Actor, taskId: string) {
  requireAnyAuthoring(actor)
  const [task] = await tx
    .select()
    .from(opsTasks)
    .where(and(eq(opsTasks.organizationId, actor.organizationId), eq(opsTasks.id, taskId)))
    .limit(1)
  if (!task) throw new NotFoundError('Task not found')
  return { ...(await requireDraft(tx, actor, task.versionId)), task }
}

export async function renameSection(
  tx: Tx,
  actor: Actor,
  sectionId: string,
  rawTitle: string,
): Promise<void> {
  const context = await requireDraftSection(tx, actor, sectionId)
  const title = clean(rawTitle, LIMITS.sectionTitle)
  if (!title) throw new ValidationError({ title: ['Give the section a title.'] })
  await tx
    .update(opsSections)
    .set({ title, updatedAt: new Date() })
    .where(eq(opsSections.id, sectionId))
  await touch(tx, context)
}

export async function removeSection(tx: Tx, actor: Actor, sectionId: string): Promise<void> {
  const context = await requireDraftSection(tx, actor, sectionId)
  await tx.delete(opsSections).where(eq(opsSections.id, sectionId))
  await touch(tx, context)
}

export async function moveSection(
  tx: Tx,
  actor: Actor,
  sectionId: string,
  direction: 'up' | 'down',
): Promise<void> {
  const context = await requireDraftSection(tx, actor, sectionId)
  const sections = await loadSections(tx, actor.organizationId, context.version.id)
  const order = sections.map((s) => s.id)
  const index = order.indexOf(sectionId)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || target < 0 || target >= order.length) return
  ;[order[index], order[target]] = [order[target]!, order[index]!]
  for (const [position, id] of order.entries()) {
    await tx.update(opsSections).set({ position }).where(eq(opsSections.id, id))
  }
  await touch(tx, context)
}

export async function addTask(
  tx: Tx,
  actor: Actor,
  sectionId: string,
  input: TaskInput,
): Promise<string> {
  const context = await requireDraftSection(tx, actor, sectionId)
  const values = taskFrom(input)
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(opsTasks)
    .where(
      and(
        eq(opsTasks.organizationId, actor.organizationId),
        eq(opsTasks.versionId, context.version.id),
      ),
    )
  if (count >= LIMITS.tasks) {
    throw new ValidationError({}, `A template can have up to ${LIMITS.tasks} tasks.`)
  }
  const [{ last } = { last: -1 }] = await tx
    .select({ last: sql<number>`coalesce(max(${opsTasks.position}), -1)::int` })
    .from(opsTasks)
    .where(
      and(eq(opsTasks.organizationId, actor.organizationId), eq(opsTasks.sectionId, sectionId)),
    )
  const id = newId()
  await tx.insert(opsTasks).values({
    id,
    organizationId: actor.organizationId,
    versionId: context.version.id,
    sectionId,
    position: last + 1,
    ...values,
  })
  await touch(tx, context)
  return id
}

export async function updateTask(
  tx: Tx,
  actor: Actor,
  taskId: string,
  input: TaskInput,
): Promise<void> {
  const context = await requireDraftTask(tx, actor, taskId)
  await tx
    .update(opsTasks)
    .set({ ...taskFrom(input), updatedAt: new Date() })
    .where(eq(opsTasks.id, taskId))
  await touch(tx, context)
}

export async function removeTask(tx: Tx, actor: Actor, taskId: string): Promise<void> {
  const context = await requireDraftTask(tx, actor, taskId)
  await tx.delete(opsTasks).where(eq(opsTasks.id, taskId))
  await touch(tx, context)
}

export async function moveTask(
  tx: Tx,
  actor: Actor,
  taskId: string,
  direction: 'up' | 'down',
): Promise<void> {
  const context = await requireDraftTask(tx, actor, taskId)
  const siblings = await tx
    .select({ id: opsTasks.id })
    .from(opsTasks)
    .where(
      and(
        eq(opsTasks.organizationId, actor.organizationId),
        eq(opsTasks.sectionId, context.task.sectionId),
      ),
    )
    .orderBy(asc(opsTasks.position), asc(opsTasks.createdAt))
  const order = siblings.map((s) => s.id)
  const index = order.indexOf(taskId)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || target < 0 || target >= order.length) return
  ;[order[index], order[target]] = [order[target]!, order[index]!]
  for (const [position, id] of order.entries()) {
    await tx.update(opsTasks).set({ position }).where(eq(opsTasks.id, id))
  }
  await touch(tx, context)
}

// ---------------------------------------------------------------------------
// Publishing, new drafts, archiving
// ---------------------------------------------------------------------------

export function draftProblems(sections: readonly SectionDetail[]): string[] {
  const problems: string[] = []
  const tasks = sections.reduce((sum, s) => sum + s.tasks.length, 0)
  if (tasks === 0) problems.push('Add at least one task.')
  for (const section of sections) {
    if (section.tasks.length === 0)
      problems.push(`"${section.title}" has no tasks. Add one or remove the section.`)
  }
  return problems
}

export async function publishDraft(
  tx: Tx,
  actor: Actor,
  versionId: string,
  rawChangeNote: string,
  now = new Date(),
): Promise<{ versionNumber: number; shiftsWithNewWork: number }> {
  const context = await requireDraft(tx, actor, versionId)
  const sections = await loadSections(tx, actor.organizationId, versionId)
  const problems = draftProblems(sections)
  if (problems.length > 0) throw new ValidationError({ draft: problems }, problems[0])
  const changeNote = clean(rawChangeNote, LIMITS.changeNote)
  if (context.template.publishedVersionId && !changeNote) {
    throw new ValidationError({ changeNote: ['Say what changed, so the team can see why.'] })
  }

  await tx
    .update(opsTemplateVersions)
    .set({
      status: 'published',
      publishedAt: now,
      publishedByEmploymentId: actor.employmentId,
      changeNote,
      updatedAt: now,
    })
    .where(eq(opsTemplateVersions.id, versionId))
  try {
    await tx
      .update(opsTemplates)
      .set({
        publishedVersionId: versionId,
        name: context.version.name,
        kind: context.version.kind,
        updatedAt: now,
      })
      .where(eq(opsTemplates.id, context.template.id))
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError({ name: ['There is already a template with this name.'] })
    }
    throw error
  }

  const generated = await generateForUpcomingShifts(
    tx,
    actor.organizationId,
    context.locationIds.length > 0 ? context.locationIds : null,
    actor.employmentId,
    now,
  )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TEMPLATE_PUBLISHED,
    summary: `Published version ${context.version.versionNumber} of "${context.version.name}"`,
    subjectType: 'ops_template',
    subjectId: context.template.id,
    locationId: context.locationIds.length === 1 ? context.locationIds[0] : undefined,
    metadata: {
      versionId,
      versionNumber: context.version.versionNumber,
      shiftsWithNewWork: generated.created,
    },
  })
  return { versionNumber: context.version.versionNumber, shiftsWithNewWork: generated.created }
}

async function requireTemplateForChange(tx: Tx, actor: Actor, templateId: string) {
  requireAnyAuthoring(actor)
  const [template] = await tx
    .select()
    .from(opsTemplates)
    .where(
      and(eq(opsTemplates.organizationId, actor.organizationId), eq(opsTemplates.id, templateId)),
    )
    .for('update')
    .limit(1)
  if (!template) throw new NotFoundError('Template not found')
  const governing = await governingLocations(tx, actor.organizationId, template)
  requireAuthorFor(actor, governing)
  return template
}

/** Copy the published version into a new draft, or return the draft that exists. */
export async function startNewDraft(tx: Tx, actor: Actor, templateId: string): Promise<string> {
  const template = await requireTemplateForChange(tx, actor, templateId)
  if (template.status !== 'active') {
    throw new ValidationError({}, 'This template is archived. Restore it before changing it.')
  }
  const org = actor.organizationId
  const [existing] = await tx
    .select({ id: opsTemplateVersions.id })
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, org),
        eq(opsTemplateVersions.templateId, templateId),
        eq(opsTemplateVersions.status, 'draft'),
      ),
    )
    .limit(1)
  if (existing) return existing.id
  if (!template.publishedVersionId) throw new NotFoundError('Version not found')

  const [published] = await tx
    .select()
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, org),
        eq(opsTemplateVersions.id, template.publishedVersionId),
      ),
    )
    .limit(1)
  const [{ highest } = { highest: 0 }] = await tx
    .select({ highest: sql<number>`coalesce(max(${opsTemplateVersions.versionNumber}), 0)::int` })
    .from(opsTemplateVersions)
    .where(
      and(
        eq(opsTemplateVersions.organizationId, org),
        eq(opsTemplateVersions.templateId, templateId),
      ),
    )

  const draftId = newId()
  await tx.insert(opsTemplateVersions).values({
    id: draftId,
    organizationId: org,
    templateId,
    versionNumber: highest + 1,
    name: published!.name,
    kind: published!.kind,
    description: published!.description,
    createdByEmploymentId: actor.employmentId,
  })
  const targets = (await loadTargets(tx, org, [published!.id])).get(published!.id)!
  if (targets.locationIds.length) {
    await tx.insert(opsVersionLocations).values(
      targets.locationIds.map((id) => ({
        id: newId(),
        organizationId: org,
        versionId: draftId,
        locationId: id,
      })),
    )
  }
  if (targets.jobRoleIds.length) {
    await tx.insert(opsVersionJobRoles).values(
      targets.jobRoleIds.map((id) => ({
        id: newId(),
        organizationId: org,
        versionId: draftId,
        jobRoleId: id,
      })),
    )
  }
  if (targets.stationIds.length) {
    await tx.insert(opsVersionStations).values(
      targets.stationIds.map((id) => ({
        id: newId(),
        organizationId: org,
        versionId: draftId,
        stationId: id,
      })),
    )
  }
  const sections = await loadSections(tx, org, published!.id)
  for (const section of sections) {
    const sectionId = newId()
    await tx.insert(opsSections).values({
      id: sectionId,
      organizationId: org,
      versionId: draftId,
      title: section.title,
      position: section.position,
    })
    if (section.tasks.length > 0) {
      await tx.insert(opsTasks).values(
        section.tasks.map((task) => ({
          id: newId(),
          organizationId: org,
          versionId: draftId,
          sectionId,
          position: task.position,
          title: task.title,
          instructions: task.instructions,
          required: task.required,
          responseType: task.responseType,
          timingAnchor: task.timingAnchor,
          offsetMinutes: task.offsetMinutes,
          requiresVerification: task.requiresVerification,
          shared: task.shared,
          sourceTaskId: task.id,
        })),
      )
    }
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TEMPLATE_DRAFTED,
    summary: `Started draft version ${highest + 1} of "${published!.name}"`,
    subjectType: 'ops_template',
    subjectId: templateId,
    metadata: { versionId: draftId, fromVersionId: published!.id },
  })
  return draftId
}

export async function discardDraft(tx: Tx, actor: Actor, versionId: string): Promise<void> {
  const context = await requireDraft(tx, actor, versionId)
  if (!context.template.publishedVersionId) {
    throw new ValidationError(
      {},
      'This template has never been published, so this draft is all of it. Archive the template instead.',
    )
  }
  await tx.delete(opsTemplateVersions).where(eq(opsTemplateVersions.id, versionId))
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TEMPLATE_DRAFT_DISCARDED,
    summary: `Discarded draft version ${context.version.versionNumber} of "${context.version.name}"`,
    subjectType: 'ops_template',
    subjectId: context.template.id,
  })
}

/**
 * Archive: no new shifts receive this work. Shifts that already have it keep
 * it - that work was published to someone and stays on record.
 */
export async function archiveTemplate(
  tx: Tx,
  actor: Actor,
  templateId: string,
  now = new Date(),
): Promise<void> {
  const template = await requireTemplateForChange(tx, actor, templateId)
  if (template.status === 'archived') return
  await tx
    .update(opsTemplates)
    .set({
      status: 'archived',
      archivedAt: now,
      archivedByEmploymentId: actor.employmentId,
      updatedAt: now,
    })
    .where(eq(opsTemplates.id, templateId))
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TEMPLATE_ARCHIVED,
    summary: `Archived the operations template "${template.name}"`,
    subjectType: 'ops_template',
    subjectId: templateId,
  })
}

export async function restoreTemplate(tx: Tx, actor: Actor, templateId: string): Promise<void> {
  const template = await requireTemplateForChange(tx, actor, templateId)
  if (template.status === 'active') return
  try {
    await tx
      .update(opsTemplates)
      .set({
        status: 'active',
        archivedAt: null,
        archivedByEmploymentId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(opsTemplates.id, templateId), ne(opsTemplates.status, 'active')))
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError(
        {},
        'Another active template already has this name. Rename or archive that one first.',
      )
    }
    throw error
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TEMPLATE_RESTORED,
    summary: `Restored the operations template "${template.name}"`,
    subjectType: 'ops_template',
    subjectId: templateId,
  })
}
