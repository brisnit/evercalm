import { and, asc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm'
import {
  employmentCredentials,
  employmentLocations,
  employments,
  locations,
} from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { accessibleLocationIds, authorize, can, canAtAnyLocation, isSelf } from '@/server/authz/can'
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
  /** Free-text match on display name or job title. Never on email. */
  query?: string
  locationId?: string
  status?: string
}

export interface DirectoryEntry {
  employmentId: string
  displayName: string
  status: string
  jobTitle: string | null
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
  managerEmploymentId: string | null
  managerName: string | null
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
  // Holding people.view ANYWHERE is enough to open the directory; which rows
  // come back is then narrowed by locationScopeCondition().
  if (!canAtAnyLocation(actor, 'people.view')) throw new ForbiddenError('people.view')

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
    conditions.push(or(ilike(employments.displayName, term), ilike(employments.jobTitle, term)))
  }

  const rows = await tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      status: employments.status,
      jobTitle: employments.jobTitle,
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
      jobTitle: employments.jobTitle,
      managerEmploymentId: employments.managerEmploymentId,
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

  let managerName: string | null = null
  if (row.managerEmploymentId) {
    const [manager] = await tx
      .select({ displayName: employments.displayName })
      .from(employments)
      .where(
        and(
          eq(employments.organizationId, actor.organizationId),
          eq(employments.id, row.managerEmploymentId),
        ),
      )
      .limit(1)
    managerName = manager?.displayName ?? null
  }

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
    jobTitle: row.jobTitle,
    homeLocationId: row.homeLocationId,
    homeLocationName: row.homeLocationName,
    hiredOn: row.hiredOn,
    separatedOn: row.separatedOn,
    managerEmploymentId: row.managerEmploymentId,
    managerName,
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

/**
 * PROFESSIONAL CREDENTIALS.
 *
 * Generic by design. The salon tenant tracks state cosmetology licences here;
 * the restaurant tracks food handler cards. The platform knows only that a
 * credential has an issuer and usually an expiry.
 *
 * The licence NUMBER is sensitive and is returned only to actors who also hold
 * `people.view_sensitive`. Expiry dates are not sensitive - a manager needs to
 * know somebody's licence lapses next month without being able to read the
 * number itself.
 */

export type CredentialExpiryState = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry'

export interface CredentialView {
  id: string
  name: string
  issuingAuthority: string | null
  /** Null unless the viewer holds people.view_sensitive or it is their own. */
  identifier: string | null
  issuedOn: string | null
  expiresOn: string | null
  expiryState: CredentialExpiryState
  daysUntilExpiry: number | null
}

const EXPIRING_SOON_DAYS = 45

