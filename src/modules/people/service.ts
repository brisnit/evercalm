import { and, asc, eq, ilike, inArray, isNull, type SQL } from 'drizzle-orm'
import { employmentLocations, employments, locations } from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { NotFoundError } from '@/lib/errors'
import { accessibleLocationIds, authorize, can, isSelf } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'

/**
 * THE TENANT-FACING PEOPLE DIRECTORY.
 *
 * Every query here starts from `employments`, which is tenant-owned and
 * RLS-protected. The global `user` table is never consulted, because it is an
 * identity record rather than a directory: one row can belong to several
 * customers, so reading it here would leak that a person also works
 * somewhere else.
 *
 * A person who works for two EverCalm customers therefore appears twice, once
 * per tenant, and neither directory can see the other.
 */

export interface DirectoryFilters {
  /** Free-text match on display name. Never on email. */
  query?: string
  locationId?: string
  status?: string
}

export interface DirectoryEntry {
  employmentId: string
  displayName: string
  status: string
  homeLocationId: string | null
  homeLocationName: string | null
}

/**
 * Sensitive fields are returned ONLY to actors holding
 * `people.view_sensitive`, or to the person themselves. General Managers
 * deliberately do not hold it.
 */
export interface SensitiveContact {
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
}

export interface EmploymentDetail extends DirectoryEntry {
  hiredOn: string | null
  separatedOn: string | null
  locationIds: string[]
  /** Null when the viewer may not see sensitive information. */
  contact: SensitiveContact | null
}

function locationScopeCondition(actor: Actor): SQL | undefined {
  // An org-wide grant sees everyone; a location-scoped one sees only people
  // assigned to the locations they actually manage.
  const allowed = accessibleLocationIds(actor, 'people.view')
  if (allowed === null) return undefined
  if (allowed.length === 0) return undefined
  return inArray(employments.homeLocationId, allowed)
}

export async function listEmployments(
  tx: Tx,
  actor: Actor,
  filters: DirectoryFilters = {},
): Promise<DirectoryEntry[]> {
  if (!can(actor, 'people.view') && accessibleLocationIds(actor, 'people.view')?.length === 0) {
    authorize(actor, 'people.view')
  }

  const conditions: (SQL | undefined)[] = [
    eq(employments.organizationId, actor.organizationId),
    isNull(employments.archivedAt),
    locationScopeCondition(actor),
  ]

  if (filters.status) conditions.push(eq(employments.status, filters.status))
  if (filters.locationId) conditions.push(eq(employments.homeLocationId, filters.locationId))
  if (filters.query) {
    const term = `%${filters.query}%`
    // Deliberately not searchable by email: an email search would turn the
    // directory into an oracle for "does this person exist", which is the
    // same leak the invitation flow has to avoid.
    conditions.push(ilike(employments.displayName, term))
  }

  const rows = await tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      status: employments.status,
      homeLocationId: employments.homeLocationId,
      homeLocationName: locations.name,
    })
    .from(employments)
    .leftJoin(
      locations,
      and(
        eq(locations.id, employments.homeLocationId),
        eq(locations.organizationId, employments.organizationId),
      ),
    )
    .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
    .orderBy(asc(employments.displayName))

  return rows
}

export async function getEmployment(
  tx: Tx,
  actor: Actor,
  employmentId: string,
): Promise<EmploymentDetail> {
  const mayViewSensitive = can(actor, 'people.view_sensitive') || isSelf(actor, employmentId)

  const rows = await tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      status: employments.status,
      homeLocationId: employments.homeLocationId,
      homeLocationName: locations.name,
      hiredOn: employments.hiredOn,
      separatedOn: employments.separatedOn,
      email: employments.email,
      phone: employments.phone,
      dateOfBirth: employments.dateOfBirth,
      emergencyContactName: employments.emergencyContactName,
      emergencyContactPhone: employments.emergencyContactPhone,
    })
    .from(employments)
    .leftJoin(
      locations,
      and(
        eq(locations.id, employments.homeLocationId),
        eq(locations.organizationId, employments.organizationId),
      ),
    )
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, employmentId),
        isNull(employments.archivedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  // A record in another tenant is indistinguishable from one that does not
  // exist. Never 403 here.
  if (!row) throw new NotFoundError('Employee not found')

  if (!isSelf(actor, employmentId))
    authorize(actor, 'people.view', { locationId: row.homeLocationId })

  const assigned = await tx
    .select({ locationId: employmentLocations.locationId })
    .from(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, actor.organizationId),
        eq(employmentLocations.employmentId, employmentId),
      ),
    )

  return {
    employmentId: row.employmentId,
    displayName: row.displayName,
    status: row.status,
    homeLocationId: row.homeLocationId,
    homeLocationName: row.homeLocationName,
    hiredOn: row.hiredOn,
    separatedOn: row.separatedOn,
    locationIds: assigned.map((a) => a.locationId),
    contact: mayViewSensitive
      ? {
          email: row.email,
          phone: row.phone,
          dateOfBirth: row.dateOfBirth,
          emergencyContactName: row.emergencyContactName,
          emergencyContactPhone: row.emergencyContactPhone,
        }
      : null,
  }
}

/**
 * Does THIS organization already employ someone at this address?
 *
 * Scoped to the tenant on purpose. Used by the invitation flow to avoid
 * inviting an existing colleague twice. It can never answer "does this person
 * have an EverCalm account", which would be an enumeration oracle across all
 * customers.
 */
export async function findEmploymentByEmailInTenant(
  tx: Tx,
  actor: Actor,
  email: string,
): Promise<{ employmentId: string; displayName: string; status: string } | null> {
  const rows = await tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      status: employments.status,
    })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.email, email.trim().toLowerCase()),
        isNull(employments.archivedAt),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}
