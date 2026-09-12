import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  listEmployments,
  getEmployment,
  findEmploymentByEmailInTenant,
} from '@/modules/people/service'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { NotFoundError, ForbiddenError } from '@/lib/errors'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

/**
 * GLOBAL IDENTITY BOUNDARY.
 *
 * `user`, `session`, `account` and `verification` have no tenant RLS, because
 * authentication resolves before an organization context exists. The
 * protection is architectural, so these tests prove the architecture actually
 * holds through the accessors business code uses.
 *
 * The decisive fixture is Noa Feldman: ONE global identity employed by BOTH
 * seeded organizations. Neither tenant may learn about the other employment.
 */

let harborId: string
let lumenId: string
const userIds = new Map<string, string>()

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')
  const pool = await migrationClient()
  const users = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of users.rows) userIds.set(row.email, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

async function actorFor(organizationId: string, email: string): Promise<Actor> {
  const userId = userIds.get(email)
  if (!userId) throw new Error(`Seeded user ${email} not found`)
  const actor = await asTenant(organizationId, (tx) => resolveActor(tx, organizationId, userId))
  if (!actor) throw new Error(`No actor for ${email}`)
  return actor
}

describe('one identity, two employers', () => {
  it('is genuinely the same global user row', async () => {
    const pool = await migrationClient()
    const rows = await pool.query<{ c: number }>(
      `select count(*)::int as c from "user" where email = 'noa.feldman@example.test'`,
    )
    expect(rows.rows[0]?.c, 'the fixture must be one identity, not two').toBe(1)

    const employments = await pool.query<{ c: number }>(
      `select count(*)::int as c from employments where email = 'noa.feldman@example.test'`,
    )
    expect(employments.rows[0]?.c, 'employed by both tenants').toBe(2)
  })

  it('shows each organization only its own employment of that person', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')

    const harborMatches = await asTenant(harborId, (tx) =>
      listEmployments(tx, dana, { query: 'Noa' }),
    )
    const lumenMatches = await asTenant(lumenId, (tx) => listEmployments(tx, ana, { query: 'Noa' }))

    expect(harborMatches).toHaveLength(1)
    expect(lumenMatches).toHaveLength(1)
    // Different employment records entirely - no shared identifier is exposed.
    expect(harborMatches[0]!.employmentId).not.toBe(lumenMatches[0]!.employmentId)
  })

  it('never lets one organization read the other organization’s employment record', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')

    const lumenEmployment = (
      await asTenant(lumenId, (tx) => listEmployments(tx, ana, { query: 'Noa' }))
    )[0]!

    // The restaurant owner holds a valid employment id - from the salon.
    await expect(
      asTenant(harborId, (tx) => getEmployment(tx, dana, lumenEmployment.employmentId)),
    ).rejects.toThrow(NotFoundError)
  })

  it('reveals nothing about employment elsewhere when searching by email', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')

    // Someone who works ONLY at the salon.
    const salonOnly = await asTenant(harborId, (tx) =>
      findEmploymentByEmailInTenant(tx, dana, 'riley@lumensalon.test'),
    )
    expect(salonOnly, 'the restaurant must not learn the salon employs this address').toBeNull()

    // Someone who works at both: the restaurant sees only its own record.
    const shared = await asTenant(harborId, (tx) =>
      findEmploymentByEmailInTenant(tx, dana, 'noa.feldman@example.test'),
    )
    expect(shared).not.toBeNull()
    expect(shared!.displayName).toBe('Noa Feldman')

    // An address with no EverCalm account at all is indistinguishable from
    // one that exists in another tenant. Both simply return null.
    const stranger = await asTenant(harborId, (tx) =>
      findEmploymentByEmailInTenant(tx, dana, 'nobody@nowhere.invalid'),
    )
    expect(stranger).toBeNull()
  })
})

describe('the directory resolves through employments, never global identity', () => {
  it('counts only this tenant’s people, not global users', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')

    const pool = await migrationClient()
    const globalUsers = await pool.query<{ c: number }>('select count(*)::int as c from "user"')

    const harborPeople = await asTenant(harborId, (tx) => listEmployments(tx, dana))
    const lumenPeople = await asTenant(lumenId, (tx) => listEmployments(tx, ana))

    expect(harborPeople.length).toBe(7)
    expect(lumenPeople.length).toBe(4)
    // Neither directory equals the global identity count - which is the point.
    expect(harborPeople.length).toBeLessThan(globalUsers.rows[0]!.c)
    expect(lumenPeople.length).toBeLessThan(globalUsers.rows[0]!.c)
  })

  it('does not let an employee enumerate the directory at all', async () => {
    const sam = await actorFor(harborId, 'sam@harborvine.test')
    await expect(asTenant(harborId, (tx) => listEmployments(tx, sam))).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('lets an employee read their own record without any capability', async () => {
    const sam = await actorFor(harborId, 'sam@harborvine.test')
    const self = await asTenant(harborId, (tx) => getEmployment(tx, sam, sam.employmentId))
    expect(self.displayName).toBe('Sam Whitfield')
    // Self-access includes their own contact details.
    expect(self.contact).not.toBeNull()
  })
})

describe('sensitive employee information', () => {
  it('is withheld from a General Manager', async () => {
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    const people = await asTenant(harborId, (tx) => listEmployments(tx, marcus))
    const someone = people.find((p) => p.displayName !== marcus.displayName)!

    const detail = await asTenant(harborId, (tx) => getEmployment(tx, marcus, someone.employmentId))
    expect(detail.displayName).toBeTruthy()
    expect(detail.contact, 'a GM must not receive emergency contacts or date of birth').toBeNull()
  })

  it('is available to HR, who holds people.view_sensitive', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const people = await asTenant(harborId, (tx) => listEmployments(tx, priya))
    const someone = people.find((p) => p.displayName !== priya.displayName)!

    const detail = await asTenant(harborId, (tx) => getEmployment(tx, priya, someone.employmentId))
    expect(detail.contact).not.toBeNull()
  })

  it('restricts a location manager to the people at their own location', async () => {
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    const people = await asTenant(harborId, (tx) => listEmployments(tx, marcus))
    const names = people.map((p) => p.displayName)

    // Riverside staff, yes. Downtown-only staff, no.
    expect(names).toContain('Jordan Vega')
    expect(names, 'Downtown’s manager must not appear in Riverside’s directory').not.toContain(
      'Tess Nakamura',
    )
    expect(names).not.toContain('Noa Feldman') // assigned to Downtown
  })
})
