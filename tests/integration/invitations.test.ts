import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  acceptInvitation,
  createInvitation,
  effectiveStatus,
  hashToken,
  listInvitations,
  previewInvitation,
  resendInvitation,
  revokeInvitation,
  tokenMatchesHash,
} from '@/modules/invitations/service'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import {
  appDrizzle,
  asTenant,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
} from '../helpers/tenant'

/**
 * INVITATION SECURITY.
 *
 * The invitation is the only anonymous write path in EverCalm, so its
 * properties are asserted rather than assumed: hashed storage, single use,
 * expiry, revocation that kills outstanding links, resend that rotates the
 * token, rate limiting, and no enumeration.
 */

const APP_URL = 'http://localhost:3000'

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

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 10_000)}@example.test`
}

describe('token handling', () => {
  it('stores only a hash, never the token', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const email = uniqueEmail('hashcheck')

    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email,
          displayName: 'Hash Check',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const pool = await migrationClient()
    const { rows } = await pool.query<{ token_hash: string }>(
      'select token_hash from invitations where id = $1',
      [issued.invitationId],
    )
    const stored = rows[0]!.token_hash

    expect(stored).not.toBe(issued.token)
    expect(stored).toBe(hashToken(issued.token))
    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    // The raw token must appear nowhere in the row.
    const all = await pool.query('select * from invitations where id = $1', [issued.invitationId])
    expect(JSON.stringify(all.rows[0])).not.toContain(issued.token)
  })

  it('compares tokens in constant time and rejects a near miss', () => {
    const hash = hashToken('correct-token-value-aaaaaaaaaaaaaaaa')
    expect(tokenMatchesHash('correct-token-value-aaaaaaaaaaaaaaaa', hash)).toBe(true)
    expect(tokenMatchesHash('correct-token-value-aaaaaaaaaaaaaaab', hash)).toBe(false)
    expect(tokenMatchesHash('', hash)).toBe(false)
  })
})

describe('acceptance', () => {
  it('creates the employment, grant, and location assignment in one go', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const pool = await migrationClient()
    const { rows: locationRows } = await pool.query<{ id: string }>(
      'select id from locations where organization_id = $1 order by name limit 1',
      [harborId],
    )
    const locationId = locationRows[0]!.id
    const email = uniqueEmail('accepts')

    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email,
          displayName: 'Accepting Person',
          jobTitle: 'Server',
          roleKey: 'employee',
          scope: 'location',
          scopeLocationId: locationId,
          homeLocationId: locationId,
          locationIds: [locationId],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const userId = newId()
    await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [
      userId,
      'Accepting Person',
      email,
    ])

    const result = await asTenant(harborId, (tx) =>
      acceptInvitation(tx, harborId, issued.token, userId),
    )

    expect(result.displayName).toBe('Accepting Person')

    const employment = await pool.query<{
      status: string
      job_title: string
      home_location_id: string
    }>('select status, job_title, home_location_id from employments where id = $1', [
      result.employmentId,
    ])
    expect(employment.rows[0]?.status).toBe('active')
    expect(employment.rows[0]?.job_title).toBe('Server')
    expect(employment.rows[0]?.home_location_id).toBe(locationId)

    const grants = await pool.query('select id from role_grants where employment_id = $1', [
      result.employmentId,
    ])
    expect(grants.rows).toHaveLength(1)
  })

  it('REFUSES a second use of the same token', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const email = uniqueEmail('singleuse')
    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email,
          displayName: 'Single Use',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const pool = await migrationClient()
    const firstUser = newId()
    await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [
      firstUser,
      'Single Use',
      email,
    ])
    await asTenant(harborId, (tx) => acceptInvitation(tx, harborId, issued.token, firstUser))

    const secondUser = newId()
    await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [
      secondUser,
      'Replay Attempt',
      uniqueEmail('replay'),
    ])

    await expect(
      asTenant(harborId, (tx) => acceptInvitation(tx, harborId, issued.token, secondUser)),
    ).rejects.toThrow(NotFoundError)
  })

  it('REFUSES an expired invitation', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('expired'),
          displayName: 'Expired Invite',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const pool = await migrationClient()
    await pool.query("update invitations set expires_at = now() - interval '1 day' where id = $1", [
      issued.invitationId,
    ])

    const db = await appDrizzle()
    expect(await previewInvitation(db, issued.token)).toBeNull()

    const userId = newId()
    await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [
      userId,
      'Expired',
      uniqueEmail('expireduser'),
    ])
    await expect(
      asTenant(harborId, (tx) => acceptInvitation(tx, harborId, issued.token, userId)),
    ).rejects.toThrow(NotFoundError)
  })

  it('kills any outstanding link when an invitation is revoked', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('revoked'),
          displayName: 'Revoked Invite',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const db = await appDrizzle()
    expect(await previewInvitation(db, issued.token)).not.toBeNull()

    await asTenant(harborId, (tx) => revokeInvitation(tx, dana, issued.invitationId))

    expect(await previewInvitation(db, issued.token)).toBeNull()
  })

  it('rotates the token on resend, breaking the previous link', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('resend'),
          displayName: 'Resend Invite',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    // Step past the resend cooldown.
    const pool = await migrationClient()
    await pool.query(
      "update invitations set last_sent_at = now() - interval '5 minutes' where id = $1",
      [issued.invitationId],
    )

    const reissued = await asTenant(harborId, (tx) =>
      resendInvitation(tx, dana, issued.invitationId, APP_URL),
    )

    expect(reissued.token).not.toBe(issued.token)

    const db = await appDrizzle()
    expect(await previewInvitation(db, issued.token), 'the old link must be dead').toBeNull()
    expect(await previewInvitation(db, reissued.token)).not.toBeNull()
  })

  it('enforces a resend cooldown', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('cooldown'),
          displayName: 'Cooldown',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )
    await expect(
      asTenant(harborId, (tx) => resendInvitation(tx, dana, issued.invitationId, APP_URL)),
    ).rejects.toThrow(ValidationError)
  })
})

describe('enumeration resistance', () => {
  it('returns nothing for an invented token', async () => {
    const db = await appDrizzle()
    expect(await previewInvitation(db, 'a'.repeat(43))).toBeNull()
    expect(await previewInvitation(db, 'short')).toBeNull()
    expect(await previewInvitation(db, '')).toBeNull()
  })

  it('never reveals the invited address through the preview', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const email = uniqueEmail('secret')
    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email,
          displayName: 'Secret Person',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const db = await appDrizzle()
    const preview = await previewInvitation(db, issued.token)
    expect(preview).not.toBeNull()
    // The preview carries the organization, and deliberately nothing personal.
    expect(JSON.stringify(preview)).not.toContain(email)
    expect(JSON.stringify(preview)).not.toContain('Secret Person')
  })

  it('cannot be used to read another tenant’s invitation as a tenant query', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')

    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('crosstenant'),
          displayName: 'Cross Tenant',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const salonInvitations = await asTenant(lumenId, (tx) => listInvitations(tx, ana))
    expect(salonInvitations.map((i) => i.id)).not.toContain(issued.invitationId)

    // Even holding the id, the salon cannot revoke the restaurant's invitation.
    await expect(
      asTenant(lumenId, (tx) => revokeInvitation(tx, ana, issued.invitationId)),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('authorization', () => {
  it('refuses an employee with no capabilities', async () => {
    const sam = await actorFor(harborId, 'sam@harborvine.test')
    await expect(
      asTenant(harborId, (tx) =>
        createInvitation(
          tx,
          sam,
          {
            email: uniqueEmail('nope'),
            displayName: 'Should Not Work',
            roleKey: 'employee',
            scope: 'org',
            locationIds: [],
            jobRoleIds: [],
          },
          APP_URL,
        ),
      ),
    ).rejects.toThrow(ForbiddenError)
  })

  it('refuses a location manager inviting into a location they do not manage', async () => {
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    const pool = await migrationClient()
    const { rows } = await pool.query<{ id: string; name: string }>(
      'select id, name from locations where organization_id = $1 order by name',
      [harborId],
    )
    const downtown = rows.find((r) => r.name === 'Downtown')!

    await expect(
      asTenant(harborId, (tx) =>
        createInvitation(
          tx,
          marcus,
          {
            email: uniqueEmail('wrongsite'),
            displayName: 'Wrong Site',
            roleKey: 'employee',
            scope: 'location',
            scopeLocationId: downtown.id,
            locationIds: [downtown.id],
            jobRoleIds: [],
          },
          APP_URL,
        ),
      ),
    ).rejects.toThrow(ForbiddenError)
  })

  it('refuses inviting somebody who already works here', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    await expect(
      asTenant(harborId, (tx) =>
        createInvitation(
          tx,
          dana,
          {
            email: 'sam@harborvine.test',
            displayName: 'Sam Again',
            roleKey: 'employee',
            scope: 'org',
            locationIds: [],
            jobRoleIds: [],
          },
          APP_URL,
        ),
      ),
    ).rejects.toThrow(ValidationError)
  })
})

describe('status derivation', () => {
  it('reports an unswept past-expiry invitation as expired', () => {
    const past = new Date(Date.now() - 1000)
    const future = new Date(Date.now() + 86_400_000)
    expect(effectiveStatus({ status: 'pending', expiresAt: past })).toBe('expired')
    expect(effectiveStatus({ status: 'pending', expiresAt: future })).toBe('pending')
    expect(effectiveStatus({ status: 'accepted', expiresAt: past })).toBe('accepted')
    expect(effectiveStatus({ status: 'revoked', expiresAt: future })).toBe('revoked')
  })
})

describe('rate limiting', () => {
  it('stops an organization sending an unbounded burst', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const pool = await migrationClient()

    // Fill the rolling hour window directly, rather than sending 50 emails.
    const { rows: roleRows } = await pool.query<{ id: string }>(
      "select id from roles where organization_id = $1 and key = 'employee'",
      [lumenId],
    )
    const roleId = roleRows[0]!.id
    for (let i = 0; i < 50; i += 1) {
      await pool.query(
        `insert into invitations
           (id, organization_id, email, display_name, token_hash, role_id, role_scope, status, expires_at)
         values ($1, $2, $3, 'Burst', $4, $5, 'org', 'revoked', now() + interval '14 days')`,
        [newId(), lumenId, uniqueEmail(`burst${i}`), `burst-hash-${newId()}`, roleId],
      )
    }

    await expect(
      asTenant(lumenId, (tx) =>
        createInvitation(
          tx,
          ana,
          {
            email: uniqueEmail('overlimit'),
            displayName: 'Over Limit',
            roleKey: 'employee',
            scope: 'org',
            locationIds: [],
            jobRoleIds: [],
          },
          APP_URL,
        ),
      ),
    ).rejects.toThrow(/rate limit/i)

    // Clean up so later tests in this file are unaffected.
    await pool.query("delete from invitations where display_name = 'Burst'")
  })
})

describe('the SECURITY DEFINER lookup', () => {
  it('is SECURITY DEFINER with a pinned, public-free search_path', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc where proname = 'evercalm_invitation_by_token'`,
    )
    expect(rows[0]?.prosecdef, 'must be SECURITY DEFINER').toBe(true)

    const config = rows[0]?.proconfig?.join(',') ?? ''
    expect(config, 'search_path must be pinned').toMatch(/search_path=/)
    // `public` is deliberately absent: every reference in the body is
    // schema-qualified, so nothing a caller could create can shadow a table.
    expect(config).toContain('pg_catalog')
    expect(config).not.toMatch(/search_path=[^,]*\bpublic\b/)
  })

  it('schema-qualifies every object it references', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ body: string }>(
      `select prosrc as body from pg_proc where proname = 'evercalm_invitation_by_token'`,
    )
    const body = rows[0]!.body
    expect(body).toContain('public.invitations')
    expect(body).toContain('public.organizations')
    // No bare table reference that a shadowing object could intercept.
    expect(body).not.toMatch(/FROM\s+invitations/i)
    expect(body).not.toMatch(/JOIN\s+organizations/i)
  })

  it('is not executable by PUBLIC, and is executable by the runtime role', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ pub: boolean; app: boolean }>(
      `select has_function_privilege('public', 'evercalm_invitation_by_token(text)', 'execute') as pub,
              has_function_privilege('evercalm_app', 'evercalm_invitation_by_token(text)', 'execute') as app`,
    )
    expect(rows[0]?.pub, 'PUBLIC must not be able to execute it').toBe(false)
    expect(rows[0]?.app, 'the runtime role needs it').toBe(true)
  })

  it('is executable by no role beyond the runtime role', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ rolname: string }>(
      `select rolname from pg_roles
        where rolname not like 'pg\\_%'
          and rolname <> 'postgres'
          and has_function_privilege(rolname, 'evercalm_invitation_by_token(text)', 'execute')
        order by rolname`,
    )
    // The migrator owns it, so it has execute implicitly. Nothing else beyond
    // the runtime role should.
    expect(rows.map((r) => r.rolname).sort()).toEqual(['evercalm_app', 'evercalm_migrator'])
  })

  it('returns the minimum: an organization id and an expiry, nothing else', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const issued = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('minimal'),
          displayName: 'Minimal Disclosure',
          jobTitle: 'Server',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const db = await appDrizzle()
    const result = await db.execute(
      sql`select * from evercalm_invitation_by_token(${hashToken(issued.token)})`,
    )
    expect(result.rows).toHaveLength(1)

    const row = result.rows[0] as Record<string, unknown>
    expect(Object.keys(row).sort()).toEqual(['expires_at', 'organization_id'])

    // No name, no email, no job title, no organization name, no invitation id.
    const serialised = JSON.stringify(row)
    expect(serialised).not.toContain('Minimal Disclosure')
    expect(serialised).not.toContain('Server')
    expect(serialised).not.toMatch(/Harbor/i)
    expect(serialised).not.toContain(issued.invitationId)
  })

  it('gives a constant-shape empty answer to every kind of bad token', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const db = await appDrizzle()
    const pool = await migrationClient()

    async function probe(token: string) {
      return db.execute(sql`select * from evercalm_invitation_by_token(${hashToken(token)})`)
    }

    // 1. Invented.
    const invented = await probe('z'.repeat(43))

    // 2. Revoked.
    const revokedInvite = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('shape-revoked'),
          displayName: 'Revoked',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )
    await asTenant(harborId, (tx) => revokeInvitation(tx, dana, revokedInvite.invitationId))
    const revoked = await probe(revokedInvite.token)

    // 3. Expired.
    const expiredInvite = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('shape-expired'),
          displayName: 'Expired',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )
    await pool.query("update invitations set expires_at = now() - interval '1 day' where id = $1", [
      expiredInvite.invitationId,
    ])
    const expired = await probe(expiredInvite.token)

    // 4. Already accepted.
    const acceptedInvite = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('shape-accepted'),
          displayName: 'Accepted',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )
    const acceptUser = newId()
    await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [
      acceptUser,
      'Accepted',
      uniqueEmail('shape-accepted-user'),
    ])
    await asTenant(harborId, (tx) =>
      acceptInvitation(tx, harborId, acceptedInvite.token, acceptUser),
    )
    const accepted = await probe(acceptedInvite.token)

    // 5. Superseded by a resend.
    const supersededInvite = await asTenant(harborId, (tx) =>
      createInvitation(
        tx,
        dana,
        {
          email: uniqueEmail('shape-superseded'),
          displayName: 'Superseded',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )
    await pool.query(
      "update invitations set last_sent_at = now() - interval '5 minutes' where id = $1",
      [supersededInvite.invitationId],
    )
    await asTenant(harborId, (tx) =>
      resendInvitation(tx, dana, supersededInvite.invitationId, APP_URL),
    )
    const superseded = await probe(supersededInvite.token)

    // Every one of them is indistinguishable: zero rows, no error, no hint.
    for (const [label, result] of [
      ['invented', invented],
      ['revoked', revoked],
      ['expired', expired],
      ['accepted', accepted],
      ['superseded', superseded],
    ] as const) {
      expect(result.rows, `${label} must return no rows`).toHaveLength(0)
    }
  })

  it('cannot be used to enumerate invitations or cross a tenant boundary', async () => {
    const db = await appDrizzle()
    const pool = await migrationClient()

    // There ARE live invitations in both tenants.
    const live = await pool.query<{ c: number }>(
      "select count(*)::int c from invitations where status = 'pending'",
    )
    expect(live.rows[0]!.c).toBeGreaterThan(0)

    // But the function takes only a hash, and a wrong hash yields nothing.
    // There is no argument that returns a list.
    for (const probe of ['', '0'.repeat(64), 'not-a-hash', '%', "' or '1'='1"]) {
      const result = await db.execute(sql`select * from evercalm_invitation_by_token(${probe})`)
      expect(result.rows, `probe ${JSON.stringify(probe)} leaked rows`).toHaveLength(0)
    }
  })

  it('resolves a live token to the right tenant, and only that tenant', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const salonInvite = await asTenant(lumenId, (tx) =>
      createInvitation(
        tx,
        ana,
        {
          email: uniqueEmail('tenant-check'),
          displayName: 'Salon Invitee',
          roleKey: 'employee',
          scope: 'org',
          locationIds: [],
          jobRoleIds: [],
        },
        APP_URL,
      ),
    )

    const db = await appDrizzle()
    const result = await db.execute<{ organization_id: string }>(
      sql`select * from evercalm_invitation_by_token(${hashToken(salonInvite.token)})`,
    )
    expect(result.rows[0]!.organization_id).toBe(lumenId)
    expect(result.rows[0]!.organization_id).not.toBe(harborId)
  })
})
