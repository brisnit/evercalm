import { and, eq, isNull } from 'drizzle-orm'
import {
  employmentJobRoles,
  employmentLocations,
  employments,
  jobRoles,
  locations,
  roleGrants,
  roles,
} from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { authorize, can, isSelf } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'

/**
 * EMPLOYMENT CHANGES.
 *
 * Every function here is a deliberate, permissioned, audited act by a named
 * human. None of them is reachable without an Actor, and none of them is
 * performed automatically by any scheduled job or inference in EverCalm.
 */

async function loadEmployment(tx: Tx, actor: Actor, employmentId: string) {
  const [row] = await tx
    .select({
      id: employments.id,
      displayName: employments.displayName,
      status: employments.status,
      jobTitle: employments.jobTitle,
      managerEmploymentId: employments.managerEmploymentId,
      homeLocationId: employments.homeLocationId,
    })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, employmentId),
        isNull(employments.archivedAt),
      ),
    )
    .limit(1)
  // Another tenant's record is indistinguishable from a missing one.
  if (!row) throw new NotFoundError('Employee not found')
  return row
}

export async function changeJobTitle(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  jobTitle: string,
): Promise<void> {
  const person = await loadEmployment(tx, actor, employmentId)
  authorize(actor, 'people.update', { locationId: person.homeLocationId })

  const next = jobTitle.trim() || null
  if (next === person.jobTitle) return

  await tx
    .update(employments)
    .set({ jobTitle: next, updatedAt: new Date() })
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EMPLOYMENT_TITLE_CHANGED,
    summary: `Changed ${person.displayName}'s job title to ${next ?? 'none'}`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId: person.homeLocationId,
    metadata: { from: person.jobTitle, to: next },
  })
}

/**
 * CONTACT DETAILS.
 *
 * Round 2: a manager could change someone's title, roles and locations but not
 * their phone number, which is the field that actually goes stale.
 *
 * Two people may write these fields, and they may write different ones:
 *
 *   the person themselves - their own phone, emergency contact and date of
 *     birth. Their email is their sign-in and is not editable here.
 *   a manager holding people.update AND people.view_sensitive - the same
 *     fields, because editing a field you are not allowed to read would be a
 *     way to discover it.
 *
 * Every write is audited by field name. The values themselves are never put in
 * the audit log: an emergency contact's number is exactly the kind of thing
 * that should not be readable from a history page.
 */
export interface ContactDetails {
  phone: string
  emergencyContactName: string
  emergencyContactPhone: string
  dateOfBirth: string
}

export async function changeContactDetails(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  input: Partial<ContactDetails>,
): Promise<void> {
  const person = await loadEmployment(tx, actor, employmentId)
  const own = isSelf(actor, employmentId)
  if (!own) {
    authorize(actor, 'people.update', { locationId: person.homeLocationId })
    if (!can(actor, 'people.view_sensitive', { locationId: person.homeLocationId })) {
      throw new ForbiddenError(
        'people.view_sensitive',
        'Changing contact details needs the sensitive-information permission.',
      )
    }
  }

  const [current] = await tx
    .select({
      phone: employments.phone,
      emergencyContactName: employments.emergencyContactName,
      emergencyContactPhone: employments.emergencyContactPhone,
      dateOfBirth: employments.dateOfBirth,
    })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )
    .limit(1)
  if (!current) throw new NotFoundError('Employee not found')

  const clean = (value: string | undefined) => {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  const next = {
    phone: clean(input.phone),
    emergencyContactName: clean(input.emergencyContactName),
    emergencyContactPhone: clean(input.emergencyContactPhone),
    dateOfBirth: clean(input.dateOfBirth),
  }

  if (next.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(next.dateOfBirth)) {
    throw new ValidationError({ dateOfBirth: ['Use a real date.'] }, 'Invalid date of birth')
  }

  const changed = (Object.keys(next) as (keyof ContactDetails)[]).filter(
    (key) => next[key] !== undefined && next[key] !== current[key],
  )
  if (changed.length === 0) return

  await tx
    .update(employments)
    .set({
      ...Object.fromEntries(changed.map((key) => [key, next[key]])),
      updatedAt: new Date(),
    })
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EMPLOYMENT_CONTACT_CHANGED,
    summary: own
      ? `Updated their own contact details (${changed.join(', ')})`
      : `Updated ${person.displayName}'s contact details (${changed.join(', ')})`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId: person.homeLocationId,
    // Field names only. The values are personal data and stay out of history.
    metadata: { fields: changed, byThemselves: own },
  })
}

