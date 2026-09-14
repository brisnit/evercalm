import { hash as argon2Hash } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { newId } from '@/lib/ids'
import { addCalendarDays } from '@/lib/dates'
import { ROLE_KEYS, ROLE_PRESETS } from '@/server/authz/role-presets'
import * as schema from '../full-schema'
import { DEFAULT_ANNOUNCEMENT_CATEGORIES } from '@/modules/comms/categories'
import { deliveryPolicy } from '@/modules/comms/delivery-policy'
import { SEED_ORGANIZATIONS, SEED_PASSWORD, type SeedOrganization } from './data'
import { seedScheduling } from './scheduling'

/**
 * Idempotent seed.
 *
 * Runs as the MIGRATION role, which owns the tables and is therefore exempt
 * from the tenant policies - precisely why seeding uses a different role from
 * the one that serves requests.
 *
 * Re-running is safe: an organization that already exists is skipped rather
 * than duplicated.
 */

type SeedDb = NodePgDatabase<typeof schema>

// Must match src/server/auth/index.ts, or seeded passwords will not verify.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export interface SeedOrganizationSummary {
  name: string
  slug: string
  industry: string
  created: boolean
  locations: number
  departments: number
  jobRoles: number
  stations: number
  values: number
  onboardingTemplates: number
  people: number
  roles: number
  grants: number
  credentials: number
  onboardingAssignments: number
  announcements: number
  shifts: number
}

export interface SeedSummary {
  organizations: SeedOrganizationSummary[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Resolve a seeded audience to person keys.
 *
 * A small mirror of the real resolver in modules/comms/audience.ts, working on
 * seed keys rather than rows because the seed writes recipients directly.
 * Kept deliberately simple: include is a union, exclude is subtracted, and
 * exclude wins - the same three rules the product enforces.
 */
function resolveSeedAudience(
  seed: SeedOrganization,
  rules: NonNullable<SeedOrganization['announcements']>[number]['audience'],
): string[] {
  const roleDepartment = new Map(seed.jobRoles.map((r) => [r.key, r.department]))
  const teamMembers = new Map((seed.teams ?? []).map((t) => [t.key, t.members]))

  const matches = (rule: (typeof rules)[number]): string[] => {
    switch (rule.type) {
      case 'organization':
        return seed.people.map((p) => p.key)
      case 'location':
        return seed.people.filter((p) => p.locations.includes(rule.ref ?? '')).map((p) => p.key)
      case 'job_role':
        return seed.people.filter((p) => p.jobRoles?.includes(rule.ref ?? '')).map((p) => p.key)
      case 'department':
        return seed.people
          .filter((p) => (p.jobRoles ?? []).some((r) => roleDepartment.get(r) === rule.ref))
          .map((p) => p.key)
      case 'team':
        return teamMembers.get(rule.ref ?? '') ?? []
      case 'employment':
        return rule.ref ? [rule.ref] : []
      default:
        return []
    }
  }

  const included = new Set<string>()
  for (const rule of rules) {
    if ((rule.mode ?? 'include') !== 'include') continue
    for (const key of matches(rule)) included.add(key)
  }
  for (const rule of rules) {
    if ((rule.mode ?? 'include') !== 'exclude') continue
    for (const key of matches(rule)) included.delete(key)
  }
  return [...included]
}

export async function seedAll(db: SeedDb): Promise<SeedSummary> {
  const summary: SeedSummary = { organizations: [] }
  for (const org of SEED_ORGANIZATIONS) {
    summary.organizations.push(await seedOrganization(db, org))
  }
  return summary
}

function emptySummary(seed: SeedOrganization): SeedOrganizationSummary {
  return {
    name: seed.name,
    slug: seed.slug,
    industry: seed.industry,
    created: false,
    locations: 0,
    departments: 0,
    jobRoles: 0,
    stations: 0,
    values: 0,
    onboardingTemplates: 0,
    people: 0,
    roles: 0,
    grants: 0,
    credentials: 0,
    onboardingAssignments: 0,
    announcements: 0,
    shifts: 0,
  }
}

async function seedOrganization(
  db: SeedDb,
  seed: SeedOrganization,
): Promise<SeedOrganizationSummary> {
  const existing = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, seed.slug))
    .limit(1)

  if (existing[0]) return emptySummary(seed)