export function credentialExpiryState(expiresOn: string | null): {
  state: CredentialExpiryState
  daysUntilExpiry: number | null
} {
  if (!expiresOn) return { state: 'no_expiry', daysUntilExpiry: null }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(`${expiresOn}T00:00:00`)
  const days = Math.round((expiry.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { state: 'expired', daysUntilExpiry: days }
  if (days <= EXPIRING_SOON_DAYS) return { state: 'expiring_soon', daysUntilExpiry: days }
  return { state: 'valid', daysUntilExpiry: days }
}

export async function listCredentials(
  tx: Tx,
  actor: Actor,
  employmentId: string,
): Promise<CredentialView[]> {
  let subjectLocationId: string | null = null
  if (!isSelf(actor, employmentId)) {
    const [subject] = await tx
      .select({ homeLocationId: employments.homeLocationId })
      .from(employments)
      .where(
        and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
      )
      .limit(1)
    if (!subject) throw new NotFoundError('Employee not found')
    subjectLocationId = subject.homeLocationId
    authorize(actor, 'people.view', { locationId: subjectLocationId })
  }

  const mayViewIdentifier =
    isSelf(actor, employmentId) ||
    can(actor, 'people.view_sensitive', { locationId: subjectLocationId })

  const rows = await tx
    .select({
      id: employmentCredentials.id,
      name: employmentCredentials.name,
      issuingAuthority: employmentCredentials.issuingAuthority,
      identifier: employmentCredentials.identifier,
      issuedOn: employmentCredentials.issuedOn,
      expiresOn: employmentCredentials.expiresOn,
    })
    .from(employmentCredentials)
    .where(
      and(
        eq(employmentCredentials.organizationId, actor.organizationId),
        eq(employmentCredentials.employmentId, employmentId),
        isNull(employmentCredentials.archivedAt),
      ),
    )
    .orderBy(asc(employmentCredentials.expiresOn))

  return rows.map((r) => {
    const { state, daysUntilExpiry } = credentialExpiryState(r.expiresOn)
    return {
      id: r.id,
      name: r.name,
      issuingAuthority: r.issuingAuthority,
      identifier: mayViewIdentifier ? r.identifier : null,
      issuedOn: r.issuedOn,
      expiresOn: r.expiresOn,
      expiryState: state,
      daysUntilExpiry,
    }
  })
}

/** Credentials expiring soon or already expired, across the organization. */
export async function listExpiringCredentials(
  tx: Tx,
  actor: Actor,
): Promise<{ employmentId: string; employeeName: string; credential: CredentialView }[]> {
  if (!canAtAnyLocation(actor, 'people.view')) throw new ForbiddenError('people.view')
  const allowedLocations = accessibleLocationIds(actor, 'people.view')

  const rows = await tx
    .select({
      id: employmentCredentials.id,
      employmentId: employmentCredentials.employmentId,
      employeeName: employments.displayName,
      name: employmentCredentials.name,
      issuingAuthority: employmentCredentials.issuingAuthority,
      issuedOn: employmentCredentials.issuedOn,
      expiresOn: employmentCredentials.expiresOn,
      homeLocationId: employments.homeLocationId,
    })
    .from(employmentCredentials)
    .innerJoin(
      employments,
      and(
        eq(employments.id, employmentCredentials.employmentId),
        eq(employments.organizationId, employmentCredentials.organizationId),
      ),
    )
    .where(
      and(
        eq(employmentCredentials.organizationId, actor.organizationId),
        isNull(employmentCredentials.archivedAt),
      ),
    )
    .orderBy(asc(employmentCredentials.expiresOn))

  return rows
    .filter(
      // null means an organization-wide grant, so no narrowing is needed.
      (r) =>
        allowedLocations === null ||
        (r.homeLocationId !== null && allowedLocations.includes(r.homeLocationId)),
    )
    .map((r) => {
      const { state, daysUntilExpiry } = credentialExpiryState(r.expiresOn)
      return {
        employmentId: r.employmentId,
        employeeName: r.employeeName,
        credential: {
          id: r.id,
          name: r.name,
          issuingAuthority: r.issuingAuthority,
          // Never expose the number in an organization-wide list.
          identifier: null,
          issuedOn: r.issuedOn,
          expiresOn: r.expiresOn,
          expiryState: state,
          daysUntilExpiry,
        },
      }
    })
    .filter(
      (r) => r.credential.expiryState === 'expired' || r.credential.expiryState === 'expiring_soon',
    )
}

export async function recordCredential(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  input: {
    name: string
    issuingAuthority?: string
    identifier?: string
    issuedOn?: string | null
    expiresOn?: string | null
  },
): Promise<string> {
  authorize(actor, 'people.manage_credentials')

  const [person] = await tx
    .select({ displayName: employments.displayName, homeLocationId: employments.homeLocationId })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )
    .limit(1)
  if (!person) throw new NotFoundError('Employee not found')

  const id = newId()
  await tx.insert(employmentCredentials).values({
    id,
    organizationId: actor.organizationId,
    employmentId,
    name: input.name.trim(),
    issuingAuthority: input.issuingAuthority?.trim() || null,
    identifier: input.identifier?.trim() || null,
    issuedOn: input.issuedOn ?? null,
    expiresOn: input.expiresOn ?? null,
    verifiedAt: new Date(),
    verifiedByEmploymentId: actor.employmentId,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.CREDENTIAL_RECORDED,
    summary: `Recorded ${input.name.trim()} for ${person.displayName}`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId: person.homeLocationId,
    // The licence number is deliberately absent from audit metadata.
    metadata: { credential: input.name.trim(), expiresOn: input.expiresOn ?? null },
  })

  return id
}
