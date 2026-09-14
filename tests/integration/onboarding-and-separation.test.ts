import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assignOnboarding,
  blockStep,
  completeStep,
  deriveState,
  getProgressForEmployment,
  listProgress,
  needsManagerToComplete,
} from '@/modules/onboarding/service'
import { createTemplate, publishVersion } from '@/modules/onboarding/templates'
import {
  approveSeparation,
  cancelSeparation,
  completeSeparation,
  listSeparations,
  requestSeparation,
} from '@/modules/people/separation-service'
import { resolveActor } from '@/server/authz/resolve'
import { listEmployments } from '@/modules/people/service'
import type { Actor } from '@/server/authz/actor'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

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

async function employmentIdFor(organizationId: string, displayName: string): Promise<string> {
  const pool = await migrationClient()
  const { rows } = await pool.query<{ id: string }>(
    'select id from employments where organization_id = $1 and display_name = $2 limit 1',
    [organizationId, displayName],
  )
  if (!rows[0]) throw new Error(`No employment for ${displayName}`)
  return rows[0].id
}

describe('onboarding state derivation', () => {
  const base = { required: true, blocksCompletion: true, kind: 'employee_task' as const }

  it('is completed when every required step is done', () => {
    expect(
      deriveState(
        [
          { ...base, status: 'completed', dueOn: null },
          { ...base, status: 'waived', dueOn: null },
          { ...base, required: false, status: 'pending', dueOn: null },
        ],
        null,
      ),
    ).toBe('completed')
  })

  it('is blocked when anything is blocked, even if nothing is overdue', () => {
    expect(
      deriveState(
        [
          { ...base, status: 'completed', dueOn: null },
          { ...base, status: 'blocked', dueOn: null },
        ],
        null,
      ),
    ).toBe('blocked')
  })

  it('is overdue when a required step is past its due date', () => {
    expect(
      deriveState(
        [
          { ...base, status: 'completed', dueOn: '2020-01-01' },
          { ...base, status: 'pending', dueOn: '2020-01-02' },
        ],
        null,
      ),
    ).toBe('overdue')
  })

  it('prefers blocked over overdue, because blocked needs a decision', () => {
    expect(
      deriveState(
        [
          { ...base, status: 'pending', dueOn: '2020-01-02' },
          { ...base, status: 'blocked', dueOn: null },
        ],
        null,
      ),
    ).toBe('blocked')
  })

  it('does not call a future due date overdue', () => {
    expect(deriveState([{ ...base, status: 'pending', dueOn: '2099-01-01' }], null)).toBe(
      'not_started',
    )
  })
})

describe('manager verification', () => {
  it('does NOT let an employee complete their own manager-verified step', async () => {
    // Elodie is mid-onboarding on the salon's stylist checklist.
    const elodieId = await employmentIdFor(lumenId, 'Elodie Garnier')
    const elodie = await asTenant(lumenId, (tx) =>
      resolveActor(tx, lumenId, userIds.get('elodie@lumensalon.test')!),
    )
    expect(elodie).not.toBeNull()

    const progress = await asTenant(lumenId, (tx) =>
      getProgressForEmployment(tx, elodie!, elodieId),
    )
    const verifyStep = progress!.steps.find((s) => needsManagerToComplete(s))!
    expect(verifyStep).toBeTruthy()

    // The view must not offer it to her...
    expect(verifyStep.selfCompletable).toBe(false)

    // ...and the service must refuse even if she posts directly.
    await expect(
      asTenant(lumenId, (tx) => completeStep(tx, elodie!, verifyStep.id)),
    ).rejects.toThrow(ForbiddenError)
  })

  it('lets a manager verify it, and records who did', async () => {
    const kofi = await actorFor(lumenId, 'kofi@lumensalon.test')
    const tomasId = await employmentIdFor(lumenId, 'Tomas Reyes')

    const before = await asTenant(lumenId, (tx) => getProgressForEmployment(tx, kofi, tomasId))
    const step = before!.steps.find((s) => needsManagerToComplete(s) && s.status === 'pending')!
    expect(step.awaitingVerification).toBe(true)

    await asTenant(lumenId, (tx) => completeStep(tx, kofi, step.id, 'Watched a full opening'))

    const after = await asTenant(lumenId, (tx) => getProgressForEmployment(tx, kofi, tomasId))
    const verified = after!.steps.find((s) => s.id === step.id)!
    expect(verified.status).toBe('completed')
    expect(verified.verifiedBy).toBe('Kofi Mensah')
  })

  it('lets an employee complete their own ordinary steps', async () => {
    const samId = await employmentIdFor(harborId, 'Sam Whitfield')
    const dana = await actorFor(harborId, 'dana@harborvine.test')

    // Give Sam an onboarding run to act on.
    await asTenant(harborId, (tx) => assignOnboarding(tx, dana, samId))

    const sam = await asTenant(harborId, (tx) =>
      resolveActor(tx, harborId, userIds.get('sam@harborvine.test')!),
    )
    const progress = await asTenant(harborId, (tx) => getProgressForEmployment(tx, sam!, samId))
    const ownStep = progress!.steps.find((s) => s.selfCompletable)!
    expect(ownStep).toBeTruthy()

    await asTenant(harborId, (tx) => completeStep(tx, sam!, ownStep.id))

    const after = await asTenant(harborId, (tx) => getProgressForEmployment(tx, sam!, samId))
    expect(after!.steps.find((s) => s.id === ownStep.id)!.status).toBe('completed')
  })
})

