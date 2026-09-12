import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addSection,
  addStep,
  archiveTemplate,
  createDraftVersion,
  createTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  publishVersion,
  reorder,
  restoreTemplate,
  setTemplateTargeting,
  updateStep,
  updateTemplateMeta,
} from '@/modules/onboarding/templates'
import {
  assignOnboarding,
  getProgressForEmployment,
  resolveTemplateForAssignment,
} from '@/modules/onboarding/service'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

/**
 * ONBOARDING VERSION BEHAVIOUR.
 *
 * The whole reason templates are three tables. These tests assert the promises
 * the builder makes to an administrator:
 *
 *   editing a draft changes only the draft
 *   publishing freezes a version
 *   people already onboarding stay where they are
 *   new hires get the currently published version
 *   archiving hides without erasing
 *   nothing crosses a tenant boundary
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

/** A published template with one real step, built through the public API. */
async function buildPublishedTemplate(actor: Actor, organizationId: string, name: string) {
  const created = await asTenant(organizationId, (tx) => createTemplate(tx, actor, { name }))
  const detail = await asTenant(organizationId, (tx) => getTemplate(tx, actor, created.templateId))
  const sectionId = detail.draftVersion!.sections[0]!.id

  await asTenant(organizationId, (tx) =>
    addStep(tx, actor, sectionId, {
      title: 'Original step',
      kind: 'employee_task',
      responsibility: 'employee',
      required: true,
    }),
  )
  await asTenant(organizationId, (tx) => publishVersion(tx, actor, created.versionId))
  return created.templateId
}

async function newEmployment(
  organizationId: string,
  name: string,
  locationName?: string,
): Promise<string> {
  const pool = await migrationClient()
  const id = newId()
  const { rows } = await pool.query<{ id: string }>(
    locationName
      ? 'select id from locations where organization_id = $1 and name = $2 limit 1'
      : 'select id from locations where organization_id = $1 limit 1',
    locationName ? [organizationId, locationName] : [organizationId],
  )
  await pool.query(
    `insert into employments (id, organization_id, display_name, status, home_location_id)
     values ($1, $2, $3, 'active', $4)`,
    [id, organizationId, name, rows[0]!.id],
  )
  return id
}

describe('a new template cannot reach anyone', () => {
  it('starts as a draft with no published version', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const created = await asTenant(harborId, (tx) =>
      createTemplate(tx, priya, { name: 'Unpublished checklist' }),
    )
    const detail = await asTenant(harborId, (tx) => getTemplate(tx, priya, created.templateId))

    expect(detail.status).toBe('draft')
    expect(detail.publishedVersion).toBeNull()
    expect(detail.draftVersion?.status).toBe('draft')
  })

  it('is never chosen for a new hire, even if it is the only one targeting them', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const created = await asTenant(harborId, (tx) =>
      createTemplate(tx, priya, { name: 'Draft only checklist' }),
    )

    const pool = await migrationClient()
    const { rows } = await pool.query<{ id: string }>(
      "select id from job_roles where organization_id = $1 and name = 'Busser'",
      [harborId],
    )
    await asTenant(harborId, (tx) =>
      setTemplateTargeting(tx, priya, created.templateId, {
        jobRoleIds: [rows[0]!.id],
        locationIds: [],
      }),
    )

    const resolved = await asTenant(harborId, (tx) =>
      resolveTemplateForAssignment(tx, priya, {
        jobRoleIds: [rows[0]!.id],
        locationId: null,
      }),
    )
    expect(resolved?.templateId, 'a draft must never be assignable').not.toBe(created.templateId)
  })
})

