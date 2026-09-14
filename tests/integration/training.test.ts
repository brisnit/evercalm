import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import {
  addLesson,
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
  moveNotStartedToCurrent,
  scopedAssignments,
  signoffQueue,
  withdrawAssignment,
} from '@/modules/training/assignments'
import {
  completeReading,
  myAssignment,
  myLesson,
  myTraining,
  requestSignoff,
  saveChecklist,
  submitQuiz,
} from '@/modules/training/learner'
import { parseLessonContent } from '@/modules/training/content'
import {
  asTenant,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
  rawAsApp,
} from '../helpers/tenant'

/**
 * TRAINING, END TO END, against real PostgreSQL.
 *
 * The promises under test:
 *
 *   only content roles author and publish; people work is location-scoped,
 *     and outside scope is not found
 *   a published version never changes - not through the service, not through
 *     SQL - and an assignment keeps the version it was given
 *   quizzes are scored on the server, the answer key stays hidden until a
 *     pass, and attempt limits hold
 *   progress, completion and sign-off are computed from records, and nobody
 *     signs off their own practical
 *
 * Every test builds its own courses with unique titles, so it never depends on
 * (or disturbs) the seeded training.
 */

let harborId: string
let lumenId: string
const users = new Map<string, string>()
const employmentIds = new Map<string, string>()
const locationIds = new Map<string, string>()

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')
  const pool = await migrationClient()
  for (const row of (
    await pool.query<{ id: string; email: string }>('select id, email from "user"')
  ).rows) {
    users.set(row.email, row.id)
  }
  const people = await pool.query<{ id: string; email: string; organization_id: string }>(
    `select e.id, u.email, e.organization_id from employments e join "user" u on u.id = e.user_id`,
  )
  for (const row of people.rows) employmentIds.set(`${row.organization_id}:${row.email}`, row.id)
  const places = await pool.query<{ id: string; name: string }>('select id, name from locations')
  for (const row of places.rows) locationIds.set(row.name, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

// --- helpers ------------------------------------------------------------------

const HARBOR = {
  owner: 'dana@harborvine.test',
  hr: 'priya@harborvine.test',
  riverside: 'marcus@harborvine.test',
  downtown: 'tess@harborvine.test',
  scheduler: 'omar@harborvine.test',
  sam: 'sam@harborvine.test',
  ava: 'ava@harborvine.test',
  camille: 'camille@harborvine.test',
  theo: 'theo@harborvine.test',
}

async function actor(organizationId: string, email: string): Promise<Actor> {
  const resolved = await asTenant(organizationId, (tx) =>
    resolveActor(tx, organizationId, users.get(email)!),
  )
  if (!resolved) throw new Error(`No actor for ${email}`)
  return resolved
}

const person = (organizationId: string, email: string) =>
  employmentIds.get(`${organizationId}:${email}`)!
const place = (name: string) => locationIds.get(name)!
const unique = (title: string) => `${title} ${Math.random().toString(36).slice(2, 8)}`

async function as<T>(
  email: string,
  fn: (tx: Parameters<Parameters<typeof asTenant>[1]>[0], a: Actor) => Promise<T>,
  org = harborId,
) {
  const a = await actor(org, email)
  return asTenant(org, (tx) => fn(tx as never, a))
}

/** A published course: reading, checklist, quiz, practical. */
async function publishedCourse(options: { maxAttempts?: number } = {}) {
  const title = unique('Closing the dish pit')
  const courseId = await as(HARBOR.owner, (tx, a) =>
    createCourse(tx, a, { title, summary: 'How we close.' }),
  )
  const course = await as(HARBOR.owner, (tx, a) => getCourse(tx, a, courseId))
  const versionId = course.draft!.id
  const reading = await as(HARBOR.owner, (tx, a) =>
    addLesson(tx, a, versionId, {
      title: 'Why the pit closes last',
      kind: 'reading',
      estimatedMinutes: 3,
    }),
  )
  await as(HARBOR.owner, (tx, a) =>
    updateLesson(tx, a, reading, {
      title: 'Why the pit closes last',
      estimatedMinutes: 3,
      body: 'Every pan from close comes through here, so the pit closes after the line.',
    }),
  )
  const checklist = await as(HARBOR.owner, (tx, a) =>
    addLesson(tx, a, versionId, { title: 'Closing steps', kind: 'checklist', estimatedMinutes: 4 }),
  )
  await as(HARBOR.owner, (tx, a) =>
    updateLesson(tx, a, checklist, {
      title: 'Closing steps',
      estimatedMinutes: 4,
      body: '',
      itemsText: 'Drain and clean the machine\nEmpty the food trap',
    }),
  )
  const quiz = await as(HARBOR.owner, (tx, a) =>
    addLesson(tx, a, versionId, { title: 'Knowledge check', kind: 'quiz', estimatedMinutes: 2 }),
  )
  await as(HARBOR.owner, (tx, a) =>
    updateLesson(tx, a, quiz, {
      title: 'Knowledge check',
      estimatedMinutes: 2,
      body: '',
      passPercent: 100,
      maxAttempts: options.maxAttempts ?? 0,
    }),
  )
  await as(HARBOR.owner, (tx, a) =>
    saveQuestion(tx, a, quiz, null, {
      kind: 'single',
      prompt: 'What rinse temperature does the machine need to sanitize?',
      options: ['120°F', '180°F', '140°F'],
      correct: [1],
      explanation: 'High-temperature machines sanitize with a final rinse of at least 180°F.',
    }),
  )
  const practical = await as(HARBOR.owner, (tx, a) =>
    addLesson(tx, a, versionId, {
      title: 'Close the pit with a lead',
      kind: 'practical',
      estimatedMinutes: 20,
    }),
  )
  await as(HARBOR.owner, (tx, a) =>
    updateLesson(tx, a, practical, {
      title: 'Close the pit with a lead',
      estimatedMinutes: 20,
      body: 'A manager watches you close.',
      itemsText: 'Machine drained\nFloor squeegeed to the drain',
    }),
  )
  await as(HARBOR.owner, (tx, a) => publishDraft(tx, a, versionId, { changeNote: '' }))
  const published = await as(HARBOR.owner, (tx, a) => getCourse(tx, a, courseId))
  return { courseId, versionId, title, lessons: published.published!.lessons }
}

async function assign(
  courseId: string,
  emails: string[],
  by = HARBOR.riverside,
  location = 'Riverside',
) {
  return as(by, (tx, a) =>
    assignCourse(tx, a, {
      courseId,
      locationId: place(location),
      employmentIds: emails.map((e) => person(harborId, e)),
      jobRoleId: null,
      dueOn: null,
      required: true,
      note: '',
    }),
  )
}

async function assignmentId(courseId: string, email: string): Promise<string> {
  const pool = await migrationClient()
  const row = await pool.query<{ id: string }>(
    `select id from training_assignments where course_id = $1 and employment_id = $2 order by assigned_at desc limit 1`,
    [courseId, person(harborId, email)],
  )
  return row.rows[0]!.id
}

// --- authoring ----------------------------------------------------------------

describe('authoring and publication', () => {
  it('lets only content roles author; location managers are told, employees learn nothing', async () => {
    await expect(
      as(HARBOR.riverside, (tx, a) => createCourse(tx, a, { title: unique('x'), summary: '' })),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      as(HARBOR.hr, (tx, a) => createCourse(tx, a, { title: unique('x'), summary: '' })),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      as(HARBOR.sam, (tx, a) => createCourse(tx, a, { title: unique('x'), summary: '' })),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      as(HARBOR.scheduler, (tx, a) => createCourse(tx, a, { title: unique('x'), summary: '' })),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses to publish a draft that is not complete, and says why', async () => {
    const courseId = await as(HARBOR.owner, (tx, a) =>
      createCourse(tx, a, { title: unique('Draft'), summary: '' }),
    )
    const course = await as(HARBOR.owner, (tx, a) => getCourse(tx, a, courseId))
    await as(HARBOR.owner, (tx, a) =>
      addLesson(tx, a, course.draft!.id, { title: 'Check', kind: 'quiz', estimatedMinutes: 2 }),
    )
    const error = await as(HARBOR.owner, (tx, a) =>
      publishDraft(tx, a, course.draft!.id, { changeNote: '' }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).fieldErrors.publish).toEqual([
      'Check: It needs at least one question.',
    ])
    // Publishing is its own capability: HR may assign but not publish.
    await expect(
      as(HARBOR.hr, (tx, a) => publishDraft(tx, a, course.draft!.id, { changeNote: '' })),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('hides unpublished courses from people who do not manage content', async () => {
    const courseId = await as(HARBOR.owner, (tx, a) =>
      createCourse(tx, a, { title: unique('Hidden'), summary: '' }),
    )
    await expect(
      as(HARBOR.riverside, (tx, a) => getCourse(tx, a, courseId)),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      as('ana@lumensalon.test', (tx, a) => getCourse(tx, a, courseId), lumenId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('freezes a published version in the service and in the database', async () => {
    const { lessons } = await publishedCourse()
    const reading = lessons[0]!
    await expect(
      as(HARBOR.owner, (tx, a) =>
        updateLesson(tx, a, reading.id, { title: 'Edited', estimatedMinutes: 3, body: 'Edited' }),
      ),
    ).rejects.toThrow(/published and cannot be changed/)
    await expect(
      rawAsApp(harborId, `update course_lessons set body = 'sneaky' where id = $1`, [reading.id]),
    ).rejects.toThrow(/cannot be changed/)
    await expect(
      rawAsApp(harborId, `delete from course_lessons where id = $1`, [reading.id]),
    ).rejects.toThrow(/cannot be changed/)
  })
})

// --- versions -----------------------------------------------------------------

describe('an assignment keeps the version it was given', () => {
  it('publishes a new version without moving anyone, and moves only people who have not started', async () => {
    const { courseId, lessons } = await publishedCourse()
    await assign(courseId, [HARBOR.sam, HARBOR.ava])
    const samAssignment = await assignmentId(courseId, HARBOR.sam)
    const avaAssignment = await assignmentId(courseId, HARBOR.ava)
    await as(HARBOR.sam, (tx, a) => completeReading(tx, a, samAssignment, lessons[0]!.id))

    const draftId = await as(HARBOR.owner, (tx, a) => startNewDraft(tx, a, courseId))
    const draft = (await as(HARBOR.owner, (tx, a) => getCourse(tx, a, courseId))).draft!
    expect(draft.lessons.map((l) => l.title)).toEqual(lessons.map((l) => l.title))
    await as(HARBOR.owner, (tx, a) =>
      updateLesson(tx, a, draft.lessons[0]!.id, {
        title: 'Why the pit really closes last',
        estimatedMinutes: 3,
        body: 'Rewritten.',
      }),
    )
    await expect(
      as(HARBOR.owner, (tx, a) => publishDraft(tx, a, draftId, { changeNote: '' })),
    ).rejects.toBeInstanceOf(ValidationError)
    const result = await as(HARBOR.owner, (tx, a) =>
      publishDraft(tx, a, draftId, { changeNote: 'Rewrote the first lesson.' }),
    )
    expect(result).toEqual({ versionNumber: 2, notStartedOnOlderVersions: 1 })

    // Sam started on version 1 and still sees version 1's words.
    const samView = await as(HARBOR.sam, (tx, a) => myLesson(tx, a, samAssignment, lessons[0]!.id))
    expect(samView.assignment.versionNumber).toBe(1)
    expect(samView.lesson.title).toBe('Why the pit closes last')
    // A lesson from version 2 does not exist for Sam's assignment.
    await expect(
      as(HARBOR.sam, (tx, a) => completeReading(tx, a, samAssignment, draft.lessons[1]!.id)),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Somebody assigned now gets version 2.
    await assign(courseId, [HARBOR.camille])
    const camilleRow = await rawAsApp(
      harborId,
      'select version_number from training_assignments where id = $1',
      [await assignmentId(courseId, HARBOR.camille)],
    )
    expect(camilleRow.rows[0].version_number).toBe(2)

    // Moving people: Ava had not started, Sam had.
    const moved = await as(HARBOR.riverside, (tx, a) => moveNotStartedToCurrent(tx, a, courseId))
    expect(moved).toEqual({ moved: 1, versionNumber: 2 })
    const versions = await rawAsApp(
      harborId,
      'select id, version_number from training_assignments where id = any($1)',
      [[samAssignment, avaAssignment]],
    )
    const byId = new Map(versions.rows.map((r) => [r.id, r.version_number]))
    expect(byId.get(samAssignment)).toBe(1)
    expect(byId.get(avaAssignment)).toBe(2)

    // And the database will not move someone who has progress, whatever asks.
    const v2 = await rawAsApp(
      harborId,
      'select course_version_id from training_assignments where id = $1',
      [avaAssignment],
    )
    await expect(
      rawAsApp(
        harborId,
        'update training_assignments set course_version_id = $1, version_number = 2 where id = $2',
        [v2.rows[0].course_version_id, samAssignment],
      ),
    ).rejects.toThrow(/foreign key/)
  })
})

// --- scope --------------------------------------------------------------------

describe('assignment scope', () => {
  it('lets a manager assign only people at their location', async () => {
    const { courseId } = await publishedCourse()
    // Theo works Downtown. At Riverside he is not found...
    await expect(assign(courseId, [HARBOR.theo])).rejects.toBeInstanceOf(NotFoundError)
    // ...and Downtown itself is outside Marcus's reach.
    await expect(
      assign(courseId, [HARBOR.theo], HARBOR.riverside, 'Downtown'),
    ).rejects.toBeInstanceOf(NotFoundError)
    // HR assigns across the organization; a scheduler has no training reach at all.
    await expect(assign(courseId, [HARBOR.theo], HARBOR.hr, 'Downtown')).resolves.toMatchObject({
      assigned: 1,
    })
    await expect(assign(courseId, [HARBOR.sam], HARBOR.scheduler)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(assign(courseId, [HARBOR.ava], HARBOR.sam)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('never gives anyone the same open course twice', async () => {
    const { courseId } = await publishedCourse()
    expect(await assign(courseId, [HARBOR.sam])).toMatchObject({ assigned: 1, alreadyAssigned: [] })
    expect(await assign(courseId, [HARBOR.sam, HARBOR.ava])).toMatchObject({
      assigned: 1,
      alreadyAssigned: ['Sam Whitfield'],
    })
  })

  it('refuses a past due date, an unpublished course, and people from another tenant', async () => {
    const { courseId } = await publishedCourse()
    await expect(
      as(HARBOR.riverside, (tx, a) =>
        assignCourse(tx, a, {
          courseId,
          locationId: place('Riverside'),
          employmentIds: [person(harborId, HARBOR.sam)],
          jobRoleId: null,
          dueOn: '2020-01-01',
          required: true,
          note: '',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    const draftOnly = await as(HARBOR.owner, (tx, a) =>
      createCourse(tx, a, { title: unique('Unpublished'), summary: '' }),
    )
    await expect(assign(draftOnly, [HARBOR.sam], HARBOR.owner)).rejects.toThrow(
      /Publish this course/,
    )

    const elodie = person(lumenId, 'elodie@lumensalon.test')
    await expect(
      as(HARBOR.owner, (tx, a) =>
        assignCourse(tx, a, {
          courseId,
          locationId: place('Riverside'),
          employmentIds: [elodie],
          jobRoleId: null,
          dueOn: null,
          required: true,
          note: '',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('assigns everyone holding a job role at the location', async () => {
    const { courseId } = await publishedCourse()
    const pool = await migrationClient()
    const role = await pool.query<{ id: string }>(
      `select id from job_roles where organization_id = $1 and name = 'Server'`,
      [harborId],
    )
    const result = await as(HARBOR.riverside, (tx, a) =>
      assignCourse(tx, a, {
        courseId,
        locationId: place('Riverside'),
        employmentIds: [],
        jobRoleId: role.rows[0]!.id,
        dueOn: null,
        required: true,
        note: '',
      }),
    )
    // Jordan, Sam and Ava are servers at Riverside; Noa is a server Downtown.
    expect(result.assigned).toBe(3)
    const sources = await rawAsApp(
      harborId,
      `select distinct source from training_assignments where course_id = $1`,
      [courseId],
    )
    expect(sources.rows.map((r: { source: string }) => r.source)).toEqual(['job_role'])
  })
})

// --- learning -----------------------------------------------------------------

describe('learning', () => {
  it('shows people only their own training - managers included', async () => {
    const { courseId } = await publishedCourse()
    await assign(courseId, [HARBOR.sam])
    const id = await assignmentId(courseId, HARBOR.sam)
    await expect(as(HARBOR.ava, (tx, a) => myAssignment(tx, a, id))).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(as(HARBOR.riverside, (tx, a) => myAssignment(tx, a, id))).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      as('ana@lumensalon.test', (tx, a) => myAssignment(tx, a, id), lumenId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('scores quizzes on the server, hides the answer key until a pass, and holds the attempt limit', async () => {
    const { courseId, lessons } = await publishedCourse({ maxAttempts: 2 })
    const quiz = lessons.find((l) => l.kind === 'quiz')!
    const content = parseLessonContent('quiz', { ...quiz.content, kind: undefined })
    if (content.kind !== 'quiz') throw new Error('expected quiz')
    const question = content.questions[0]!
    const right = question.correctOptionIds
    const wrong = [question.options.find((o) => !right.includes(o.id))!.id]

    await assign(courseId, [HARBOR.ava])
    const id = await assignmentId(courseId, HARBOR.ava)

    const before = await as(HARBOR.ava, (tx, a) => myLesson(tx, a, id, quiz.id))
    expect(JSON.stringify(before.quiz!.questions)).not.toContain('correct')

    await expect(as(HARBOR.ava, (tx, a) => submitQuiz(tx, a, id, quiz.id, {}))).rejects.toThrow(
      /still needs an answer/,
    )
    expect(
      (await as(HARBOR.ava, (tx, a) => submitQuiz(tx, a, id, quiz.id, { [question.id]: wrong })))
        .passed,
    ).toBe(false)
    const afterFail = await as(HARBOR.ava, (tx, a) => myLesson(tx, a, id, quiz.id))
    expect(afterFail.quiz!.review![0]!.correct).toBe(false)
    expect(afterFail.quiz!.review![0]!.correctOptionIds).toBeNull()
    expect(afterFail.quiz!.review![0]!.explanation).toBeNull()

    await as(HARBOR.ava, (tx, a) => submitQuiz(tx, a, id, quiz.id, { [question.id]: wrong }))
    await expect(
      as(HARBOR.ava, (tx, a) => submitQuiz(tx, a, id, quiz.id, { [question.id]: right })),
    ).rejects.toThrow(/used every attempt/)

    // A manager elsewhere cannot help; Ava's own manager can.
    await expect(
      as(HARBOR.downtown, (tx, a) => allowAnotherAttempt(tx, a, id, quiz.id)),
    ).rejects.toBeInstanceOf(NotFoundError)
    await as(HARBOR.riverside, (tx, a) => allowAnotherAttempt(tx, a, id, quiz.id))
    const pass = await as(HARBOR.ava, (tx, a) =>
      submitQuiz(tx, a, id, quiz.id, { [question.id]: right }),
    )
    expect(pass.passed).toBe(true)
    expect(pass.message).toMatch(/^Passed: 1 of 1 correct\./)

    const afterPass = await as(HARBOR.ava, (tx, a) => myLesson(tx, a, id, quiz.id))
    expect(afterPass.quiz!.review![0]!.correctOptionIds).toEqual(right)
    expect(afterPass.quiz!.review![0]!.explanation).toContain('180°F')
    await expect(
      as(HARBOR.ava, (tx, a) => submitQuiz(tx, a, id, quiz.id, { [question.id]: right })),
    ).rejects.toThrow(/already passed/)

    const attempts = await rawAsApp(
      harborId,
      'select attempt_number, passed from training_quiz_attempts where assignment_id = $1 order by 1',
      [id],
    )
    expect(attempts.rows).toEqual([
      { attempt_number: 1, passed: false },
      { attempt_number: 2, passed: false },
      { attempt_number: 3, passed: true },
    ])
  })

  it('tracks progress to completion through a manager sign-off nobody can give themselves', async () => {
    const { courseId, lessons } = await publishedCourse()
    const [reading, checklist, quiz, practical] = lessons
    await assign(courseId, [HARBOR.sam, HARBOR.riverside])
    const id = await assignmentId(courseId, HARBOR.sam)

    const first = await as(HARBOR.sam, (tx, a) => completeReading(tx, a, id, reading!.id))
    expect(first.message).toBe('Good start: 1 of 4 lessons done. Next: Closing steps.')
    expect(first.nextLessonId).toBe(checklist!.id)

    const items = parseLessonContent('checklist', checklist!.content)
    if (items.kind !== 'checklist') throw new Error('expected checklist')
    const partial = await as(HARBOR.sam, (tx, a) =>
      saveChecklist(tx, a, id, checklist!.id, [items.items[0]!.id, 'invented']),
    )
    expect(partial.message).toMatch(/^Saved: 1 of 2 checked/)
    const half = await as(HARBOR.sam, (tx, a) =>
      saveChecklist(
        tx,
        a,
        id,
        checklist!.id,
        items.items.map((i) => i.id),
      ),
    )
    expect(half.message).toBe('Halfway there: 2 of 4 lessons done. Next: Knowledge check.')

    const q = parseLessonContent('quiz', quiz!.content)
    if (q.kind !== 'quiz') throw new Error('expected quiz')
    await as(HARBOR.sam, (tx, a) =>
      submitQuiz(tx, a, id, quiz!.id, { [q.questions[0]!.id]: q.questions[0]!.correctOptionIds }),
    )
    await as(HARBOR.sam, (tx, a) => requestSignoff(tx, a, id, practical!.id))

    const mine = await as(HARBOR.sam, (tx, a) => myTraining(tx, a))
    const card = mine.overview.active.find((c) => c.id === id)!
    expect(card.progress).toMatchObject({
      state: 'awaiting_signoff',
      completed: 3,
      total: 4,
      percent: 75,
      next: null,
    })

    const progress = await rawAsApp(
      harborId,
      'select id from training_lesson_progress where assignment_id = $1 and lesson_id = $2',
      [id, practical!.id],
    )
    const progressId = progress.rows[0].id as string

    // Out of scope, lacking the capability, or incomplete: refused.
    await expect(
      as(HARBOR.downtown, (tx, a) =>
        decideSignoff(tx, a, progressId, { decision: 'verified', note: '', criteriaConfirmed: [] }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      as(HARBOR.hr, (tx, a) =>
        decideSignoff(tx, a, progressId, { decision: 'verified', note: '', criteriaConfirmed: [] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      as(HARBOR.riverside, (tx, a) =>
        decideSignoff(tx, a, progressId, { decision: 'returned', note: '', criteriaConfirmed: [] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    const p = parseLessonContent('practical', practical!.content)
    if (p.kind !== 'practical') throw new Error('expected practical')
    expect(
      (await as(HARBOR.riverside, (tx, a) => signoffQueue(tx, a))).some(
        (r) => r.progressId === progressId,
      ),
    ).toBe(true)
    await as(HARBOR.riverside, (tx, a) =>
      decideSignoff(tx, a, progressId, {
        decision: 'returned',
        note: 'Squeegee toward the drain, not away.',
        criteriaConfirmed: [],
      }),
    )
    const returned = await as(HARBOR.sam, (tx, a) => myLesson(tx, a, id, practical!.id))
    expect(returned.lesson.state).toBe('returned')
    expect(returned.practical!.history[0]).toMatchObject({
      decision: 'returned',
      byName: 'Marcus Bell',
    })

    await as(HARBOR.sam, (tx, a) => requestSignoff(tx, a, id, practical!.id))
    await expect(
      as(HARBOR.riverside, (tx, a) =>
        decideSignoff(tx, a, progressId, {
          decision: 'verified',
          note: '',
          criteriaConfirmed: [p.criteria[0]!.id],
        }),
      ),
    ).rejects.toThrow(/Confirm every point/)
    const verified = await as(HARBOR.riverside, (tx, a) =>
      decideSignoff(tx, a, progressId, {
        decision: 'verified',
        note: '',
        criteriaConfirmed: p.criteria.map((c) => c.id),
      }),
    )
    expect(verified).toEqual({
      decision: 'verified',
      courseComplete: true,
      personName: 'Sam Whitfield',
    })

    const done = await as(HARBOR.sam, (tx, a) => myAssignment(tx, a, id))
    expect(done.status).toBe('completed')
    expect(done.completion).toMatchObject({
      lessons: 4,
      quizzes: [{ scorePercent: 100, attempts: 1 }],
      signedOff: [{ byName: 'Marcus Bell' }],
    })

    // The manager sees the result.
    const report = await as(HARBOR.riverside, (tx, a) => scopedAssignments(tx, a, { courseId }))
    expect(report.find((r) => r.assignmentId === id)).toMatchObject({
      status: { label: 'Completed' },
      percent: 100,
      bestScore: 100,
    })

    const audit = await rawAsApp(
      harborId,
      `select action from audit_events where subject_id = $1 order by created_at`,
      [id],
    )
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual(
      expect.arrayContaining([
        'training.assigned',
        'training_signoff.requested',
        'training_signoff.returned',
        'training_signoff.verified',
        'training.completed',
      ]),
    )
    const notices = await rawAsApp(
      harborId,
      `select subject_type, channel from notifications where employment_id = $1 and subject_id in (select id from training_signoffs where assignment_id = $2)`,
      [person(harborId, HARBOR.sam), id],
    )
    expect(notices.rows).toHaveLength(4) // two decisions, in-app and email each

    // Marcus assigned himself too; he cannot sign off his own practical.
    const his = await assignmentId(courseId, HARBOR.riverside)
    await as(HARBOR.riverside, (tx, a) => completeReading(tx, a, his, reading!.id))
    await as(HARBOR.riverside, (tx, a) => requestSignoff(tx, a, his, practical!.id))
    const own = await rawAsApp(
      harborId,
      'select id from training_lesson_progress where assignment_id = $1 and lesson_id = $2',
      [his, practical!.id],
    )
    expect(
      (await as(HARBOR.riverside, (tx, a) => signoffQueue(tx, a))).some(
        (r) => r.progressId === own.rows[0].id,
      ),
    ).toBe(false)
    await expect(
      as(HARBOR.riverside, (tx, a) =>
        decideSignoff(tx, a, own.rows[0].id, {
          decision: 'verified',
          note: '',
          criteriaConfirmed: p.criteria.map((c) => c.id),
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      rawAsApp(
        harborId,
        `insert into training_signoffs (id, organization_id, progress_id, assignment_id, lesson_id, employment_id, decision, decided_by_employment_id)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 'verified', $5)`,
        [harborId, own.rows[0].id, his, practical!.id, person(harborId, HARBOR.riverside)],
      ),
    ).rejects.toThrow(/training_signoffs_not_self_check/)
  })

  it('withdraws open training, keeps the record, and refuses to withdraw it twice', async () => {
    const { courseId, lessons } = await publishedCourse()
    await assign(courseId, [HARBOR.ava])
    const id = await assignmentId(courseId, HARBOR.ava)
    await as(HARBOR.ava, (tx, a) => completeReading(tx, a, id, lessons[0]!.id))
    await expect(
      as(HARBOR.riverside, (tx, a) => withdrawAssignment(tx, a, id, '')),
    ).rejects.toBeInstanceOf(ValidationError)
    await as(HARBOR.riverside, (tx, a) => withdrawAssignment(tx, a, id, 'Moved to the kitchen.'))
    await expect(
      as(HARBOR.riverside, (tx, a) => withdrawAssignment(tx, a, id, 'Again.')),
    ).rejects.toThrow(/already been withdrawn/)
    await expect(
      as(HARBOR.ava, (tx, a) => completeReading(tx, a, id, lessons[1]!.id)),
    ).rejects.toThrow(/withdrawn/)
    const kept = await rawAsApp(
      harborId,
      'select count(*)::int as n from training_lesson_progress where assignment_id = $1',
      [id],
    )
    expect(kept.rows[0].n).toBe(1)
    const mine = await as(HARBOR.ava, (tx, a) => myTraining(tx, a))
    expect(mine.overview.active.some((c) => c.id === id)).toBe(false)
  })
})

// --- reporting ----------------------------------------------------------------

describe('reporting scope', () => {
  it('shows each manager the people at their locations, and nobody else', async () => {
    const riverside = await as(HARBOR.riverside, (tx, a) => scopedAssignments(tx, a, {}))
    const downtown = await as(HARBOR.downtown, (tx, a) => scopedAssignments(tx, a, {}))
    const everyone = await as(HARBOR.hr, (tx, a) => scopedAssignments(tx, a, {}))
    expect(riverside.length).toBeGreaterThan(0)
    expect(downtown.length).toBeGreaterThan(0)
    expect(riverside.every((r) => r.locationNames.includes('Riverside'))).toBe(true)
    expect(downtown.every((r) => r.locationNames.includes('Downtown'))).toBe(true)
    expect(everyone.length).toBeGreaterThanOrEqual(riverside.length + downtown.length)

    await expect(
      as(HARBOR.riverside, (tx, a) => scopedAssignments(tx, a, { locationId: place('Downtown') })),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(as(HARBOR.sam, (tx, a) => scopedAssignments(tx, a, {}))).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      as(HARBOR.scheduler, (tx, a) => scopedAssignments(tx, a, {})),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps salon locations apart the same way', async () => {
    const pearl = await as('kofi@lumensalon.test', (tx, a) => scopedAssignments(tx, a, {}), lumenId)
    const educator = await as(
      'yuki@lumensalon.test',
      (tx, a) => scopedAssignments(tx, a, {}),
      lumenId,
    )
    expect(pearl.some((r) => r.personName === 'Ruben Castillo')).toBe(false)
    expect(educator.some((r) => r.personName === 'Ruben Castillo')).toBe(true)
    // The Pearl District queue has Priyanka's consultation; Boise Bench's manager cannot sign it.
    const queue = await as('kofi@lumensalon.test', (tx, a) => signoffQueue(tx, a), lumenId)
    const request = queue.find((r) => r.personName === 'Priyanka Shah')!
    expect(request.lessonTitle).toBe('Consultation observed by an educator')
    await expect(
      as(
        'sierra@lumensalon.test',
        (tx, a) =>
          decideSignoff(tx, a, request.progressId, {
            decision: 'returned',
            note: 'x',
            criteriaConfirmed: [],
          }),
        lumenId,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

// --- records ------------------------------------------------------------------

describe('training records are kept', () => {
  it('cannot be deleted or rewritten by the application role', async () => {
    await expect(rawAsApp(harborId, 'delete from training_assignments')).rejects.toThrow(
      /permission denied/,
    )
    await expect(rawAsApp(harborId, 'delete from training_lesson_progress')).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      rawAsApp(harborId, 'update training_quiz_attempts set passed = true'),
    ).rejects.toThrow(/permission denied/)
    await expect(rawAsApp(harborId, 'delete from training_signoffs')).rejects.toThrow(
      /permission denied/,
    )
    await expect(rawAsApp(harborId, 'delete from courses')).rejects.toThrow(/permission denied/)
  })

  it('is invisible across tenants', async () => {
    const seen = await rawAsApp(
      lumenId,
      'select count(*)::int as n from training_assignments where organization_id = $1',
      [harborId],
    )
    expect(seen.rows[0].n).toBe(0)
    const none = await rawAsApp(null, 'select count(*)::int as n from courses')
    expect(none.rows[0].n).toBe(0)
  })
})