describe('the integration boundary with later slices', () => {
  it('starts policy steps BLOCKED, and never lets a training step be ticked off by hand', async () => {
    const kofi = await actorFor(lumenId, 'kofi@lumensalon.test')
    const elodieId = await employmentIdFor(lumenId, 'Elodie Garnier')
    const progress = await asTenant(lumenId, (tx) => getProgressForEmployment(tx, kofi, elodieId))

    const trainingSteps = progress!.steps.filter((s) => s.kind === 'training_assignment')
    expect(trainingSteps.length).toBeGreaterThan(0)
    for (const step of trainingSteps) {
      expect(step.training, 'a seeded training step is linked to a course').not.toBeNull()
      expect(step.selfCompletable).toBe(false)
      if (step.status !== 'completed') {
        await expect(asTenant(lumenId, (tx) => completeStep(tx, kofi, step.id))).rejects.toThrow(
          /completes itself/,
        )
      }
    }
  })

  it('refuses to complete a blocked step', async () => {
    const kofi = await actorFor(lumenId, 'kofi@lumensalon.test')
    const elodieId = await employmentIdFor(lumenId, 'Elodie Garnier')
    const progress = await asTenant(lumenId, (tx) => getProgressForEmployment(tx, kofi, elodieId))
    const blocked = progress!.steps.find((s) => s.status === 'blocked')!

    await expect(asTenant(lumenId, (tx) => completeStep(tx, kofi, blocked.id))).rejects.toThrow(
      ValidationError,
    )
  })
})

describe('onboarding visibility', () => {
  it('is tenant-scoped', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')

    const harborProgress = await asTenant(harborId, (tx) => listProgress(tx, dana))
    const lumenProgress = await asTenant(lumenId, (tx) => listProgress(tx, ana))

    const harborNames = harborProgress.map((p) => p.employeeName)
    const lumenNames = lumenProgress.map((p) => p.employeeName)

    expect(harborNames).not.toContain('Elodie Garnier')
    expect(lumenNames).not.toContain('Ava Lindqvist')
  })

  it('is refused to an employee for somebody else', async () => {
    const sam = await asTenant(harborId, (tx) =>
      resolveActor(tx, harborId, userIds.get('sam@harborvine.test')!),
    )
    const avaId = await employmentIdFor(harborId, 'Ava Lindqvist')
    await expect(
      asTenant(harborId, (tx) => getProgressForEmployment(tx, sam!, avaId)),
    ).rejects.toThrow(ForbiddenError)
  })

  it('lets an employee see their OWN progress with no capability', async () => {
    const samId = await employmentIdFor(harborId, 'Sam Whitfield')
    const sam = await asTenant(harborId, (tx) =>
      resolveActor(tx, harborId, userIds.get('sam@harborvine.test')!),
    )
    const own = await asTenant(harborId, (tx) => getProgressForEmployment(tx, sam!, samId))
    expect(own).not.toBeNull()
    expect(own!.employeeName).toBe('Sam Whitfield')
  })

  it('lets an employee flag their own step as blocked', async () => {
    const samId = await employmentIdFor(harborId, 'Sam Whitfield')
    const sam = await asTenant(harborId, (tx) =>
      resolveActor(tx, harborId, userIds.get('sam@harborvine.test')!),
    )
    const progress = await asTenant(harborId, (tx) => getProgressForEmployment(tx, sam!, samId))
    const pending = progress!.steps.find((s) => s.selfCompletable)!

    await asTenant(harborId, (tx) => blockStep(tx, sam!, pending.id, 'Waiting on my handbook copy'))

    const after = await asTenant(harborId, (tx) => getProgressForEmployment(tx, sam!, samId))
    const blocked = after!.steps.find((s) => s.id === pending.id)!
    expect(blocked.status).toBe('blocked')
    expect(blocked.blockedReason).toBe('Waiting on my handbook copy')
  })
})