export async function changeManager(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  managerEmploymentId: string | null,
): Promise<void> {
  const person = await loadEmployment(tx, actor, employmentId)
  authorize(actor, 'people.manage_employment', { locationId: person.homeLocationId })

  if (managerEmploymentId === employmentId) {
    throw new ValidationError(
      { managerEmploymentId: ['Someone cannot report to themselves.'] },
      'Invalid manager',
    )
  }

  if (managerEmploymentId) {
    // Must exist in THIS tenant. The composite foreign key enforces it too,
    // but this produces a useful message.
    const manager = await loadEmployment(tx, actor, managerEmploymentId)

    // Walk up the chain and refuse a cycle. The database check only catches
    // self-reference; a loop of two or more needs this.
    let cursor: string | null = manager.managerEmploymentId
    const seen = new Set<string>([employmentId, managerEmploymentId])
    while (cursor) {
      if (cursor === employmentId) {
        throw new ValidationError(
          { managerEmploymentId: ['That would create a circular reporting line.'] },
          'Circular reporting line',
        )
      }
      if (seen.has(cursor)) break
      seen.add(cursor)
      const [next] = await tx
        .select({ managerEmploymentId: employments.managerEmploymentId })
        .from(employments)
        .where(
          and(eq(employments.organizationId, actor.organizationId), eq(employments.id, cursor)),
        )
        .limit(1)
      cursor = next?.managerEmploymentId ?? null
    }
  }

  await tx
    .update(employments)
    .set({ managerEmploymentId, updatedAt: new Date() })
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EMPLOYMENT_MANAGER_CHANGED,
    summary: managerEmploymentId
      ? `Changed who ${person.displayName} reports to`
      : `Removed ${person.displayName}'s manager`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId: person.homeLocationId,
    metadata: { from: person.managerEmploymentId, to: managerEmploymentId },
  })
}

export async function addLocationAssignment(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  locationId: string,
): Promise<void> {
  const person = await loadEmployment(tx, actor, employmentId)
  authorize(actor, 'people.manage_employment', { locationId })

  const [location] = await tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.organizationId, actor.organizationId), eq(locations.id, locationId)))
    .limit(1)
  if (!location) throw new NotFoundError('Location not found')

  const existing = await tx
    .select({ id: employmentLocations.id })
    .from(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, actor.organizationId),
        eq(employmentLocations.employmentId, employmentId),
        eq(employmentLocations.locationId, locationId),
      ),
    )
    .limit(1)
  if (existing[0]) return

  await tx.insert(employmentLocations).values({
    id: newId(),
    organizationId: actor.organizationId,
    employmentId,
    locationId,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EMPLOYMENT_LOCATION_ADDED,
    summary: `Assigned ${person.displayName} to ${location.name}`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId,
  })
}

export async function removeLocationAssignment(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  locationId: string,
): Promise<void> {
  const person = await loadEmployment(tx, actor, employmentId)
  authorize(actor, 'people.manage_employment', { locationId })

  const [location] = await tx
    .select({ name: locations.name })
    .from(locations)
    .where(and(eq(locations.organizationId, actor.organizationId), eq(locations.id, locationId)))
    .limit(1)

  await tx
    .delete(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, actor.organizationId),
        eq(employmentLocations.employmentId, employmentId),
        eq(employmentLocations.locationId, locationId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EMPLOYMENT_LOCATION_REMOVED,
    summary: `Removed ${person.displayName} from ${location?.name ?? 'a location'}`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId,
  })
}