describe('editing a draft changes only the draft', () => {
  it('refuses to edit a published version', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `Immutable ${Date.now()}`)
    const detail = await asTenant(harborId, (tx) => getTemplate(tx, priya, templateId))
    const publishedStep = detail.publishedVersion!.sections[0]!.steps[0]!

    await expect(
      asTenant(harborId, (tx) =>
        updateStep(tx, priya, publishedStep.id, {
          title: 'Tampered',
          kind: 'employee_task',
          responsibility: 'employee',
          required: true,
        }),
      ),
    ).rejects.toThrow(ValidationError)

    await expect(
      asTenant(harborId, (tx) =>
        addSection(tx, priya, detail.publishedVersion!.id, 'Sneaky section'),
      ),
    ).rejects.toThrow(ValidationError)

    await expect(
      asTenant(harborId, (tx) =>
        reorder(tx, priya, { kind: 'step', id: publishedStep.id, direction: 'down' }),
      ),
    ).rejects.toThrow(ValidationError)
  })

  it('leaves the published version untouched while a draft is edited', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `Draft edit ${Date.now()}`)

    await asTenant(harborId, (tx) => createDraftVersion(tx, priya, templateId))
    const withDraft = await asTenant(harborId, (tx) => getTemplate(tx, priya, templateId))

    const draftStep = withDraft.draftVersion!.sections[0]!.steps[0]!
    await asTenant(harborId, (tx) =>
      updateStep(tx, priya, draftStep.id, {
        title: 'Changed in the draft',
        kind: 'employee_task',
        responsibility: 'employee',
        required: true,
      }),
    )

    const after = await asTenant(harborId, (tx) => getTemplate(tx, priya, templateId))
    expect(after.draftVersion!.sections[0]!.steps[0]!.title).toBe('Changed in the draft')
    expect(
      after.publishedVersion!.sections[0]!.steps[0]!.title,
      'the published version must not move',
    ).toBe('Original step')
  })

  it('copies the published content into the new draft rather than starting empty', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `Copy draft ${Date.now()}`)
    await asTenant(harborId, (tx) => createDraftVersion(tx, priya, templateId))

    const detail = await asTenant(harborId, (tx) => getTemplate(tx, priya, templateId))
    expect(detail.draftVersion!.sections[0]!.steps[0]!.title).toBe('Original step')
    // ...and it is a COPY, not the same row.
    expect(detail.draftVersion!.sections[0]!.steps[0]!.id).not.toBe(
      detail.publishedVersion!.sections[0]!.steps[0]!.id,
    )
  })

  it('does not create a second draft when one already exists', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `One draft ${Date.now()}`)
    const first = await asTenant(harborId, (tx) => createDraftVersion(tx, priya, templateId))
    const second = await asTenant(harborId, (tx) => createDraftVersion(tx, priya, templateId))
    expect(second).toBe(first)
  })

  it('refuses to publish a version with no steps', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const created = await asTenant(harborId, (tx) =>
      createTemplate(tx, priya, { name: `Empty ${Date.now()}` }),
    )
    await expect(
      asTenant(harborId, (tx) => publishVersion(tx, priya, created.versionId)),
    ).rejects.toThrow(ValidationError)
  })
})

describe('publishing and in-progress runs', () => {
  it('keeps somebody already onboarding on the version they started', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `Live edit ${Date.now()}`)

    const pool = await migrationClient()
    const { rows: roleRows } = await pool.query<{ id: string }>(
      "select id from job_roles where organization_id = $1 and name = 'Dishwasher'",
      [harborId],
    )
    await asTenant(harborId, (tx) =>
      setTemplateTargeting(tx, priya, templateId, {
        jobRoleIds: [roleRows[0]!.id],
        locationIds: [],
      }),
    )

    // Somebody starts on v1.
    const early = await newEmployment(harborId, `Early Starter ${Date.now()}`)
    await pool.query(
      'insert into employment_job_roles (id, organization_id, employment_id, job_role_id, is_primary) values ($1,$2,$3,$4,true)',
      [newId(), harborId, early, roleRows[0]!.id],
    )
    await asTenant(harborId, (tx) => assignOnboarding(tx, priya, early))

    const beforeChange = await asTenant(harborId, (tx) =>
      getProgressForEmployment(tx, priya, early),
    )
    expect(beforeChange!.templateVersionNumber).toBe(1)
    expect(beforeChange!.steps.map((s) => s.title)).toEqual(['Original step'])

    // v2 is drafted, changed, and published.
    const draftId = await asTenant(harborId, (tx) => createDraftVersion(tx, priya, templateId))
    const withDraft = await asTenant(harborId, (tx) => getTemplate(tx, priya, templateId))
    await asTenant(harborId, (tx) =>
      updateStep(tx, priya, withDraft.draftVersion!.sections[0]!.steps[0]!.id, {
        title: 'Completely different step',
        kind: 'employee_task',
        responsibility: 'employee',
        required: true,
      }),
    )
    await asTenant(harborId, (tx) =>
      addStep(tx, priya, withDraft.draftVersion!.sections[0]!.id, {
        title: 'A brand new step',
        kind: 'employee_task',
        responsibility: 'employee',
        required: true,
      }),
    )
    await asTenant(harborId, (tx) => publishVersion(tx, priya, draftId))

    // The person already onboarding is untouched.
    const afterChange = await asTenant(harborId, (tx) => getProgressForEmployment(tx, priya, early))
    expect(afterChange!.templateVersionNumber).toBe(1)
    expect(afterChange!.steps.map((s) => s.title)).toEqual(['Original step'])

    // A NEW hire gets v2.
    const late = await newEmployment(harborId, `Late Starter ${Date.now()}`)
    await pool.query(
      'insert into employment_job_roles (id, organization_id, employment_id, job_role_id, is_primary) values ($1,$2,$3,$4,true)',
      [newId(), harborId, late, roleRows[0]!.id],
    )
    await asTenant(harborId, (tx) => assignOnboarding(tx, priya, late))

    const newHire = await asTenant(harborId, (tx) => getProgressForEmployment(tx, priya, late))
    expect(newHire!.templateVersionNumber).toBe(2)
    expect(newHire!.steps.map((s) => s.title).sort()).toEqual([
      'A brand new step',
      'Completely different step',
    ])
  })
})

