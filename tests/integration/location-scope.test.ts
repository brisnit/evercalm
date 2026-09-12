import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { resolveActor, listMemberships } from '@/server/authz/resolve'
import { can, canAtAnyLocation, accessibleLocationIds } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import {
  asTenant,
  appDrizzle,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
} from '../helpers/tenant'

/**
 * PERMISSION RESOLUTION AGAINST REAL SEEDED DATA.
 *
 * The unit tests prove can() is correct given grants. These prove the grants
 * loaded from the database are the ones we think they are - including the
 * case the brief called out explicitly: a location-scoped manager must not
 * reach another location of the SAME organization.
 */

let harborId: string
let lumenId: string
const userIds = new Map<string, string>()
const locationIds = new Map<string, string>()

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')

  const pool = await migrationClient()
  const users = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of users.rows) userIds.set(row.email, row.id)

  const locations = await pool.query<{ id: string; name: string; organization_id: string }>(
    'select id, name, organization_id from locations',
  )
  for (const row of locations.rows) {
    locationIds.set(`${row.organization_id === harborId ? 'harbor' : 'lumen'}:${row.name}`, row.id)
  }
})

afterAll(async () => {
  await closeTestPools()
})

async function actorFor(organizationId: string, email: string): Promise<Actor> {
  const userId = userIds.get(email)
  if (!userId) throw new Error(`Seeded user ${email} not found`)
  const actor = await asTenant(organizationId, (tx) => resolveActor(tx, organizationId, userId))
  if (!actor) throw new Error(`No actor resolved for ${email}`)
  return actor
}

describe('a location-scoped manager', () => {
  it('can act at their own location', async () => {
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    const riverside = locationIds.get('harbor:Riverside')!

    expect(can(marcus, 'schedule.publish', { locationId: riverside })).toBe(true)
    expect(can(marcus, 'checklist.verify', { locationId: riverside })).toBe(true)
    expect(can(marcus, 'people.view', { locationId: riverside })).toBe(true)
  })

  it('CANNOT act at another location of the same organization', async () => {
    // The requested proof: same tenant, same role, different site.
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    const downtown = locationIds.get('harbor:Downtown')!

    expect(can(marcus, 'schedule.publish', { locationId: downtown })).toBe(false)
    expect(can(marcus, 'schedule.draft', { locationId: downtown })).toBe(false)
    expect(can(marcus, 'checklist.verify', { locationId: downtown })).toBe(false)
    expect(can(marcus, 'people.view', { locationId: downtown })).toBe(false)
    expect(can(marcus, 'timeoff.decide', { locationId: downtown })).toBe(false)
  })

  it('reports exactly one accessible location', async () => {
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    const riverside = locationIds.get('harbor:Riverside')!
    expect(accessibleLocationIds(marcus, 'schedule.publish')).toEqual([riverside])
  })

  it('cannot answer organization-level questions', async () => {
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    expect(can(marcus, 'schedule.publish')).toBe(false)
    expect(can(marcus, 'org.manage_roles')).toBe(false)
    expect(can(marcus, 'org.view_audit')).toBe(false)
    expect(can(marcus, 'people.view_sensitive')).toBe(false)
  })

  it('is genuinely distinct from the other location manager', async () => {
    const tess = await actorFor(harborId, 'tess@harborvine.test')
    const riverside = locationIds.get('harbor:Riverside')!
    const downtown = locationIds.get('harbor:Downtown')!
    expect(can(tess, 'schedule.publish', { locationId: downtown })).toBe(true)
    expect(can(tess, 'schedule.publish', { locationId: riverside })).toBe(false)
  })
})

describe('an owner', () => {
  it('can act at every location of their organization', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    for (const name of ['Riverside', 'Downtown']) {
      const id = locationIds.get(`harbor:${name}`)!
      expect(can(dana, 'schedule.publish', { locationId: id })).toBe(true)
      expect(can(dana, 'checklist.verify', { locationId: id })).toBe(true)
    }
    expect(can(dana, 'org.manage_roles')).toBe(true)
    expect(can(dana, 'org.view_audit')).toBe(true)
  })

  it('has no reach into the other tenant, because the row does not exist there', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const pearl = locationIds.get('lumen:Pearl District')!

    // Worth being precise about the division of responsibility here.
    // can() answers "does this actor hold this capability?" and is
    // deliberately tenant-agnostic, so an org-wide grant answers yes for any
    // location id handed to it...
    expect(can(dana, 'schedule.publish', { locationId: pearl })).toBe(true)

    // ...and isolation is what makes that harmless: inside her tenant the
    // salon's location simply does not exist, so there is nothing to act on.
    // Authorization and isolation are separate layers ON PURPOSE - neither is
    // asked to do the other's job.
    const found = await asTenant(harborId, async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select id from locations where id = ${pearl}`,
      )
      return result.rows.length
    })
    expect(found).toBe(0)
  })
})

describe('a shift lead', () => {
  it('verifies checklists but does not manage schedules or people', async () => {
    const jordan = await actorFor(harborId, 'jordan@harborvine.test')
    const riverside = locationIds.get('harbor:Riverside')!

    expect(can(jordan, 'checklist.verify', { locationId: riverside })).toBe(true)
    expect(can(jordan, 'handoff.manage', { locationId: riverside })).toBe(true)
    expect(can(jordan, 'schedule.publish', { locationId: riverside })).toBe(false)
    expect(can(jordan, 'people.manage_employment', { locationId: riverside })).toBe(false)
    expect(can(jordan, 'people.view_sensitive', { locationId: riverside })).toBe(false)
  })
})

describe('an employee', () => {
  it('resolves with no capabilities at all', async () => {
    const sam = await actorFor(harborId, 'sam@harborvine.test')
    expect(sam.grants).toHaveLength(1)
    expect(sam.grants[0]?.capabilities.size).toBe(0)
    expect(canAtAnyLocation(sam, 'people.view')).toBe(false)
    expect(canAtAnyLocation(sam, 'schedule.view_all')).toBe(false)
  })
})

describe('actor resolution is tenant-scoped', () => {
  it('returns null for a user who belongs to the other organization', async () => {
    const anaUserId = userIds.get('ana@lumensalon.test')!
    // Ask for the salon owner inside the restaurant's tenant context.
    const actor = await asTenant(harborId, (tx) => resolveActor(tx, harborId, anaUserId))
    expect(actor).toBeNull()
  })

  it('lists only the memberships a user actually holds', async () => {
    const db = await appDrizzle()
    const danaUserId = userIds.get('dana@harborvine.test')!
    const memberships = await listMemberships(db, danaUserId)
    expect(memberships.map((m) => m.organizationSlug)).toEqual(['harbor-vine'])

    const anaUserId = userIds.get('ana@lumensalon.test')!
    const salonMemberships = await listMemberships(db, anaUserId)
    expect(salonMemberships.map((m) => m.organizationSlug)).toEqual(['lumen-salon'])
    expect(salonMemberships[0]?.organizationId).toBe(lumenId)
  })
})