  const organizationId = newId()
  const audit: (typeof schema.auditEvents.$inferInsert)[] = []
  const systemEvent = (
    action: string,
    summary: string,
    extra: Partial<typeof schema.auditEvents.$inferInsert> = {},
  ) => {
    audit.push({
      id: newId(),
      organizationId,
      actorType: 'system',
      actorLabel: 'Seed',
      action,
      summary,
      ...extra,
    })
  }

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: seed.name,
    slug: seed.slug,
    industry: seed.industry,
    timezone: seed.timezone,
    jurisdiction: seed.jurisdiction,
    status: 'active',
  })
  systemEvent('organization.created', `Created workspace "${seed.name}"`, {
    subjectType: 'organization',
    subjectId: organizationId,
    metadata: { industry: seed.industry },
  })

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
    systemEvent('location.created', `Created location "${location.name}"`, {
      subjectType: 'location',
      subjectId: id,
      locationId: id,
      metadata: { timezone: location.timezone },
    })
  }

  // --- structure -----------------------------------------------------------
  const departmentIds = new Map<string, string>()
  for (const [index, department] of seed.departments.entries()) {
    const id = newId()
    departmentIds.set(department.key, id)
    await db.insert(schema.departments).values({
      id,
      organizationId,
      name: department.name,
      description: department.description,
      position: index,
    })
  }

  const jobRoleIds = new Map<string, string>()
  for (const [index, role] of seed.jobRoles.entries()) {
    const id = newId()
    jobRoleIds.set(role.key, id)
    await db.insert(schema.jobRoles).values({
      id,
      organizationId,
      departmentId: departmentIds.get(role.department) ?? null,
      name: role.name,
      description: role.description,
      colorToken: role.colorToken,
      position: index,
    })
  }

  for (const [index, station] of seed.stations.entries()) {
    const locationId = locationIds.get(station.location)
    if (!locationId) continue
    await db.insert(schema.stations).values({
      id: newId(),
      organizationId,
      locationId,
      jobRoleId: station.jobRole ? (jobRoleIds.get(station.jobRole) ?? null) : null,
      name: station.name,
      description: station.description ?? null,
      position: index,
    })
  }

  for (const [index, value] of seed.values.entries()) {
    await db.insert(schema.organizationValues).values({
      id: newId(),
      organizationId,
      kind: value.kind,
      title: value.title,
      body: value.body,
      position: index,
    })
  }

  // --- announcement categories ---------------------------------------------
  // Rows, not an enum, so a tenant can rename or extend them. See
  // src/modules/comms/categories.ts for why some override preferences.
  const categoryIds = new Map<string, string>()
  for (const [index, category] of DEFAULT_ANNOUNCEMENT_CATEGORIES.entries()) {
    const id = newId()
    categoryIds.set(category.key, id)
    await db.insert(schema.announcementCategories).values({
      id,
      organizationId,
      key: category.key,
      name: category.name,
      description: category.description,
      position: index,
      overridesPreferences: category.overridesPreferences,
    })
  }

  // --- access roles from the code presets ----------------------------------
  const roleIds = new Map<string, string>()
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
    }
  }

  // --- onboarding templates ------------------------------------------------
  // Each seeded template is created as a PUBLISHED version 1, because demo
  // data should look like a workspace somebody has already set up. The
  // authoring flow starts new templates as drafts.
  const templateIds = new Map<string, string>()
  const templateVersionIds = new Map<string, string>()
  const templateStepIds = new Map<
    string,
    Map<
      string,
      {
        id: string
        sectionTitle: string
        dueDays: number | null
        dueBasis: string
        kind: string
        responsibility: string
        required: boolean
        requiresManagerVerification: boolean
        blocksCompletion: boolean
        instructions: string
        position: number
      }
    >
  >()

  for (const template of seed.onboardingTemplates) {
    const templateId = newId()
    const versionId = newId()
    templateIds.set(template.key, templateId)
    templateVersionIds.set(template.key, versionId)

    await db.insert(schema.onboardingTemplates).values({
      id: templateId,
      organizationId,
      name: template.name,
      description: template.description,
      isDefault: template.isDefault ?? false,
      status: 'published',
      publishedVersionId: versionId,
    })

    await db.insert(schema.onboardingTemplateVersions).values({
      id: versionId,
      organizationId,
      templateId,
      versionNumber: 1,
      status: 'published',
      templateName: template.name,
      publishedAt: new Date(),
    })

    for (const roleKey of template.jobRoles ?? []) {
      const jobRoleId = jobRoleIds.get(roleKey)
      if (!jobRoleId) continue
      await db.insert(schema.onboardingTemplateJobRoles).values({
        id: newId(),
        organizationId,
        templateId,
        jobRoleId,
      })
    }

    for (const locationKey of template.locations ?? []) {
      const locationId = locationIds.get(locationKey)
      if (!locationId) continue
      await db.insert(schema.onboardingTemplateLocations).values({
        id: newId(),
        organizationId,
        templateId,
        locationId,
      })
    }

    const byTitle = new Map<
      string,
      {
        id: string
        sectionTitle: string
        dueDays: number | null
        dueBasis: string
        kind: string
        responsibility: string
        required: boolean
        requiresManagerVerification: boolean
        blocksCompletion: boolean
        instructions: string
        position: number
      }
    >()

    let stepPosition = 0
    for (const [sectionIndex, section] of template.sections.entries()) {
      const sectionId = newId()
      await db.insert(schema.onboardingSections).values({
        id: sectionId,
        organizationId,
        versionId,
        title: section.title,
        description: section.description ?? '',
        position: sectionIndex,
      })

      for (const step of section.steps) {
        const stepId = newId()
        const responsibility =
          step.responsibility ??
          (step.kind === 'manager_task' || step.kind === 'practical_verification'
            ? 'manager'
            : 'employee')
        await db.insert(schema.onboardingSteps).values({
          id: stepId,
          organizationId,
          versionId,
          sectionId,
          title: step.title,
          instructions: step.instructions ?? '',
          kind: step.kind,
          responsibility,
          required: step.required ?? true,
          position: stepPosition,
          dueOffsetDays: step.dueDays ?? null,
          dueOffsetBasis: step.dueBasis ?? 'onboarding_start',
          requiresManagerVerification: step.requiresManagerVerification ?? false,
          blocksCompletion: step.blocksCompletion ?? true,
        })
        byTitle.set(step.title, {
          id: stepId,
          sectionTitle: section.title,
          dueDays: step.dueDays ?? null,
          dueBasis: step.dueBasis ?? 'onboarding_start',
          kind: step.kind,
          responsibility,
          required: step.required ?? true,
          requiresManagerVerification: step.requiresManagerVerification ?? false,
          blocksCompletion: step.blocksCompletion ?? true,
          instructions: step.instructions ?? '',
          position: stepPosition,
        })
        stepPosition += 1
      }
    }

    templateStepIds.set(template.key, byTitle)
    systemEvent(
      'onboarding_template.published',
      `Published version 1 of the "${template.name}" onboarding checklist`,
      {
        subjectType: 'onboarding_template',
        subjectId: templateId,
        metadata: { sections: template.sections.length, steps: stepPosition },
      },
    )
  }

  // --- people --------------------------------------------------------------
  const passwordHash = await argon2Hash(SEED_PASSWORD, ARGON2_OPTIONS)
  const employmentIds = new Map<string, string>()
  let grantCount = 0
  let credentialCount = 0
  let onboardingCount = 0

  // Pass one: identities and employments.
  for (const person of seed.people) {
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
    employmentIds.set(person.key, employmentId)
    const homeLocationKey = person.locations[0]

    await db.insert(schema.employments).values({
      id: employmentId,
      organizationId,
      userId,
      displayName: person.displayName,
      jobTitle: person.jobTitle ?? null,
      status: person.status ?? 'active',
      homeLocationId: homeLocationKey ? (locationIds.get(homeLocationKey) ?? null) : null,
      email: person.email,
      hiredOn: person.hiredOn ?? null,
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

    for (const [index, roleKey] of (person.jobRoles ?? []).entries()) {
      const jobRoleId = jobRoleIds.get(roleKey)
      if (!jobRoleId) continue
      await db.insert(schema.employmentJobRoles).values({
        id: newId(),
        organizationId,
        employmentId,
        jobRoleId,
        isPrimary: index === 0,
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
      systemEvent(
        'role_grant.granted',
        `Granted ${ROLE_PRESETS[grant.role].name} to ${person.displayName}${
          locationId ? ` at ${grant.location}` : ' organization-wide'
        }`,
        {
          subjectType: 'employment',
          subjectId: employmentId,
          locationId,
          metadata: { role: grant.role, scope: locationId ? 'location' : 'org' },
        },
      )
    }

    for (const credential of person.credentials ?? []) {
      await db.insert(schema.employmentCredentials).values({
        id: newId(),
        organizationId,
        employmentId,
        name: credential.name,
        issuingAuthority: credential.issuingAuthority,
        identifier: credential.identifier,
        issuedOn: credential.issuedOn,
        expiresOn: credential.expiresOn,
        verifiedAt: new Date(),
      })
      credentialCount += 1
    }
  }

  // Pass two: reporting lines, once every employment exists.
  for (const person of seed.people) {
    if (!person.manager) continue
    const employmentId = employmentIds.get(person.key)
    const managerId = employmentIds.get(person.manager)
    if (!employmentId || !managerId) continue
    await db
      .update(schema.employments)
      .set({ managerEmploymentId: managerId })
      .where(eq(schema.employments.id, employmentId))
  }

  // Pass three: onboarding runs, with realistic progress.
  for (const person of seed.people) {
    if (!person.onboarding) continue
    const employmentId = employmentIds.get(person.key)
    const templateId = templateIds.get(person.onboarding.template)
    const versionId = templateVersionIds.get(person.onboarding.template)
    const steps = templateStepIds.get(person.onboarding.template)
    const template = seed.onboardingTemplates.find((t) => t.key === person.onboarding?.template)
    if (!employmentId || !templateId || !versionId || !steps || !template) continue

    const assignmentId = newId()
    const start = person.onboarding.startedOn
    const hireDate = person.hiredOn ?? start
    const dueFor = (s2: { dueDays: number | null; dueBasis: string }) =>
      s2.dueDays === null
        ? null
        : addCalendarDays(s2.dueBasis === 'hire_date' ? hireDate : start, s2.dueDays)

    const dueDates = [...steps.values()].map(dueFor).filter((d): d is string => d !== null)
    const latestDue = dueDates.length > 0 ? [...dueDates].sort().at(-1)! : null

    await db.insert(schema.onboardingAssignments).values({
      id: assignmentId,
      organizationId,
      employmentId,
      templateId,
      templateVersionId: versionId,
      templateVersionNumber: 1,
      templateName: template.name,
      startedOn: start,
      dueOn: latestDue,
    })
    onboardingCount += 1

    const completed = new Set(person.onboarding.completed ?? [])
    const blockedTitle = person.onboarding.blocked?.title

    let allRequiredDone = true
    for (const [title, step] of steps.entries()) {
      let status = 'pending'
      let blockedReason: string | null = null

      if (completed.has(title)) {
        status = 'completed'
      } else if (title === blockedTitle) {
        status = 'blocked'
        blockedReason = person.onboarding.blocked?.reason ?? null
      } else if (step.kind === 'training_assignment' || step.kind === 'policy_ack') {
        // The integration boundary: these point at systems that ship later,
        // so they are visibly waiting rather than quietly completable.
        status = 'blocked'
        blockedReason =
          step.kind === 'training_assignment'
            ? 'Waiting on the training system, which arrives in a later release.'
            : 'Waiting on policy documents, which arrive in a later release.'
      }

      if (step.required && step.blocksCompletion && status !== 'completed') allRequiredDone = false

      await db.insert(schema.onboardingStepProgress).values({
        id: newId(),
        organizationId,
        assignmentId,
        stepId: step.id,
        sectionTitle: step.sectionTitle,
        title,
        instructions: step.instructions,
        kind: step.kind,
        responsibility: step.responsibility,
        required: step.required,
        requiresManagerVerification: step.requiresManagerVerification,
        blocksCompletion: step.blocksCompletion,
        position: step.position,
        dueOn: dueFor(step),
        status,
        blockedReason,
        completedAt: status === 'completed' ? new Date(`${start}T17:00:00Z`) : null,
        completedByEmploymentId: status === 'completed' ? employmentId : null,
      })
    }

    if (allRequiredDone) {
      await db
        .update(schema.onboardingAssignments)
        .set({ completedAt: new Date() })
        .where(eq(schema.onboardingAssignments.id, assignmentId))
    }

    systemEvent('onboarding.assigned', `Started onboarding for ${person.displayName}`, {
      subjectType: 'employment',
      subjectId: employmentId,
      metadata: { assignmentId, template: template.name },
    })
  }

  // --- teams, events, and announcements -------------------------------------
  // Last, because every one of them refers to people by key.
  const teamIds = new Map<string, string>()
  for (const team of seed.teams ?? []) {
    const id = newId()
    teamIds.set(team.key, id)
    await db.insert(schema.teams).values({
      id,
      organizationId,
      departmentId: team.department ? (departmentIds.get(team.department) ?? null) : null,
      locationId: team.location ? (locationIds.get(team.location) ?? null) : null,
      name: team.name,
    })
    for (const memberKey of team.members) {
      const employmentId = employmentIds.get(memberKey)
      if (!employmentId) continue
      await db.insert(schema.employmentTeams).values({
        id: newId(),
        organizationId,
        employmentId,
        teamId: id,
      })
    }
  }

  const eventIds = new Map<string, string>()
  for (const event of seed.events ?? []) {
    const id = newId()
    eventIds.set(event.key, id)
    const start = new Date(Date.now() + event.inDays * DAY_MS)
    start.setUTCHours(event.startHour ?? 9, 0, 0, 0)
    const end = event.endHour === undefined ? null : new Date(start)
    if (end && event.endHour !== undefined) end.setUTCHours(event.endHour, 0, 0, 0)

    await db.insert(schema.events).values({
      id,
      organizationId,
      locationId: event.location ? (locationIds.get(event.location) ?? null) : null,
      title: event.title,
      description: event.description ?? '',
      kind: event.kind,
      startsAt: start,
      endsAt: end,
      allDay: event.allDay ?? false,
      notes: event.notes ?? '',
      createdByEmploymentId: employmentIds.get('owner') ?? null,
    })
  }

  let announcementCount = 0
  for (const announcement of seed.announcements ?? []) {
    const authorId = employmentIds.get(announcement.author) ?? null
    const categoryId = categoryIds.get(announcement.category)
    if (!categoryId) continue
    const seedPolicy = deliveryPolicy(
      {
        priority: announcement.priority ?? 'normal',
        requiresAcknowledgement: announcement.requiresAcknowledgement ?? false,
      },
      {
        overridesPreferences:
          DEFAULT_ANNOUNCEMENT_CATEGORIES.find((c) => c.key === announcement.category)
            ?.overridesPreferences ?? false,
      },
    )

    const status = announcement.status ?? 'published'
    const publishedAt =
      status === 'published'
        ? new Date(Date.now() - (announcement.publishedDaysAgo ?? 0) * DAY_MS)
        : null
    const publishAt =
      status === 'scheduled'
        ? new Date(Date.now() + (announcement.scheduledInDays ?? 1) * DAY_MS)
        : null

    const announcementId = newId()
    const revisionId = newId()

    await db.insert(schema.announcements).values({
      id: announcementId,
      organizationId,
      categoryId,
      status,
      priority: announcement.priority ?? 'normal',
      requiresAcknowledgement: announcement.requiresAcknowledgement ?? false,
      acknowledgementDueAt:
        announcement.acknowledgementDueInDays === undefined
          ? null
          : new Date(Date.now() + announcement.acknowledgementDueInDays * DAY_MS),
      publishAt,
      publishedAt,
      expiresAt:
        announcement.expiresInDays === undefined
          ? null
          : new Date(Date.now() + announcement.expiresInDays * DAY_MS),
      eventId: announcement.event ? (eventIds.get(announcement.event) ?? null) : null,
      createdByEmploymentId: authorId,
      updatedByEmploymentId: authorId,
      publishedByEmploymentId: status === 'published' ? authorId : null,
      scheduledByEmploymentId: status === 'scheduled' ? authorId : null,
      createdAt: publishedAt ?? new Date(),
      updatedAt: publishedAt ?? new Date(),
    })

    await db.insert(schema.announcementRevisions).values({
      id: revisionId,
      organizationId,
      announcementId,
      revisionNumber: 1,
      title: announcement.title,
      body: announcement.body,
      callToActionLabel: announcement.callToActionLabel ?? null,
      callToActionHref: announcement.callToActionHref ?? null,
      createdByEmploymentId: authorId,
      createdAt: publishedAt ?? new Date(),
    })

    await db
      .update(schema.announcements)
      .set({ currentRevisionId: revisionId })
      .where(eq(schema.announcements.id, announcementId))

    for (const rule of announcement.audience) {
      const selectorId =
        rule.type === 'organization'
          ? null
          : rule.type === 'location'
            ? (locationIds.get(rule.ref ?? '') ?? null)
            : rule.type === 'department'
              ? (departmentIds.get(rule.ref ?? '') ?? null)
              : rule.type === 'job_role'
                ? (jobRoleIds.get(rule.ref ?? '') ?? null)
                : rule.type === 'team'
                  ? (teamIds.get(rule.ref ?? '') ?? null)
                  : rule.type === 'employment'
                    ? (employmentIds.get(rule.ref ?? '') ?? null)
                    : null
      if (rule.type !== 'organization' && selectorId === null) continue

      await db.insert(schema.announcementAudience).values({
        id: newId(),
        organizationId,
        announcementId,
        mode: rule.mode ?? 'include',
        selectorType: rule.type,
        selectorId,
      })
    }

    if (status !== 'published') {
      announcementCount += 1
      continue
    }

    // Recipients, resolved the same way publication does - by rule, not by a
    // hand-written list - so the demo exercises the real resolver.
    const recipientKeys = resolveSeedAudience(seed, announcement.audience)
    const readSet = new Set(announcement.readBy ?? [])
    const ackSet = new Set(announcement.acknowledgedBy ?? [])

    for (const personKey of recipientKeys) {
      const employmentId = employmentIds.get(personKey)
      if (!employmentId) continue
      const person = seed.people.find((p) => p.key === personKey)
      const homeLocation = person?.locations[0]
      const primaryRole = person?.jobRoles?.[0]
      const roleDefinition = seed.jobRoles.find((r) => r.key === primaryRole)

      const viewed = readSet.has(personKey) || ackSet.has(personKey)
      const acknowledged = ackSet.has(personKey)
      const viewedAt = viewed
        ? new Date((publishedAt ?? new Date()).getTime() + 3 * 60 * 60 * 1000)
        : null

      await db.insert(schema.announcementRecipients).values({
        id: newId(),
        organizationId,
        announcementId,
        employmentId,
        revisionId,
        locationIdAtPublish: homeLocation ? (locationIds.get(homeLocation) ?? null) : null,
        departmentIdAtPublish: roleDefinition
          ? (departmentIds.get(roleDefinition.department) ?? null)
          : null,
        jobRoleIdAtPublish: primaryRole ? (jobRoleIds.get(primaryRole) ?? null) : null,
        deliveryStatus: 'sent',
        deliveredAt: publishedAt,
        firstViewedAt: viewedAt,
        lastViewedAt: viewedAt,
        viewCount: viewed ? 1 : 0,
        acknowledgedAt: acknowledged ? viewedAt : null,
        acknowledgedRevisionId: acknowledged ? revisionId : null,
        createdAt: publishedAt ?? new Date(),
      })

      // An unread in-app notification for anyone who has not opened it, so the
      // bell and the digest have something real to count.
      if (!viewed) {
        await db.insert(schema.notifications).values({
          id: newId(),
          organizationId,
          employmentId,
          category: announcement.category,
          channel: 'in_app',
          subjectType: 'announcement',
          subjectId: announcementId,
          title: announcement.title,
          preview: announcement.body.split('\n')[0]?.slice(0, 140) ?? '',
          href: `/my/inbox/${announcementId}`,
          status: 'sent',
          // The same policy publication applies, so seeded rows are honest.
          mandatory: seedPolicy.overridesPreferences,
          overridesQuietHours: seedPolicy.overridesQuietHours,
          sentAt: publishedAt,
          idempotencyKey: `announcement:${announcementId}:${employmentId}:in_app:initial`,
          createdAt: publishedAt ?? new Date(),
        })
      }
    }

    announcementCount += 1
    systemEvent('announcement.published', `Published "${announcement.title}"`, {
      subjectType: 'announcement',
      subjectId: announcementId,
    })
  }

  // --- scheduling ------------------------------------------------------------
  const scheduling = await seedScheduling(db, {
    organizationId,
    slug: seed.slug,
    locationIds,
    locationTimeZones: new Map(seed.locations.map((l) => [l.key, l.timezone])),
    jobRoleIds,
    employmentIds,
    systemEvent,
  })

  await db.insert(schema.auditEvents).values(audit)

  return {
    name: seed.name,
    slug: seed.slug,
    industry: seed.industry,
    created: true,
    locations: seed.locations.length,
    departments: seed.departments.length,
    jobRoles: seed.jobRoles.length,
    stations: seed.stations.length,
    values: seed.values.length,
    onboardingTemplates: seed.onboardingTemplates.length,
    people: seed.people.length,
    roles: ROLE_KEYS.length,
    grants: grantCount,
    credentials: credentialCount,
    onboardingAssignments: onboardingCount,
    announcements: announcementCount,
    shifts: scheduling.shifts,
  }
}

export { SEED_ORGANIZATIONS, SEED_PASSWORD } from './data'