describe('archiving', () => {
  it('hides the template without erasing history', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `Archive me ${Date.now()}`)

    const pool = await migrationClient()
    // Bartender is deliberately a role no seeded checklist targets, so this
    // template is the unambiguous match rather than competing with one.
    const { rows: roleRows } = await pool.query<{ id: string }>(
      "select id from job_roles where organization_id = $1 and name = 'Bartender'",
      [harborId],
    )
    await asTenant(harborId, (tx) =>
      setTemplateTargeting(tx, priya, templateId, {
        jobRoleIds: [roleRows[0]!.id],
        locationIds: [],
      }),
    )

    const person = await newEmployment(harborId, `Archived Run ${Date.now()}`)
    await pool.query(
      'insert into employment_job_roles (id, organization_id, employment_id, job_role_id, is_primary) values ($1,$2,$3,$4,true)',
      [newId(), harborId, person, roleRows[0]!.id],
    )
    await asTenant(harborId, (tx) => assignOnboarding(tx, priya, person))

    await asTenant(harborId, (tx) => archiveTemplate(tx, priya, templateId))

    // The run survives intact.
    const progress = await asTenant(harborId, (tx) => getProgressForEmployment(tx, priya, person))
    expect(progress).not.toBeNull()
    expect(progress!.steps).toHaveLength(1)
    expect(progress!.steps[0]!.title).toBe('Original step')

    // It is gone from the normal list, but findable when asked for.
    const visible = await asTenant(harborId, (tx) => listTemplates(tx, priya))
    expect(visible.map((t) => t.id)).not.toContain(templateId)
    const withArchived = await asTenant(harborId, (tx) =>
      listTemplates(tx, priya, { includeArchived: true }),
    )
    expect(withArchived.map((t) => t.id)).toContain(templateId)

    // And it is never selected for a new hire.
    const resolved = await asTenant(harborId, (tx) =>
      resolveTemplateForAssignment(tx, priya, {
        jobRoleIds: [roleRows[0]!.id],
        locationId: null,
      }),
    )
    expect(resolved?.templateId).not.toBe(templateId)
  })

  it('restores without silently republishing an unpublished checklist', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const created = await asTenant(harborId, (tx) =>
      createTemplate(tx, priya, { name: `Never published ${Date.now()}` }),
    )
    await asTenant(harborId, (tx) => archiveTemplate(tx, priya, created.templateId))
    await asTenant(harborId, (tx) => restoreTemplate(tx, priya, created.templateId))

    const detail = await asTenant(harborId, (tx) => getTemplate(tx, priya, created.templateId))
    expect(detail.archivedAt).toBeNull()
    expect(detail.status, 'a never-published checklist must come back as a draft').toBe('draft')
  })
})

