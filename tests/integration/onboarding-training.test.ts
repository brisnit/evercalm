import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import {
  addStep,
  archiveTemplate,
  createDraftVersion,
  createTemplate,
  getTemplate,
  listLinkableCourses,
  publishVersion,
  setTemplateTargeting,
} from '@/modules/onboarding/templates'
import {
  assignOnboarding,
  completeStep,
  getProgressForEmployment,
} from '@/modules/onboarding/service'
import {
  addLesson,
  archiveCourse,
  createCourse,
  getCourse,
  publishDraft,
  saveQuestion,
  startNewDraft,
  updateLesson,
} from '@/modules/training/authoring'
import {
  allowAnotherAttempt,
  assignCourse,
  decideSignoff,
  withdrawAssignment,
} from '@/modules/training/assignments'
import { completeReading, requestSignoff, submitQuiz } from '@/modules/training/learner'
import { parseLessonContent } from '@/modules/training/content'
import {
  asTenant,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
  rawAsApp,
} from '../helpers/tenant'

/**
 * ONBOARDING <-> TRAINING, against real PostgreSQL.
 *
 * An onboarding step of kind `training_assignment` names a published course.
 * Starting onboarding gives the person that course, pinned to a version, and
 * the step then follows the course: complete when the course is complete,
 * waiting while a practical waits for a manager, blocked when the person is
 * out of attempts or the course was withdrawn - and never completable by hand.
 *
 * Every test builds its own courses and checklists, targets its own person by
 * job role AND location (so no seeded checklist can win), and archives the
 * checklist afterwards so later test files resolve exactly as before.
 */

let harborId: string
let lumenId: string
const users = new Map<string, string>()
const people = new Map<string, string>()
const places = new Map<string, string>()
const roles = new Map<string, string>()
const createdTemplates: { org: string; id: string }[] = []

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')
  const pool = await migrationClient()
  for (const r of (await pool.query<{ id: string; email: string }>('select id, email from "user"'))
    .rows) {
    users.set(r.email, r.id)
  }
  for (const r of (
    await pool.query<{ id: string; email: string; organization_id: string }>(
      'select e.id, u.email, e.organization_id from employments e join "user" u on u.id = e.user_id',
    )
  ).rows) {
    people.set(`${r.organization_id}:${r.email}`, r.id)
  }
  for (const r of (
    await pool.query<{ id: string; name: string; organization_id: string }>(
      'select id, name, organization_id from locations',
    )
  ).rows) {
    places.set(`${r.organization_id}:${r.name}`, r.id)
  }
  for (const r of (
    await pool.query<{ id: string; name: string; organization_id: string }>(
      'select id, name, organization_id from job_roles',
    )
  ).rows) {
    roles.set(`${r.organization_id}:${r.name}`, r.id)
  }
})

afterEach(async () => {
  const dana = await actor(harborId, DANA)
  const ana = await actor(lumenId, 'ana@lumensalon.test')
  for (const t of createdTemplates.splice(0)) {
    await asTenant(t.org, (tx) => archiveTemplate(tx, t.org === harborId ? dana : ana, t.id)).catch(
      () => undefined,
    )
  }
})

afterAll(async () => {
  await closeTestPools()
})

// --- helpers ------------------------------------------------------------------

const DANA = 'dana@harborvine.test'
const MARCUS = 'marcus@harborvine.test'
const TESS = 'tess@harborvine.test'

async function actor(org: string, email: string): Promise<Actor> {
  const a = await asTenant(org, (tx) => resolveActor(tx, org, users.get(email)!))
  if (!a) throw new Error(`No actor for ${email}`)
  return a
}

type TxOf = Parameters<Parameters<typeof asTenant>[1]>[0]
async function as<T>(
  email: string,
  fn: (tx: TxOf, a: Actor) => Promise<T>,
  org = harborId,
): Promise<T> {
  const a = await actor(org, email)
  return asTenant(org, (tx) => fn(tx, a))
}

const unique = (t: string) => `${t} ${Math.random().toString(36).slice(2, 8)}`
const personId = (email: string, org = harborId) => people.get(`${org}:${email}`)!

