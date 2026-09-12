import { hash as argon2Hash } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { newId } from '@/lib/ids'
import { addCalendarDays } from '@/lib/dates'
import { ROLE_KEYS, ROLE_PRESETS } from '@/server/authz/role-presets'
import * as schema from '../full-schema'
import { SEED_ORGANIZATIONS, SEED_PASSWORD, type SeedOrganization } from './data'

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
}

export interface SeedSummary {
  organizations: SeedOrganizationSummary[]
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
  }
}

export { SEED_ORGANIZATIONS, SEED_PASSWORD } from './data'