describe('duplicating', () => {
  it('copies the content but never the published status', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `Duplicate me ${Date.now()}`)
    const copyId = await asTenant(harborId, (tx) => duplicateTemplate(tx, priya, templateId))

    const copy = await asTenant(harborId, (tx) => getTemplate(tx, priya, copyId))
    expect(copy.status).toBe('draft')
    expect(copy.publishedVersion).toBeNull()
    expect(copy.isDefault).toBe(false)
    expect(copy.draftVersion!.sections[0]!.steps[0]!.title).toBe('Original step')
    expect(copy.name).toMatch(/\(copy\)$/)
  })
})

describe('one default per organization', () => {
  it('moves the default rather than allowing two', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const templateId = await buildPublishedTemplate(priya, harborId, `New default ${Date.now()}`)
    await asTenant(harborId, (tx) => updateTemplateMeta(tx, priya, templateId, { isDefault: true }))

    const all = await asTenant(harborId, (tx) => listTemplates(tx, priya))
    expect(all.filter((t) => t.isDefault)).toHaveLength(1)
    expect(all.find((t) => t.isDefault)?.id).toBe(templateId)
  })
})

describe('tenant boundaries', () => {
  it('refuses a template id belonging to another organization', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')

    const salonTemplates = await asTenant(lumenId, (tx) => listTemplates(tx, ana))
    const salonTemplateId = salonTemplates[0]!.id

    await expect(
      asTenant(harborId, (tx) => getTemplate(tx, priya, salonTemplateId)),
    ).rejects.toThrow(NotFoundError)

    await expect(
      asTenant(harborId, (tx) => archiveTemplate(tx, priya, salonTemplateId)),
    ).rejects.toThrow(NotFoundError)

    await expect(
      asTenant(harborId, (tx) => createDraftVersion(tx, priya, salonTemplateId)),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses targeting a job role from another organization', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const pool = await migrationClient()
    const { rows } = await pool.query<{ id: string }>(
      "select id from job_roles where organization_id = $1 and name = 'Stylist'",
      [lumenId],
    )
    const templateId = await buildPublishedTemplate(priya, harborId, `Cross target ${Date.now()}`)

    await expect(
      asTenant(harborId, (tx) =>
        setTemplateTargeting(tx, priya, templateId, {
          jobRoleIds: [rows[0]!.id],
          locationIds: [],
        }),
      ),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses targeting a location from another organization', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const pool = await migrationClient()
    const { rows } = await pool.query<{ id: string }>(
      "select id from locations where organization_id = $1 and name = 'Pearl District'",
      [lumenId],
    )
    const templateId = await buildPublishedTemplate(priya, harborId, `Cross loc ${Date.now()}`)

    await expect(
      asTenant(harborId, (tx) =>
        setTemplateTargeting(tx, priya, templateId, {
          jobRoleIds: [],
          locationIds: [rows[0]!.id],
        }),
      ),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses authoring by somebody without onboarding.manage', async () => {
    // A General Manager runs a location but does not design onboarding.
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    await expect(
      asTenant(harborId, (tx) => createTemplate(tx, marcus, { name: 'GM checklist' })),
    ).rejects.toThrow(ForbiddenError)
    await expect(asTenant(harborId, (tx) => listTemplates(tx, marcus))).rejects.toThrow(
      ForbiddenError,
    )
  })
})

describe('targeting narrows rather than merely reordering', () => {
  it('does not give a role-targeted checklist to somebody without that role', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const pool = await migrationClient()
    const { rows: stylist } = await pool.query<{ id: string }>(
      "select id from job_roles where organization_id = $1 and name = 'Stylist'",
      [lumenId],
    )
    const { rows: massage } = await pool.query<{ id: string }>(
      "select id from job_roles where organization_id = $1 and name = 'Massage Therapist'",
      [lumenId],
    )

    const forStylist = await asTenant(lumenId, (tx) =>
      resolveTemplateForAssignment(tx, ana, { jobRoleIds: [stylist[0]!.id], locationId: null }),
    )
    expect(forStylist?.name).toBe('New Stylist Onboarding')

    // A massage therapist matches no role-targeted checklist, so they fall
    // through to the default rather than being handed the stylist one.
    const forMassage = await asTenant(lumenId, (tx) =>
      resolveTemplateForAssignment(tx, ana, { jobRoleIds: [massage[0]!.id], locationId: null }),
    )
    expect(forMassage?.name).toBe('Guest Services Onboarding')
  })
})