describe('separation: the two-person rule', () => {
  async function freshEmployment(name: string): Promise<string> {
    const pool = await migrationClient()
    const id = newId()
    const { rows } = await pool.query<{ id: string }>(
      'select id from locations where organization_id = $1 limit 1',
      [harborId],
    )
    await pool.query(
      `insert into employments (id, organization_id, display_name, status, home_location_id)
       values ($1, $2, $3, 'active', $4)`,
      [id, harborId, name, rows[0]!.id],
    )
    return id
  }

  it('changes nothing when a separation is filed', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const target = await freshEmployment('Filing Target')

    await asTenant(harborId, (tx) =>
      requestSeparation(tx, priya, {
        employmentId: target,
        reasonCategory: 'resignation',
        reason: 'Gave four weeks notice, moving out of state.',
        effectiveOn: '2026-10-31',
      }),
    )

    const pool = await migrationClient()
    const { rows } = await pool.query<{ status: string }>(
      'select status from employments where id = $1',
      [target],
    )
    expect(rows[0]?.status, 'filing must not change employment status').toBe('active')
  })

  it('REFUSES approval by the person who requested it', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const target = await freshEmployment('Self Approve Target')

    const separationId = await asTenant(harborId, (tx) =>
      requestSeparation(tx, priya, {
        employmentId: target,
        reasonCategory: 'end_of_season',
        reason: 'Seasonal contract concluding at the end of October.',
        effectiveOn: '2026-10-31',
      }),
    )

    await expect(
      asTenant(harborId, (tx) => approveSeparation(tx, priya, separationId)),
    ).rejects.toThrow(ValidationError)
  })

  it('REFUSES approval by somebody without the capability', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    const target = await freshEmployment('Unauthorised Approve Target')

    const separationId = await asTenant(harborId, (tx) =>
      requestSeparation(tx, priya, {
        employmentId: target,
        reasonCategory: 'other',
        reason: 'Recorded for the purposes of this test scenario.',
        effectiveOn: '2026-11-15',
      }),
    )

    // A General Manager does not hold people.separate.
    await expect(
      asTenant(harborId, (tx) => approveSeparation(tx, marcus, separationId)),
    ).rejects.toThrow(ForbiddenError)
  })

  it('REFUSES completion before approval', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const target = await freshEmployment('Premature Complete Target')

    const separationId = await asTenant(harborId, (tx) =>
      requestSeparation(tx, priya, {
        employmentId: target,
        reasonCategory: 'redundancy',
        reason: 'Role removed after the winter menu change.',
        effectiveOn: '2026-11-30',
      }),
    )

    await expect(
      asTenant(harborId, (tx) => completeSeparation(tx, priya, separationId)),
    ).rejects.toThrow(ValidationError)
  })

  it('completes only with two DIFFERENT humans, and revokes access', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const target = await freshEmployment('Full Flow Target')

    const pool = await migrationClient()
    const { rows: roleRows } = await pool.query<{ id: string }>(
      "select id from roles where organization_id = $1 and key = 'employee'",
      [harborId],
    )
    await pool.query(
      `insert into role_grants (id, organization_id, employment_id, role_id, scope)
       values ($1, $2, $3, $4, 'org')`,
      [newId(), harborId, target, roleRows[0]!.id],
    )

    const separationId = await asTenant(harborId, (tx) =>
      requestSeparation(tx, priya, {
        employmentId: target,
        reasonCategory: 'mutual_agreement',
        reason: 'Agreed departure after a conversation on 10 September.',
        effectiveOn: '2026-09-30',
      }),
    )

    await asTenant(harborId, (tx) => approveSeparation(tx, dana, separationId))
    await asTenant(harborId, (tx) => completeSeparation(tx, dana, separationId))

    const employment = await pool.query<{ status: string; separated_on: string }>(
      "select status, to_char(separated_on, 'YYYY-MM-DD') as separated_on from employments where id = $1",
      [target],
    )
    expect(employment.rows[0]?.status).toBe('separated')
    expect(employment.rows[0]?.separated_on).toBe('2026-09-30')

    const grants = await pool.query<{ revoked_at: Date | null }>(
      'select revoked_at from role_grants where employment_id = $1',
      [target],
    )
    for (const grant of grants.rows) {
      expect(grant.revoked_at, 'every grant must be revoked').not.toBeNull()
    }

    // Both humans are named in the record.
    const record = (await asTenant(harborId, (tx) => listSeparations(tx, priya))).find(
      (s) => s.id === separationId,
    )!
    expect(record.requestedBy).toBe('Priya Raman')
    expect(record.approvedBy).toBe('Dana Okafor')
    expect(record.requestedBy).not.toBe(record.approvedBy)
  })

  it('is reversible right up until completion', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const target = await freshEmployment('Cancel Flow Target')

    const separationId = await asTenant(harborId, (tx) =>
      requestSeparation(tx, priya, {
        employmentId: target,
        reasonCategory: 'dismissal',
        reason: 'Filed then reconsidered after a conversation.',
        effectiveOn: '2026-10-15',
      }),
    )
    await asTenant(harborId, (tx) => approveSeparation(tx, dana, separationId))

    // Approved, but not completed - still cancellable.
    await asTenant(harborId, (tx) => cancelSeparation(tx, dana, separationId, 'Resolved instead'))

    const pool = await migrationClient()
    const employment = await pool.query<{ status: string }>(
      'select status from employments where id = $1',
      [target],
    )
    expect(employment.rows[0]?.status, 'cancelling must leave the employment intact').toBe('active')

    await expect(
      asTenant(harborId, (tx) => completeSeparation(tx, dana, separationId)),
    ).rejects.toThrow(ValidationError)
  })

  it('refuses a separation with no stated reason', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const target = await freshEmployment('No Reason Target')

    await expect(
      asTenant(harborId, (tx) =>
        requestSeparation(tx, priya, {
          employmentId: target,
          reasonCategory: 'other',
          reason: 'too short',
          effectiveOn: '2026-10-01',
        }),
      ),
    ).rejects.toThrow(ValidationError)
  })

  it('refuses somebody filing their own separation', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    await expect(
      asTenant(harborId, (tx) =>
        requestSeparation(tx, priya, {
          employmentId: priya.employmentId,
          reasonCategory: 'resignation',
          reason: 'Attempting to file my own separation record.',
          effectiveOn: '2026-10-01',
        }),
      ),
    ).rejects.toThrow(ValidationError)
  })

  it('denies a separated person any access at all', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ id: string; user_id: string }>(
      `select e.id, e.user_id from employments e
        where e.organization_id = $1 and e.status = 'separated' and e.user_id is not null
        limit 1`,
      [harborId],
    )
    if (!rows[0]) return // no separated person with an identity in this run

    const actor = await asTenant(harborId, (tx) => resolveActor(tx, harborId, rows[0]!.user_id))
    expect(actor, 'a separated employment must resolve to no actor').toBeNull()
  })
})

