import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { newId } from '@/lib/ids'
import { ROLE_KEYS, ROLE_PRESETS } from '@/server/authz/role-presets'
import { DEFAULT_ANNOUNCEMENT_CATEGORIES } from '@/modules/comms/categories'
import * as schema from './full-schema'

/*
 * PROVISIONING A REAL ORGANIZATION.
 *
 * The production-safe counterpart of the seed. It creates exactly what a new
 * customer needs to sign in and set up, and nothing else:
 *
 *   the organization and its locations
 *   the standard roles (from the code presets) and announcement categories
 *   a MANUAL pilot subscription, active, with a billing event
 *   an OWNER INVITATION - a single-use link the owner opens to choose their
 *     own password. It never creates a user, an account or a password, and
 *     never adds demo people, schedules, courses or messages.
 *
 * IDEMPOTENT. Run it again with the same file and nothing is duplicated:
 * existing rows are found by slug, location name, role key and category key,
 * and a pending owner invitation is left alone (pass reissueInvitation to
 * revoke it and issue a new link). A slug already used by a differently named
 * organization is refused rather than modified.
 *
 * DRY RUN BY DEFAULT. Without `apply`, everything runs inside a transaction
 * that is rolled back, so the report is exactly what would happen.
 *
 * Runs as the migration role, from a trusted machine or a protected workflow,
 * never on the web host. See docs/runbooks/provision-organization.md.
 */

type ProvisionDb = NodePgDatabase<typeof schema>

export interface ProvisionSpec {
  organization: {
    name: string
    slug: string
    industry: string
    timezone: string
    jurisdiction?: string | null
  }
  locations: { name: string; timezone: string; city?: string | null; region?: string | null }[]
  owner: { displayName: string; email: string; jobTitle?: string | null }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INDUSTRY = /^[a-z][a-z_]{1,39}$/
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i
const INVITATION_DAYS = 14

function validTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** Validate a provisioning file. Pure. */
export function parseProvisionSpec(
  raw: unknown,
): { ok: true; spec: ProvisionSpec } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | undefined>
  const org = r.organization ?? {}
  const owner = r.owner ?? {}
  const rawLocations = Array.isArray((raw as { locations?: unknown })?.locations)
    ? ((raw as { locations: unknown[] }).locations as Record<string, unknown>[])
    : []

  const name = text(org.name, 120)
  const slug = typeof org.slug === 'string' ? org.slug.trim() : ''
  const industry = typeof org.industry === 'string' ? org.industry.trim() : ''
  if (!name) errors.push('organization.name is required')
  if (!SLUG.test(slug) || slug.length > 48)
    errors.push(
      'organization.slug must be lowercase letters, digits and single hyphens, up to 48 characters',
    )
  if (!INDUSTRY.test(industry))
    errors.push(
      'organization.industry must be a lowercase word such as "restaurant" or "salon_spa"',
    )
  if (!validTimeZone(org.timezone))
    errors.push('organization.timezone must be an IANA timezone such as "America/Los_Angeles"')

  if (rawLocations.length === 0) errors.push('at least one location is required')
  const seen = new Set<string>()
  const locations = rawLocations.map((l, index) => {
    const locationName = text(l?.name, 120)
    if (!locationName) errors.push(`locations[${index}].name is required`)
    if (seen.has(locationName.toLowerCase()))
      errors.push(`locations[${index}].name "${locationName}" is repeated`)
    seen.add(locationName.toLowerCase())
    if (!validTimeZone(l?.timezone))
      errors.push(`locations[${index}].timezone must be an IANA timezone`)
    return {
      name: locationName,
      timezone: typeof l?.timezone === 'string' ? l.timezone : '',
      city: text(l?.city, 80) || null,
      region: text(l?.region, 80) || null,
    }
  })

  const displayName = text(owner.displayName, 120)
  const email = typeof owner.email === 'string' ? owner.email.trim().toLowerCase() : ''
  if (!displayName) errors.push('owner.displayName is required')
  if (!EMAIL.test(email)) errors.push('owner.email must be an email address')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    spec: {
      organization: {
        name,
        slug,
        industry,
        timezone: org.timezone as string,
        jurisdiction: text(org.jurisdiction, 60) || null,
      },
      locations,
      owner: { displayName, email, jobTitle: text(owner.jobTitle, 80) || null },
    },
  }
}

export type Action = 'created' | 'exists'

export interface ProvisionReport {
  applied: boolean
  organization: { id: string; action: Action }
  locations: { name: string; action: Action; note?: string }[]
  roles: { created: number; existing: number }
  categories: { created: number; existing: number }
  subscription: Action
  owner:
    | { action: 'invited' | 'reissued'; acceptUrl: string | null; expiresAt: Date }
    | { action: 'invitation_pending'; expiresAt: Date }
    | { action: 'already_member' }
  notes: string[]
}