export async function setJobRoles(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  jobRoleIds: string[],
): Promise<void> {
  const person = await loadEmployment(tx, actor, employmentId)
  authorize(actor, 'people.manage_employment', { locationId: person.homeLocationId })

  const valid = await tx
    .select({ id: jobRoles.id })
    .from(jobRoles)
    .where(eq(jobRoles.organizationId, actor.organizationId))
  const validIds = new Set(valid.map((v) => v.id))
  for (const id of jobRoleIds) {
    if (!validIds.has(id)) throw new NotFoundError('Unknown job role')
  }

  await tx
    .delete(employmentJobRoles)
    .where(
      and(
        eq(employmentJobRoles.organizationId, actor.organizationId),
        eq(employmentJobRoles.employmentId, employmentId),
      ),
    )
  for (const [index, jobRoleId] of jobRoleIds.entries()) {
    await tx.insert(employmentJobRoles).values({
      id: newId(),
      organizationId: actor.organizationId,
      employmentId,
      jobRoleId,
      isPrimary: index === 0,
    })
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EMPLOYMENT_STATUS_CHANGED,
    summary: `Updated ${person.displayName}'s job roles`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId: person.homeLocationId,
    metadata: { count: jobRoleIds.length },
  })
}

/**
 * Grant a role. Only an owner may do this - nobody can widen their own access.
 */
export async function grantRole(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  roleKey: string,
  scope: 'org' | 'location',
  locationId: string | null,
): Promise<void> {
  authorize(actor, 'org.manage_roles')
  const person = await loadEmployment(tx, actor, employmentId)

  const [role] = await tx
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(eq(roles.organizationId, actor.organizationId), eq(roles.key, roleKey)))
    .limit(1)
  if (!role) throw new NotFoundError('Role not found')

  if (scope === 'location' && !locationId) {
    throw new ValidationError(
      { locationId: ['Choose the location this role applies to.'] },
      'Location required',
    )
  }

  await tx.insert(roleGrants).values({
    id: newId(),
    organizationId: actor.organizationId,
    employmentId,
    roleId: role.id,
    scope,
    locationId: scope === 'location' ? locationId : null,
    grantedByEmploymentId: actor.employmentId,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ROLE_GRANTED,
    summary: `Granted ${role.name} to ${person.displayName}`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId,
    metadata: { role: roleKey, scope },
  })
}

export async function revokeRoleGrant(tx: Tx, actor: Actor, grantId: string): Promise<void> {
  authorize(actor, 'org.manage_roles')

  const [grant] = await tx
    .select({
      id: roleGrants.id,
      employmentId: roleGrants.employmentId,
      roleName: roles.name,
      personName: employments.displayName,
    })
    .from(roleGrants)
    .innerJoin(
      roles,
      and(eq(roles.id, roleGrants.roleId), eq(roles.organizationId, roleGrants.organizationId)),
    )
    .innerJoin(
      employments,
      and(
        eq(employments.id, roleGrants.employmentId),
        eq(employments.organizationId, roleGrants.organizationId),
      ),
    )
    .where(and(eq(roleGrants.organizationId, actor.organizationId), eq(roleGrants.id, grantId)))
    .limit(1)
  if (!grant) throw new NotFoundError('Role grant not found')

  await tx
    .update(roleGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(roleGrants.organizationId, actor.organizationId), eq(roleGrants.id, grantId)))

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ROLE_REVOKED,
    summary: `Revoked ${grant.roleName} from ${grant.personName}`,
    subjectType: 'employment',
    subjectId: grant.employmentId,
  })
}

/** Suspend access without ending employment. Fully reversible. */
export async function setEmploymentStatus(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  status: 'active' | 'suspended',
  reason: string,
): Promise<void> {
  const person = await loadEmployment(tx, actor, employmentId)
  authorize(actor, 'people.manage_employment', { locationId: person.homeLocationId })

  if (person.status === 'separated') {
    throw new ValidationError({}, 'This employment has already ended.')
  }
  if (person.status === status) return

  await tx
    .update(employments)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )

  await recordAuditEvent(tx, actor, {
    action:
      status === 'suspended'
        ? AUDIT_ACTIONS.EMPLOYMENT_SUSPENDED
        : AUDIT_ACTIONS.EMPLOYMENT_REACTIVATED,
    summary:
      status === 'suspended'
        ? `Suspended ${person.displayName}'s access`
        : `Restored ${person.displayName}'s access`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId: person.homeLocationId,
    metadata: { reason, from: person.status, to: status },
  })
}