/** A published course. `quiz` adds a one-question check; `practical` adds a sign-off. */
async function publishedCourse(
  options: { quizAttempts?: number; practical?: boolean; org?: string; author?: string } = {},
) {
  const org = options.org ?? harborId
  const author = options.author ?? DANA
  const title = unique('Pass and expo standards')
  const courseId = await as(
    author,
    (tx, a) => createCourse(tx, a, { title, summary: 'How plates leave the kitchen.' }),
    org,
  )
  const versionId = (await as(author, (tx, a) => getCourse(tx, a, courseId), org)).draft!.id
  const reading = await as(
    author,
    (tx, a) =>
      addLesson(tx, a, versionId, {
        title: 'Calling the ticket',
        kind: 'reading',
        estimatedMinutes: 4,
      }),
    org,
  )
  await as(
    author,
    (tx, a) =>
      updateLesson(tx, a, reading, {
        title: 'Calling the ticket',
        estimatedMinutes: 4,
        body: 'Call the table number, then the seat numbers, then any modifiers.',
      }),
    org,
  )
  if (options.quizAttempts !== undefined) {
    const quiz = await as(
      author,
      (tx, a) =>
        addLesson(tx, a, versionId, {
          title: 'Knowledge check',
          kind: 'quiz',
          estimatedMinutes: 2,
        }),
      org,
    )
    await as(
      author,
      (tx, a) =>
        updateLesson(tx, a, quiz, {
          title: 'Knowledge check',
          estimatedMinutes: 2,
          body: '',
          passPercent: 100,
          maxAttempts: options.quizAttempts,
        }),
      org,
    )
    await as(
      author,
      (tx, a) =>
        saveQuestion(tx, a, quiz, null, {
          kind: 'true_false',
          prompt: 'Allergy plates are run by the server who took the order.',
          options: [],
          correct: [0],
          explanation: '',
        }),
      org,
    )
  }
  if (options.practical) {
    const practical = await as(
      author,
      (tx, a) =>
        addLesson(tx, a, versionId, {
          title: 'Run the pass for a turn',
          kind: 'practical',
          estimatedMinutes: 30,
        }),
      org,
    )
    await as(
      author,
      (tx, a) =>
        updateLesson(tx, a, practical, {
          title: 'Run the pass for a turn',
          estimatedMinutes: 30,
          body: 'A manager watches.',
          itemsText: 'Calls every ticket clearly',
        }),
      org,
    )
  }
  await as(author, (tx, a) => publishDraft(tx, a, versionId, { changeNote: '' }), org)
  const course = await as(author, (tx, a) => getCourse(tx, a, courseId), org)
  return { courseId, title, lessons: course.published!.lessons }
}

/** A published checklist with one training step linked to `courseId`, aimed only at this person. */
async function checklistFor(options: {
  courseId: string
  role: string
  location: string
  org?: string
  author?: string
}) {
  const org = options.org ?? harborId
  const author = options.author ?? DANA
  const created = await as(
    author,
    (tx, a) => createTemplate(tx, a, { name: unique('Linked onboarding') }),
    org,
  )
  createdTemplates.push({ org, id: created.templateId })
  const sectionId = (await as(author, (tx, a) => getTemplate(tx, a, created.templateId), org))
    .draftVersion!.sections[0]!.id
  await as(
    author,
    (tx, a) =>
      addStep(tx, a, sectionId, {
        title: 'Complete your pass training',
        kind: 'training_assignment',
        responsibility: 'employee',
        required: true,
        dueOffsetDays: 7,
        courseId: options.courseId,
      }),
    org,
  )
  await as(
    author,
    (tx, a) =>
      setTemplateTargeting(tx, a, created.templateId, {
        jobRoleIds: [roles.get(`${org}:${options.role}`)!],
        locationIds: [places.get(`${org}:${options.location}`)!],
      }),
    org,
  )
  await as(author, (tx, a) => publishVersion(tx, a, created.versionId), org)
  return created.templateId
}

