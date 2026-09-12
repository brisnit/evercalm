import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  departments,
  employmentJobRoles,
  jobRoles,
  locations,
  organizationValues,
  stations,
} from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { NotFoundError } from '@/lib/errors'
import { authorize } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'

/**
 * ORGANIZATIONAL STRUCTURE.
 *
 * Nothing here knows what industry the tenant is in. A restaurant fills
 * `stations` with "Bar" and "Host Stand"; the salon fills the same table with
 * "Chair 3" and "Colour Bar". That is the whole point: the vocabulary is data.
 */

export interface JobRoleSummary {
  id: string
  name: string
  description: string | null
  departmentId: string | null
  departmentName: string | null
  colorToken: string
  peopleCount: number
}

export async function listDepartments(tx: Tx, actor: Actor) {
  return tx
    .select({
      id: departments.id,
      name: departments.name,
      description: departments.description,
    })
    .from(departments)
    .where(
      and(eq(departments.organizationId, actor.organizationId), isNull(departments.archivedAt)),
    )
    .orderBy(asc(departments.position), asc(departments.name))
}

export async function listJobRoles(tx: Tx, actor: Actor): Promise<JobRoleSummary[]> {
  const rows = await tx
    .select({
      id: jobRoles.id,
      name: jobRoles.name,
      description: jobRoles.description,
      departmentId: jobRoles.departmentId,
      departmentName: departments.name,
      colorToken: jobRoles.colorToken,
    })
    .from(jobRoles)
    .leftJoin(
      departments,
      and(
        eq(departments.id, jobRoles.departmentId),
        eq(departments.organizationId, jobRoles.organizationId),
      ),
    )
    .where(and(eq(jobRoles.organizationId, actor.organizationId), isNull(jobRoles.archivedAt)))
    .orderBy(asc(jobRoles.position), asc(jobRoles.name))

  const assignments = await tx
    .select({ jobRoleId: employmentJobRoles.jobRoleId })
    .from(employmentJobRoles)
    .where(eq(employmentJobRoles.organizationId, actor.organizationId))

  const counts = new Map<string, number>()
  for (const a of assignments) counts.set(a.jobRoleId, (counts.get(a.jobRoleId) ?? 0) + 1)

  return rows.map((r) => ({ ...r, peopleCount: counts.get(r.id) ?? 0 }))
}

export async function listStations(tx: Tx, actor: Actor) {
  return tx
    .select({
      id: stations.id,
      name: stations.name,
      description: stations.description,
      locationId: stations.locationId,
      locationName: locations.name,
      jobRoleId: stations.jobRoleId,
      jobRoleName: jobRoles.name,
    })
    .from(stations)
    .innerJoin(
      locations,
      and(
        eq(locations.id, stations.locationId),
        eq(locations.organizationId, stations.organizationId),
      ),
    )
    .leftJoin(
      jobRoles,
      and(
        eq(jobRoles.id, stations.jobRoleId),
        eq(jobRoles.organizationId, stations.organizationId),
      ),
    )
    .where(and(eq(stations.organizationId, actor.organizationId), isNull(stations.archivedAt)))
    .orderBy(asc(locations.name), asc(stations.position), asc(stations.name))
}

export async function listValues(tx: Tx, actor: Actor) {
  return tx
    .select({
      id: organizationValues.id,
      kind: organizationValues.kind,
      title: organizationValues.title,
      body: organizationValues.body,
      position: organizationValues.position,
    })
    .from(organizationValues)
    .where(
      and(
        eq(organizationValues.organizationId, actor.organizationId),
        isNull(organizationValues.archivedAt),
      ),
    )
    .orderBy(asc(organizationValues.position), asc(organizationValues.title))
}

export async function createDepartment(
  tx: Tx,
  actor: Actor,
  input: { name: string; description?: string },
): Promise<string> {
  authorize(actor, 'org.manage_structure')
  const id = newId()
  await tx.insert(departments).values({
    id,
    organizationId: actor.organizationId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
  })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.DEPARTMENT_CREATED,
    summary: `Created the ${input.name.trim()} department`,
    subjectType: 'department',
    subjectId: id,
  })
  return id
}

export async function createJobRole(
  tx: Tx,
  actor: Actor,
  input: { name: string; description?: string; departmentId?: string | null; colorToken?: string },
): Promise<string> {
  authorize(actor, 'org.manage_structure')

  if (input.departmentId) {
    const [dept] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.organizationId, actor.organizationId),
          eq(departments.id, input.departmentId),
        ),
      )
      .limit(1)
    if (!dept) throw new NotFoundError('Department not found')
  }

  const id = newId()
  await tx.insert(jobRoles).values({
    id,
    organizationId: actor.organizationId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    departmentId: input.departmentId ?? null,
    colorToken: input.colorToken ?? 'violet',
  })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.JOB_ROLE_CREATED,
    summary: `Created the ${input.name.trim()} job role`,
    subjectType: 'job_role',
    subjectId: id,
  })
  return id
}

export async function createStation(
  tx: Tx,
  actor: Actor,
  input: { name: string; locationId: string; jobRoleId?: string | null; description?: string },
): Promise<string> {
  authorize(actor, 'org.manage_structure')

  const [location] = await tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(
      and(eq(locations.organizationId, actor.organizationId), eq(locations.id, input.locationId)),
    )
    .limit(1)
  if (!location) throw new NotFoundError('Location not found')

  const id = newId()
  await tx.insert(stations).values({
    id,
    organizationId: actor.organizationId,
    locationId: input.locationId,
    jobRoleId: input.jobRoleId ?? null,
    name: input.name.trim(),
    description: input.description?.trim() || null,
  })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.STATION_CREATED,
    summary: `Added ${input.name.trim()} at ${location.name}`,
    subjectType: 'station',
    subjectId: id,
    locationId: input.locationId,
  })
  return id
}

export async function createValue(
  tx: Tx,
  actor: Actor,
  input: { kind: 'value' | 'standard'; title: string; body: string },
): Promise<string> {
  authorize(actor, 'org.update')
  const id = newId()
  const existing = await listValues(tx, actor)
  await tx.insert(organizationValues).values({
    id,
    organizationId: actor.organizationId,
    kind: input.kind,
    title: input.title.trim(),
    body: input.body.trim(),
    position: existing.length,
  })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.VALUE_CREATED,
    summary: `Added the ${input.kind === 'value' ? 'company value' : 'operating standard'} "${input.title.trim()}"`,
    subjectType: 'organization_value',
    subjectId: id,
  })
  return id
}