class DryRun extends Error {
  constructor(readonly report: ProvisionReport) {
    super('dry run')
  }
}

export async function provisionOrganization(
  db: ProvisionDb,
  spec: ProvisionSpec,
  options: { apply: boolean; appUrl: string; reissueInvitation?: boolean; now?: Date },
): Promise<ProvisionReport> {
  const now = options.now ?? new Date()
  try {
    return await db.transaction(async (tx) => {
      const report = await provision(tx, spec, options, now)
      if (!options.apply) throw new DryRun(report)
      return report
    })
  } catch (error) {
    if (error instanceof DryRun) return error.report
    throw error
  }
}

async function provision(
  tx: ProvisionDb,
  spec: ProvisionSpec,
  options: { apply: boolean; appUrl: string; reissueInvitation?: boolean },
  now: Date,
): Promise<ProvisionReport> {
  const notes: string[] = []
  const audit: (typeof schema.auditEvents.$inferInsert)[] = []

  // --- the organization ------------------------------------------------------
  const [existing] = await tx
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, spec.organization.slug))
    .for('update')
    .limit(1)
  let organizationId: string
  let orgAction: Action
  if (existing) {
    if (existing.name !== spec.organization.name) {
      throw new Error(
        `The slug "${spec.organization.slug}" already belongs to "${existing.name}", not "${spec.organization.name}". Nothing was changed.`,
      )
    }
    organizationId = existing.id
    orgAction = 'exists'
    if (existing.industry !== spec.organization.industry) {
      notes.push(
        `Industry is "${existing.industry}"; the file says "${spec.organization.industry}". It was not changed.`,
      )
    }
  } else {
    organizationId = newId()
    orgAction = 'created'
    await tx.insert(schema.organizations).values({
      id: organizationId,
      name: spec.organization.name,
      slug: spec.organization.slug,
      industry: spec.organization.industry,
      timezone: spec.organization.timezone,
      jurisdiction: spec.organization.jurisdiction ?? null,
      status: 'active',
    })
  }
  const event = (
    action: string,
    summary: string,
    extra: Partial<typeof schema.auditEvents.$inferInsert> = {},
  ) =>
    audit.push({
      id: newId(),
      organizationId,
      actorType: 'system',
      actorLabel: 'EverCalm provisioning',
      action,
      summary,
      createdAt: now,
      ...extra,
    })
  if (orgAction === 'created') {
    event('organization.created', `Provisioned workspace "${spec.organization.name}"`, {
      subjectType: 'organization',
      subjectId: organizationId,
    })
  }

  // --- locations -------------------------------------------------------------
  const currentLocations = await tx
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.organizationId, organizationId))
  const locations: ProvisionReport['locations'] = []
  const locationIds: string[] = []
  for (const location of spec.locations) {
    const found = currentLocations.find((l) => l.name.toLowerCase() === location.name.toLowerCase())
    if (found) {
      locationIds.push(found.id)
      locations.push({
        name: location.name,
        action: 'exists',
        note:
          found.timezone !== location.timezone
            ? `timezone is ${found.timezone}; not changed`
            : undefined,
      })
      continue
    }
    const id = newId()
    locationIds.push(id)
    await tx.insert(schema.locations).values({
      id,
      organizationId,
      name: location.name,
      timezone: location.timezone,
      city: location.city ?? null,
      region: location.region ?? null,
      country: 'US',
      status: 'active',
    })
    event('location.created', `Created location "${location.name}"`, {
      subjectType: 'location',
      subjectId: id,
      locationId: id,
    })
    locations.push({ name: location.name, action: 'created' })
  }

  // --- roles -----------------------------------------------------------------
  const currentRoles = await tx
    .select({ id: schema.roles.id, key: schema.roles.key })
    .from(schema.roles)
    .where(eq(schema.roles.organizationId, organizationId))
  let rolesCreated = 0
  let ownerRoleId = currentRoles.find((r) => r.key === 'owner')?.id
  for (const key of ROLE_KEYS) {
    if (currentRoles.some((r) => r.key === key)) continue
    const preset = ROLE_PRESETS[key]
    const roleId = newId()
    if (key === 'owner') ownerRoleId = roleId
    await tx.insert(schema.roles).values({
      id: roleId,
      organizationId,
      key: preset.key,
      name: preset.name,
      description: preset.description,
      isSystem: true,
    })
    if (preset.capabilities.length) {
      await tx.insert(schema.roleCapabilities).values(
        preset.capabilities.map((capability) => ({
          id: newId(),
          organizationId,
          roleId,
          capability,
        })),
      )
    }
    rolesCreated += 1
  }

  // --- announcement categories -------------------------------------------------
  const currentCategories = await tx
    .select({ key: schema.announcementCategories.key })
    .from(schema.announcementCategories)
    .where(eq(schema.announcementCategories.organizationId, organizationId))
  let categoriesCreated = 0
  for (const [index, category] of DEFAULT_ANNOUNCEMENT_CATEGORIES.entries()) {
    if (currentCategories.some((c) => c.key === category.key)) continue
    await tx.insert(schema.announcementCategories).values({
      id: newId(),
      organizationId,
      key: category.key,
      name: category.name,
      description: category.description,
      position: index,
      overridesPreferences: category.overridesPreferences,
    })
    categoriesCreated += 1
  }

  // --- a manual pilot subscription ----------------------------------------------
  const [subscription] = await tx
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.organizationId, organizationId))
  let subscriptionAction: Action = 'exists'
  if (!subscription) {
    const subscriptionId = newId()
    await tx.insert(schema.subscriptions).values({
      id: subscriptionId,
      organizationId,
      plan: 'pilot',
      status: 'active',
      provider: 'manual',
      currentPeriodStart: now,
    })
    await tx
      .insert(schema.billingEvents)
      .values({
        id: newId(),
        organizationId,
        subscriptionId,
        type: 'pilot_started',
        source: 'system',
        idempotencyKey: `provision:pilot_started:${organizationId}`,
        toStatus: 'active',
        summary:
          'Pilot started. Billing is arranged directly with EverCalm; nothing is charged here.',
        actorLabel: 'EverCalm provisioning',
        occurredAt: now,
      })
      .onConflictDoNothing()
    event('billing.provisioned', 'Started a manual pilot subscription', {
      subjectType: 'subscription',
      subjectId: subscriptionId,
    })
    subscriptionAction = 'created'
  } else {
    const [row] = await tx
      .select({ provider: schema.subscriptions.provider })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, subscription.id))
    if (row?.provider !== 'manual')
      notes.push(
        `The existing subscription uses the "${row?.provider}" provider; it was not changed.`,
      )
  }

  // --- the owner ----------------------------------------------------------------
  const email = spec.owner.email.toLowerCase()
  let owner: ProvisionReport['owner']
  const [member] = await tx
    .select({ id: schema.employments.id })
    .from(schema.employments)
    .where(
      and(
        eq(schema.employments.organizationId, organizationId),
        sql`lower(${schema.employments.email}) = ${email}`,
        inArray(schema.employments.status, ['active', 'invited']),
        sql`${schema.employments.userId} is not null`,
      ),
    )
    .limit(1)
  if (member) {
    owner = { action: 'already_member' }
  } else {
    const [pending] = await tx
      .select({ id: schema.invitations.id, expiresAt: schema.invitations.expiresAt })
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.organizationId, organizationId),
          eq(schema.invitations.email, email),
          eq(schema.invitations.status, 'pending'),
          gt(schema.invitations.expiresAt, now),
        ),
      )
      .for('update')
      .limit(1)
    if (pending && !options.reissueInvitation) {
      owner = { action: 'invitation_pending', expiresAt: pending.expiresAt }
    } else {
      if (pending) {
        await tx
          .update(schema.invitations)
          .set({ status: 'revoked', revokedAt: now, updatedAt: now })
          .where(eq(schema.invitations.id, pending.id))
        event('invitation.revoked', 'Revoked the owner invitation to issue a new link', {
          subjectType: 'invitation',
          subjectId: pending.id,
        })
      }
      if (!ownerRoleId) throw new Error('The owner role is missing.')
      const token = randomBytes(32).toString('base64url')
      const invitationId = newId()
      const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 86_400_000)
      await tx.insert(schema.invitations).values({
        id: invitationId,
        organizationId,
        email,
        displayName: spec.owner.displayName,
        jobTitle: spec.owner.jobTitle ?? 'Owner',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        roleId: ownerRoleId,
        roleScope: 'org',
        scopeLocationId: null,
        homeLocationId: locationIds[0] ?? null,
        locationIds,
        jobRoleIds: [],
        status: 'pending',
        expiresAt,
        invitedByEmploymentId: null,
        createdAt: now,
        updatedAt: now,
        lastSentAt: now,
      })
      // The address stays out of the audit log, as for every invitation.
      event('invitation.sent', `Invited ${spec.owner.displayName} as Owner`, {
        subjectType: 'invitation',
        subjectId: invitationId,
        metadata: { role: 'owner', scope: 'org' },
      })
      owner = {
        action: pending ? 'reissued' : 'invited',
        // A dry run's token is rolled back with everything else, so no link is shown.
        acceptUrl: options.apply ? `${options.appUrl.replace(/\/$/, '')}/invite/${token}` : null,
        expiresAt,
      }
    }
  }

  if (audit.length) await tx.insert(schema.auditEvents).values(audit)

  return {
    applied: options.apply,
    organization: { id: organizationId, action: orgAction },
    locations,
    roles: { created: rolesCreated, existing: currentRoles.length },
    categories: { created: categoriesCreated, existing: currentCategories.length },
    subscription: subscriptionAction,
    owner,
    notes,
  }
}