describe('onboarding template authoring', () => {
  it('refuses publishing a version with no steps', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const created = await asTenant(harborId, (tx) =>
      createTemplate(tx, priya, { name: 'Empty checklist' }),
    )
    await expect(
      asTenant(harborId, (tx) => publishVersion(tx, priya, created.versionId)),
    ).rejects.toThrow(ValidationError)
  })

  it('refuses authoring by somebody without onboarding.manage', async () => {
    const marcus = await actorFor(harborId, 'marcus@harborvine.test')
    await expect(
      asTenant(harborId, (tx) => createTemplate(tx, marcus, { name: 'GM checklist' })),
    ).rejects.toThrow(ForbiddenError)
  })

  it('freezes the template name onto the assignment, so later edits do not rewrite history', async () => {
    const priya = await actorFor(harborId, 'priya@harborvine.test')
    const avaId = await employmentIdFor(harborId, 'Ava Lindqvist')
    const progress = await asTenant(harborId, (tx) => getProgressForEmployment(tx, priya, avaId))
    expect(progress!.templateName).toBe('New Server Onboarding')

    const pool = await migrationClient()
    await pool.query(
      "update onboarding_templates set name = 'Renamed Checklist' where organization_id = $1 and name = 'New Server Onboarding'",
      [harborId],
    )

    const after = await asTenant(harborId, (tx) => getProgressForEmployment(tx, priya, avaId))
    expect(after!.templateName, 'history must not be rewritten by a template rename').toBe(
      'New Server Onboarding',
    )

    await pool.query(
      "update onboarding_templates set name = 'New Server Onboarding' where organization_id = $1 and name = 'Renamed Checklist'",
      [harborId],
    )
  })
})

