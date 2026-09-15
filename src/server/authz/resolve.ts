import { and, eq, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import {
  employmentLocations,
  employments,
  roleCapabilities,
  roleGrants,
  roles,
} from '@/server/db/schema'
import type { Db, Tx } from '@/server/db'
import { isCapability, type Capability } from './capabilities'
import { isLocationScopable } from './capabilities'
import type { Actor, ResolvedGrant } from './actor'
import type { GrantScope } from './role-presets'
import { capabilitiesFor } from '@/modules/billing/policy'
import { organizationAccessMode } from '@/modules/billing/service'

/**
 * Resolve an Actor: one person's effective permissions inside one tenant.
 *
 * Called once per request. Must run inside withTenant(), so every query here
 * is already constrained by RLS - a bug in this function cannot leak another
 * tenant's grants.
 */
export async function resolveActor(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<Actor | null> {
  const employmentRows = await tx
    .select({
      id: employments.id,
      displayName: employments.displayName,
      status: employments.status,
    })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, organizationId),
        eq(employments.userId, userId),
        isNull(employments.archivedAt),
      ),
    )
    .limit(1)

  const employment = employmentRows[0]
  if (!employment) return null
  // A separated or suspended person keeps their identity but loses access.
  if (employment.status === 'separated' || employment.status === 'suspended') return null

  const grantRows = await tx
    .select({
      grantId: roleGrants.id,
      roleId: roleGrants.roleId,
      roleKey: roles.key,
      roleName: roles.name,
      scope: roleGrants.scope,
      locationId: roleGrants.locationId,
      capability: roleCapabilities.capability,
    })
    .from(roleGrants)
    .innerJoin(
      roles,
      and(eq(roles.id, roleGrants.roleId), eq(roles.organizationId, roleGrants.organizationId)),
    )
    .leftJoin(
      roleCapabilities,
      and(
        eq(roleCapabilities.roleId, roleGrants.roleId),
        eq(roleCapabilities.organizationId, roleGrants.organizationId),
      ),
    )
    .where(
      and(
        eq(roleGrants.organizationId, organizationId),
        eq(roleGrants.employmentId, employment.id),
        isNull(roleGrants.revokedAt),
      ),
    )

  const byGrant = new Map<
    string,
    { meta: Omit<ResolvedGrant, 'capabilities'>; caps: Set<Capability> }
  >()

  for (const row of grantRows) {
    let entry = byGrant.get(row.grantId)
    if (!entry) {
      entry = {
        meta: {
          roleId: row.roleId,
          roleKey: row.roleKey,
          roleName: row.roleName,
          scope: row.scope as GrantScope,
          locationId: row.locationId,
        },
        caps: new Set<Capability>(),
      }
      byGrant.set(row.grantId, entry)
    }
    const cap = row.capability
    if (cap === null || !isCapability(cap)) continue
    // Defence in depth: a location grant can never carry an org-only
    // capability, even if bad data put one there.
    if (entry.meta.scope === 'location' && !isLocationScopable(cap)) continue
    entry.caps.add(cap)
  }

  // A suspended or canceled subscription leaves administration read-only.
  // Self-access needs no capability, so employees keep their own records.
  const accessMode = await organizationAccessMode(tx, organizationId)
  const grants: ResolvedGrant[] = [...byGrant.values()].map((e) => ({
    ...e.meta,
    capabilities: capabilitiesFor(e.caps, accessMode),
  }))

  const locationRows = await tx
    .select({ locationId: employmentLocations.locationId })
    .from(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, organizationId),
        eq(employmentLocations.employmentId, employment.id),
      ),
    )

  return {
    userId,
    organizationId,
    employmentId: employment.id,
    displayName: employment.displayName,
    grants,
    locationIds: locationRows.map((r) => r.locationId),
    accessMode,
  }
}

export interface Membership {
  organizationId: string
  organizationName: string
  organizationSlug: string
  industry: string
  employmentId: string
  employmentStatus: string
  displayName: string
}

/**
 * Which organizations does this user belong to?
 *
 * Uses the SECURITY DEFINER function from migration 0002 because this question
 * is asked before a tenant context exists. See that migration for why this is
 * the only sanctioned cross-tenant read.
 */
export async function listMemberships(db: Db, userId: string): Promise<Membership[]> {
  const result = await db.execute<{
    organization_id: string
    organization_name: string
    organization_slug: string
    industry: string
    employment_id: string
    employment_status: string
    display_name: string
  }>(sql`select * from evercalm_user_memberships(${userId})`)

  return result.rows.map((r) => ({
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    organizationSlug: r.organization_slug,
    industry: r.industry,
    employmentId: r.employment_id,
    employmentStatus: r.employment_status,
    displayName: r.display_name,
  }))
}
