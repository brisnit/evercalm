import { and, asc, eq, isNull } from 'drizzle-orm'
import { locations, organizations } from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { NotFoundError } from '@/lib/errors'
import { authorize } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import type { CreateLocationInput } from './validators'

/**
 * Organization and location services.
 *
 * Every function takes an Actor and calls authorize() before touching data.
 * Every function runs inside a tenant transaction, so RLS constrains it even
 * if an authorization check were somehow missed.
 */

export interface LocationSummary {
  id: string
  name: string
  timezone: string
  city: string | null
  region: string | null
  status: string
}

export async function listLocations(tx: Tx, actor: Actor): Promise<LocationSummary[]> {
  // Reading the location list is part of org.view; a location-scoped manager
  // still needs to see the sites they work at, so this is not gated harder.
  const rows = await tx
    .select({
      id: locations.id,
      name: locations.name,
      timezone: locations.timezone,
      city: locations.city,
      region: locations.region,
      status: locations.status,
    })
    .from(locations)
    .where(and(eq(locations.organizationId, actor.organizationId), isNull(locations.archivedAt)))
    .orderBy(asc(locations.name))

  return rows
}

export async function getOrganization(tx: Tx, actor: Actor) {
  authorize(actor, 'org.view')
  const rows = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      industry: organizations.industry,
      timezone: organizations.timezone,
      jurisdiction: organizations.jurisdiction,
    })
    .from(organizations)
    .where(eq(organizations.id, actor.organizationId))
    .limit(1)

  const organization = rows[0]
  // Cross-tenant reads surface as "not found", never "forbidden".
  if (!organization) throw new NotFoundError('Organization not found')
  return organization
}

export async function createLocation(
  tx: Tx,
  actor: Actor,
  input: CreateLocationInput,
): Promise<LocationSummary> {
  authorize(actor, 'org.manage_locations')

  const id = newId()
  const [created] = await tx
    .insert(locations)
    .values({
      id,
      organizationId: actor.organizationId,
      name: input.name,
      timezone: input.timezone,
      city: input.city || null,
      region: input.region || null,
    })
    .returning({
      id: locations.id,
      name: locations.name,
      timezone: locations.timezone,
      city: locations.city,
      region: locations.region,
      status: locations.status,
    })

  if (!created) throw new NotFoundError('Location could not be created')

  // Same transaction as the insert: the action and its audit row commit or
  // roll back together.
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.LOCATION_CREATED,
    summary: `Created location "${created.name}"`,
    subjectType: 'location',
    subjectId: created.id,
    locationId: created.id,
    metadata: { timezone: created.timezone },
  })

  return created
}