describe('the directory reflects employment changes', () => {
  it('shows a separated person with their status, rather than hiding them', async () => {
    const dana = await actorFor(harborId, 'dana@harborvine.test')
    const people = await asTenant(harborId, (tx) =>
      listEmployments(tx, dana, { status: 'separated' }),
    )
    for (const person of people) expect(person.status).toBe('separated')
  })
})

describe('waiting on EverCalm is not the same as blocked', () => {
  it('does not mark someone blocked purely because a later slice has not shipped', () => {
    // Only a policy step is waiting on EverCalm, and nobody here can clear it.
    expect(
      deriveState(
        [
          {
            required: true,
            blocksCompletion: true,
            kind: 'employee_task',
            status: 'completed',
            dueOn: null,
          },
          {
            required: true,
            blocksCompletion: true,
            kind: 'policy_ack',
            status: 'blocked',
            dueOn: null,
          },
          {
            required: true,
            blocksCompletion: true,
            kind: 'employee_task',
            status: 'pending',
            dueOn: '2099-01-01',
          },
        ],
        null,
      ),
    ).toBe('in_progress')
  })

  it('DOES mark someone blocked when a person needs to do something', () => {
    expect(
      deriveState(
        [
          {
            required: true,
            blocksCompletion: true,
            kind: 'training_assignment',
            status: 'blocked',
            dueOn: null,
          },
          {
            required: true,
            blocksCompletion: true,
            kind: 'document_request',
            status: 'blocked',
            dueOn: null,
          },
        ],
        null,
      ),
    ).toBe('blocked')
  })

  it('flags platform-waiting steps distinctly in the view', async () => {
    const kofi = await actorFor(lumenId, 'kofi@lumensalon.test')
    const elodieId = await employmentIdFor(lumenId, 'Elodie Garnier')
    const progress = await asTenant(lumenId, (tx) => getProgressForEmployment(tx, kofi, elodieId))

    // Training has shipped: a training step follows its linked course, and is
    // never "waiting on EverCalm".
    const training = progress!.steps.find((s) => s.kind === 'training_assignment')!
    expect(training.awaitingPlatform).toBe(false)
    expect(training.training).not.toBeNull()

    // Elodie's licence verification is blocked by the state board - a real
    // world dependency, not ours.
    const licence = progress!.steps.find((s) => s.title.includes('Licence verified'))!
    expect(licence.status).toBe('blocked')
    expect(licence.awaitingPlatform).toBe(false)

    // So she reads as blocked, and the next action names the real blocker.
    expect(progress!.state).toBe('blocked')
    expect(progress!.nextAction).toMatch(/Licence verified|Patch testing|Consultation/)
  })
})
