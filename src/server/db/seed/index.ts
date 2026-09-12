import { hash as argon2Hash } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { newId } from '@/lib/ids'
import { ROLE_PRESETS, ROLE_KEYS } from '@/server/authz/role-presets'
import * as schema from '../full-schema'
import { SEED_ORGANIZATIONS, SEED_PASSWORD, type SeedOrganization } from './data'

/**
 * Idempotent seed.
 *
 * Runs as the MIGRATION role, which owns the tables and is therefore exempt
 * from the tenant policies - that is precisely why seeding uses a different
 * role from the one that serves requests.
 *
 * Re-running is safe: an organization that already exists is skipped rather
 * than duplicated.
 */

type SeedDb = NodePgDatabase<typeof schema>

// Must match src/server/auth/index.ts, or seeded passwords will not verify.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export interface SeedSummary {
  organizations: {
    name: string
    slug: string
    industry: string
    created: boolean
    locations: number
    people: number
    roles: number
    grants: number
    capabilities: number
  }[]
}

export async function seedAll(db: SeedDb): Promise<SeedSummary> {
  const summary: SeedSummary = { organizations: [] }
  for (const org of SEED_ORGANIZATIONS) {
    summary.organizations.push(await seedOrganization(db, org))
  }
  return summary
}

async function seedOrganization(db: SeedDb, seed: SeedOrganization) {
  const existing = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, seed.slug))
    .limit(1)

  if (existing[0]) {
    return {
      name: seed.name,
      slug: seed.slug,
      industry: seed.industry,
      created: false,
      locations: 0,
      people: 0,
      roles: 0,
      grants: 0,
      capabilities: 0,
    }
  }

  const organizationId = newId()
  await db.insert(schema.organizations).values({
    id: organizationId,
    name: seed.name,
    slug: seed.slug,
    industry: seed.industry,
    timezone: seed.timezone,
    jurisdiction: seed.jurisdiction,
    status: 'active',
  })

  const auditRows: (typeof schema.auditEvents.$inferInsert)[] = [
    {
      id: newId(),
      organizationId,
      actorType: 'system',
      actorLabel: 'Seed',
      action: 'organization.created',
      subjectType: 'organization',
      subjectId: organizationId,
      summary: `Created workspace "${seed.name}"`,
      metadata: { industry: seed.industry },
    },
  ]

  // --- locations -----------------------------------------------------------
  const locationIds = new Map<string, string>()
  for (const location of seed.locations) {
    const id = newId()
    locationIds.set(location.key, id)
    await db.insert(schema.locations).values({
      id,
      organizationId,
      name: location.name,
      timezone: location.timezone,
      city: location.city,
      region: location.region,
      country: 'US',
      status: 'active',
    })
    auditRows.push({
      id: newId(),
      organizationId,
      actorType: 'system',
      actorLabel: 'Seed',
      action: 'location.created',
      subjectType: 'location',
      subjectId: id,
      locationId: id,
      summary: `Created location "${location.name}"`,
      metadata: { timezone: location.timezone },
    })
  }

  // --- roles from the code presets ----------------------------------------
  const roleIds = new Map<string, string>()
  let capabilityCount = 0
  for (const key of ROLE_KEYS) {
    const preset = ROLE_PRESETS[key]
    const roleId = newId()
    roleIds.set(key, roleId)
    await db.insert(schema.roles).values({
      id: roleId,
      organizationId,
      key: preset.key,
      name: preset.name,
      description: preset.description,
      isSystem: true,
    })
    if (preset.capabilities.length > 0) {
      await db.insert(schema.roleCapabilities).values(
        preset.capabilities.map((capability) => ({
          id: newId(),
          organizationId,
          roleId,
          capability,
        })),
      )
      capabilityCount += preset.capabilities.length
    }
  }

  // --- people --------------------------------------------------------------
  const passwordHash = await argon2Hash(SEED_PASSWORD, ARGON2_OPTIONS)
  let grantCount = 0

  for (const person of seed.people) {
    // A global user may already exist from another seeded tenant.
    const existingUser = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, person.email))
      .limit(1)

    let userId = existingUser[0]?.id
    if (!userId) {
      userId = newId()
      await db.insert(schema.users).values({
        id: userId,
        name: person.displayName,
        email: person.email,
        emailVerified: true,
      })
      await db.insert(schema.accounts).values({
        id: newId(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: passwordHash,
      })
    }

    const employmentId = newId()
    const homeLocationKey = person.locations[0]
    await db.insert(schema.employments).values({
      id: employmentId,
      organizationId,
      userId,
      displayName: person.displayName,
      status: person.status ?? 'active',
      homeLocationId: homeLocationKey ? (locationIds.get(homeLocationKey) ?? null) : null,
      email: person.email,
    })

    for (const locationKey of person.locations) {
      const locationId = locationIds.get(locationKey)
      if (!locationId) continue
      await db.insert(schema.employmentLocations).values({
        id: newId(),
        organizationId,
        employmentId,
        locationId,
      })
    }

    for (const grant of person.grants) {
      const roleId = roleIds.get(grant.role)
      if (!roleId) continue
      const locationId = grant.location ? (locationIds.get(grant.location) ?? null) : null
      await db.insert(schema.roleGrants).values({
        id: newId(),
        organizationId,
        employmentId,
        roleId,
        scope: locationId ? 'location' : 'org',
        locationId,
      })
      grantCount += 1
      auditRows.push({
        id: newId(),
        organizationId,
        actorType: 'system',
        actorLabel: 'Seed',
        action: 'role_grant.granted',
        subjectType: 'employment',
        subjectId: employmentId,
        locationId,
        summary: `Granted ${ROLE_PRESETS[grant.role].name} to ${person.displayName}${
          locationId ? ` at ${grant.location}` : ' organization-wide'
        }`,
        metadata: { role: grant.role, scope: locationId ? 'location' : 'org' },
      })
    }
  }

  await db.insert(schema.auditEvents).values(auditRows)

  return {
    name: seed.name,
    slug: seed.slug,
    industry: seed.industry,
    created: true,
    locations: seed.locations.length,
    people: seed.people.length,
    roles: ROLE_KEYS.length,
    grants: grantCount,
    capabilities: capabilityCount,
  }
}

export { SEED_ORGANIZATIONS, SEED_PASSWORD } from './data'