async function trainingRows(email: string, courseId: string, org = harborId) {
  const r = await rawAsApp(
    org,
    'select id, status, source, version_number from training_assignments where employment_id = $1 and course_id = $2 order by assigned_at',
    [personId(email, org), courseId],
  )
  return r.rows as { id: string; status: string; source: string; version_number: number }[]
}

async function linkedStep(email: string, viewer = DANA, org = harborId) {
  const progress = await as(
    viewer,
    (tx, a) => getProgressForEmployment(tx, a, personId(email, org)),
    org,
  )
  const step = progress!.steps.find((s) => s.kind === 'training_assignment')!
  return { progress: progress!, step }
}

// --- authoring ----------------------------------------------------------------

describe('linking a course to a checklist step', () => {
  it('offers only published, active courses from this organization', async () => {
    const live = await publishedCourse()
    const draftOnly = await as(DANA, (tx, a) =>
      createCourse(tx, a, { title: unique('Unpublished'), summary: '' }),
    )
    const archived = await publishedCourse()
    await as(DANA, (tx, a) => archiveCourse(tx, a, archived.courseId))

    const offered = await as(DANA, (tx, a) => listLinkableCourses(tx, a))
    const ids = offered.map((c) => c.id)
    expect(ids).toContain(live.courseId)
    expect(ids).not.toContain(draftOnly)
    expect(ids).not.toContain(archived.courseId)
    expect(offered.find((c) => c.id === live.courseId)).toMatchObject({
      title: live.title,
      versionNumber: 1,
    })
  })

  it('refuses drafts, archived courses, other tenants, and people without onboarding.manage', async () => {
    const created = await as(DANA, (tx, a) => createTemplate(tx, a, { name: unique('Refusals') }))
    createdTemplates.push({ org: harborId, id: created.templateId })
    const sectionId = (await as(DANA, (tx, a) => getTemplate(tx, a, created.templateId)))
      .draftVersion!.sections[0]!.id
    const step = (courseId: string | null) => ({
      title: 'Training',
      kind: 'training_assignment' as const,
      responsibility: 'employee' as const,
      required: true,
      courseId,
    })

    const draftOnly = await as(DANA, (tx, a) =>
      createCourse(tx, a, { title: unique('Draft course'), summary: '' }),
    )
    const draftError = await as(DANA, (tx, a) => addStep(tx, a, sectionId, step(draftOnly))).catch(
      (e: unknown) => e,
    )
    expect(draftError).toBeInstanceOf(ValidationError)
    expect((draftError as ValidationError).fieldErrors.courseId).toBeDefined()

    const salon = await publishedCourse({ org: lumenId, author: 'yuki@lumensalon.test' })
    await expect(
      as(DANA, (tx, a) => addStep(tx, a, sectionId, step(salon.courseId))),
    ).rejects.toBeInstanceOf(ValidationError)

    const live = await publishedCourse()
    await expect(
      as(MARCUS, (tx, a) => addStep(tx, a, sectionId, step(live.courseId))),
    ).rejects.toBeInstanceOf(ForbiddenError)

    // A course on a step of any other kind is refused rather than silently stored.
    await expect(
      as(DANA, (tx, a) =>
        addStep(tx, a, sectionId, { ...step(live.courseId), kind: 'employee_task' }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    // An unlinked training step can be drafted, but not published.
    await as(DANA, (tx, a) => addStep(tx, a, sectionId, step(null)))
    await expect(as(DANA, (tx, a) => publishVersion(tx, a, created.versionId))).rejects.toThrow(
      /Link a course/,
    )
  })

  it('carries the link into a new draft, and the database refuses a cross-tenant link', async () => {
    const live = await publishedCourse()
    const templateId = await checklistFor({
      courseId: live.courseId,
      role: 'Busser',
      location: 'Downtown',
    })
    await as(DANA, (tx, a) => createDraftVersion(tx, a, templateId))
    const detail = await as(DANA, (tx, a) => getTemplate(tx, a, templateId))
    const draftStep = detail
      .draftVersion!.sections.flatMap((s) => s.steps)
      .find((s) => s.kind === 'training_assignment')!
    expect(draftStep).toMatchObject({ courseId: live.courseId, courseTitle: live.title })

    const salon = await publishedCourse({ org: lumenId, author: 'yuki@lumensalon.test' })
    await expect(
      rawAsApp(harborId, 'update onboarding_steps set course_id = $1 where id = $2', [
        salon.courseId,
        draftStep.id,
      ]),
    ).rejects.toThrow(/foreign key/)
  })
})

// --- starting onboarding ------------------------------------------------------

describe('starting onboarding assigns the linked course', () => {
  it('pins the current version, notifies, and never duplicates the assignment', async () => {
    const course = await publishedCourse()
    await checklistFor({ courseId: course.courseId, role: 'Bartender', location: 'Riverside' })
    const onboardingId = await as(DANA, (tx, a) =>
      assignOnboarding(tx, a, personId('camille@harborvine.test')),
    )

    const rows = await trainingRows('camille@harborvine.test', course.courseId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'assigned', source: 'onboarding', version_number: 1 })

    const { step } = await linkedStep('camille@harborvine.test')
    expect(step.status).toBe('pending')
    expect(step.selfCompletable).toBe(false)
    expect(step.training).toMatchObject({
      assignmentId: rows[0]!.id,
      courseTitle: course.title,
      versionNumber: 1,
      state: 'not_started',
    })

    const notices = await rawAsApp(
      harborId,
      "select count(*)::int as n from notifications where subject_id = $1 and channel = 'in_app'",
      [rows[0]!.id],
    )
    expect(notices.rows[0].n).toBe(1)

    // Assigning onboarding again, or the same course by hand, adds nothing.
    expect(
      await as(DANA, (tx, a) => assignOnboarding(tx, a, personId('camille@harborvine.test'))),
    ).toBe(onboardingId)
    const again = await as(MARCUS, (tx, a) =>
      assignCourse(tx, a, {
        courseId: course.courseId,
        locationId: places.get(`${harborId}:Riverside`)!,
        employmentIds: [personId('camille@harborvine.test')],
        jobRoleId: null,
        dueOn: null,
        required: true,
        note: '',
      }),
    )
    expect(again.assigned).toBe(0)
    expect(await trainingRows('camille@harborvine.test', course.courseId)).toHaveLength(1)

    // Publishing a newer version later moves nobody.
    const draft = await as(DANA, (tx, a) => startNewDraft(tx, a, course.courseId))
    await as(DANA, (tx, a) => publishDraft(tx, a, draft, { changeNote: 'Clearer calls.' }))
    expect((await linkedStep('camille@harborvine.test')).step.training).toMatchObject({
      versionNumber: 1,
    })
  })

  it('links to an open assignment on an older version rather than replacing it', async () => {
    const course = await publishedCourse()
    await as(MARCUS, (tx, a) =>
      assignCourse(tx, a, {
        courseId: course.courseId,
        locationId: places.get(`${harborId}:Riverside`)!,
        employmentIds: [personId('jordan@harborvine.test')],
        jobRoleId: null,
        dueOn: null,
        required: true,
        note: '',
      }),
    )
    const draft = await as(DANA, (tx, a) => startNewDraft(tx, a, course.courseId))
    await as(DANA, (tx, a) => publishDraft(tx, a, draft, { changeNote: 'Version 2.' }))

    await checklistFor({ courseId: course.courseId, role: 'Server', location: 'Riverside' })
    await as(DANA, (tx, a) => assignOnboarding(tx, a, personId('jordan@harborvine.test')))

    const rows = await trainingRows('jordan@harborvine.test', course.courseId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'manual', version_number: 1 })
    expect((await linkedStep('jordan@harborvine.test')).step.training).toMatchObject({
      assignmentId: rows[0]!.id,
      versionNumber: 1,
    })
  })

  it('counts a course already completed, without assigning it again', async () => {
    const course = await publishedCourse()
    await as(TESS, (tx, a) =>
      assignCourse(tx, a, {
        courseId: course.courseId,
        locationId: places.get(`${harborId}:Downtown`)!,
        employmentIds: [personId('theo@harborvine.test')],
        jobRoleId: null,
        dueOn: null,
        required: true,
        note: '',
      }),
    )
    const [open] = await trainingRows('theo@harborvine.test', course.courseId)
    await as('theo@harborvine.test', (tx, a) =>
      completeReading(tx, a, open!.id, course.lessons[0]!.id),
    )

    await checklistFor({ courseId: course.courseId, role: 'Host', location: 'Downtown' })
    await as(DANA, (tx, a) => assignOnboarding(tx, a, personId('theo@harborvine.test')))

    expect(await trainingRows('theo@harborvine.test', course.courseId)).toHaveLength(1)
    const { step } = await linkedStep('theo@harborvine.test')
    expect(step.status).toBe('completed')
    expect(step.training).toMatchObject({ assignmentId: open!.id, state: 'completed' })
  })

  it('blocks the step, visibly, when the linked course has been archived since publishing', async () => {
    const course = await publishedCourse()
    await checklistFor({ courseId: course.courseId, role: 'Server', location: 'Downtown' })
    await as(DANA, (tx, a) => archiveCourse(tx, a, course.courseId))
    await as(DANA, (tx, a) => assignOnboarding(tx, a, personId('noa.feldman@example.test')))

    expect(await trainingRows('noa.feldman@example.test', course.courseId)).toHaveLength(0)
    const { step } = await linkedStep('noa.feldman@example.test')
    expect(step.status).toBe('blocked')
    expect(step.blockedReason).toMatch(/archived/)
    expect(step.training).toMatchObject({ assignmentId: null, state: 'unavailable' })
  })
})

// --- following the course -----------------------------------------------------

describe('the step follows the course', () => {
  it('waits during sign-off, completes with the course, and cannot be ticked off by hand', async () => {
    const course = await publishedCourse({ practical: true })
    await checklistFor({ courseId: course.courseId, role: 'Busser', location: 'Downtown' })
    const kai = 'kai@harborvine.test'
    // Kai was seeded mid-onboarding; replace that run with ours for this test.
    await rawAsApp(null, 'select 1')
    const pool = await migrationClient()
    await pool.query('delete from onboarding_assignments where employment_id = $1', [personId(kai)])
    await as(DANA, (tx, a) => assignOnboarding(tx, a, personId(kai)))
    const [assignment] = await trainingRows(kai, course.courseId)

    await expect(
      as(TESS, async (tx, a) => completeStep(tx, a, (await linkedStep(kai)).step.id)),
    ).rejects.toThrow(/completes itself/)

    await as(kai, (tx, a) => completeReading(tx, a, assignment!.id, course.lessons[0]!.id))
    expect((await linkedStep(kai)).step.training).toMatchObject({
      state: 'in_progress',
      completedLessons: 1,
      totalLessons: 2,
    })

    await as(kai, (tx, a) => requestSignoff(tx, a, assignment!.id, course.lessons[1]!.id))
    const waiting = await linkedStep(kai, kai)
    expect(waiting.step.status).toBe('pending')
    expect(waiting.step.training).toMatchObject({ state: 'awaiting_signoff' })
    expect(waiting.progress.nextAction).not.toBe('Complete your pass training')

    const progress = await rawAsApp(
      harborId,
      'select id from training_lesson_progress where assignment_id = $1 and lesson_id = $2',
      [assignment!.id, course.lessons[1]!.id],
    )
    const practical = parseLessonContent('practical', course.lessons[1]!.content)
    if (practical.kind !== 'practical') throw new Error('expected practical')
    await as(TESS, (tx, a) =>
      decideSignoff(tx, a, progress.rows[0].id, {
        decision: 'verified',
        note: '',
        criteriaConfirmed: practical.criteria.map((c) => c.id),
      }),
    )

    const done = await linkedStep(kai)
    expect(done.step.status).toBe('completed')
    expect(done.step.training).toMatchObject({ state: 'completed' })
    expect(done.progress.completedAt).not.toBeNull()
    const audit = await rawAsApp(
      harborId,
      "select action from audit_events where subject_id = $1 and action like 'onboarding%'",
      [personId(kai)],
    )
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual(
      expect.arrayContaining(['onboarding_step.completed', 'onboarding.completed']),
    )
  })

  it('blocks when attempts run out, reopens when a manager allows one more, and never completes on withdrawal', async () => {
    const course = await publishedCourse({ quizAttempts: 1 })
    await checklistFor({ courseId: course.courseId, role: 'Line Cook', location: 'Riverside' })
    const dmitri = 'dmitri@harborvine.test'
    const pool = await migrationClient()
    await pool.query('delete from onboarding_assignments where employment_id = $1', [
      personId(dmitri),
    ])
    await as(DANA, (tx, a) => assignOnboarding(tx, a, personId(dmitri)))
    const [assignment] = await trainingRows(dmitri, course.courseId)
    const quiz = course.lessons.find((l) => l.kind === 'quiz')!
    const content = parseLessonContent('quiz', quiz.content)
    if (content.kind !== 'quiz') throw new Error('expected quiz')
    const q = content.questions[0]!
    const wrong = q.options.find((o) => !q.correctOptionIds.includes(o.id))!.id

    await as(dmitri, (tx, a) => submitQuiz(tx, a, assignment!.id, quiz.id, { [q.id]: [wrong] }))
    const blocked = await linkedStep(dmitri)
    expect(blocked.step.status).toBe('blocked')
    expect(blocked.step.blockedReason).toMatch(/attempts/i)
    expect(blocked.step.training).toMatchObject({ state: 'blocked' })

    await as(MARCUS, (tx, a) => allowAnotherAttempt(tx, a, assignment!.id, quiz.id))
    expect((await linkedStep(dmitri)).step.status).toBe('pending')

    await as(MARCUS, (tx, a) =>
      withdrawAssignment(tx, a, assignment!.id, 'Moving to the dish station.'),
    )
    const withdrawn = await linkedStep(dmitri)
    expect(withdrawn.step.status).toBe('blocked')
    expect(withdrawn.step.blockedReason).toMatch(/withdrawn/)
    expect(withdrawn.step.training).toMatchObject({ state: 'withdrawn' })

    // Assigning the course again relinks the step to the new assignment.
    await as(MARCUS, (tx, a) =>
      assignCourse(tx, a, {
        courseId: course.courseId,
        locationId: places.get(`${harborId}:Riverside`)!,
        employmentIds: [personId(dmitri)],
        jobRoleId: null,
        dueOn: null,
        required: true,
        note: '',
      }),
    )
    const rows = await trainingRows(dmitri, course.courseId)
    const relinked = await linkedStep(dmitri)
    expect(relinked.step.status).toBe('pending')
    expect(relinked.step.training).toMatchObject({
      assignmentId: rows.at(-1)!.id,
      state: 'not_started',
    })
  })
})

// --- scope --------------------------------------------------------------------

describe('scope', () => {
  it('keeps salon locations and tenants apart', async () => {
    const course = await publishedCourse({ org: lumenId, author: 'yuki@lumensalon.test' })
    await checklistFor({
      courseId: course.courseId,
      role: 'Massage Therapist',
      location: 'Boise Bench',
      org: lumenId,
      author: 'ana@lumensalon.test',
    })
    const ruben = 'ruben@lumensalon.test'
    await as(
      'ana@lumensalon.test',
      (tx, a) => assignOnboarding(tx, a, personId(ruben, lumenId)),
      lumenId,
    )

    const sierra = await linkedStep(ruben, 'sierra@lumensalon.test', lumenId)
    expect(sierra.step.training).toMatchObject({ courseTitle: course.title })
    await expect(
      as(
        'kofi@lumensalon.test',
        (tx, a) => getProgressForEmployment(tx, a, personId(ruben, lumenId)),
        lumenId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      as(DANA, (tx, a) => getProgressForEmployment(tx, a, personId(ruben, lumenId))),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses to let a location manager start onboarding', async () => {
    await expect(
      as(MARCUS, (tx, a) => assignOnboarding(tx, a, personId('omar@harborvine.test'))),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
