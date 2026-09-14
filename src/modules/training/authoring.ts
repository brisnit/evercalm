import { and, asc, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employments } from '@/server/db/schema'
import type { Actor, Capability } from '@/server/authz'
import { can } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { normalizeBody, normalizeTitle } from '@/modules/comms/content'
import { canSeeDrafts, canUseTrainingAdmin, pgErrorCode, UNIQUE_VIOLATION } from './access'
import {
  LIMITS,
  buildQuestion,
  emptyContent,
  isLessonKind,
  linesToItems,
  parseLessonContent,
  serializeContent,
  versionProblems,
  type LessonContent,
  type LessonKind,
  type QuestionInput,
} from './content'
import { courseLessons, courseVersions, courses, trainingAssignments } from './schema'

/*
 * AUTHORING: courses, drafts, lessons, publication.
 *
 * The rule everything here enforces: ONCE A VERSION IS PUBLISHED, ITS CONTENT
 * NEVER CHANGES. Editing a live course means starting a new draft, which
 * copies the published lessons; publishing that draft makes it what NEW
 * assignments receive. Nobody already assigned is moved - a manager can move
 * people who have not started, deliberately, from the course's People page.
 *
 * Every content change goes through `requireDraft()`, which locks the version
 * row and refuses anything that is not a draft. The database triggers in
 * migration 0016 refuse the same thing again, in case a future code path
 * forgets.
 *
 * Draft edits are not individually audited - a draft affects nobody. Creating
 * a course, publishing, starting or discarding a draft, archiving and
 * restoring are.
 */

export interface LessonDetail {
  id: string
  position: number
  title: string
  kind: LessonKind
  body: string
  estimatedMinutes: number
  content: LessonContent
}

export interface VersionDetail {
  id: string
  versionNumber: number
  status: 'draft' | 'published'
  title: string
  summary: string
  changeNote: string
  publishedAt: Date | null
  publishedByName: string | null
  lessons: LessonDetail[]
  totalMinutes: number
}

export interface VersionHistoryEntry {
  id: string
  versionNumber: number
  status: 'draft' | 'published'
  publishedAt: Date | null
  publishedByName: string | null
  changeNote: string
  lessonCount: number
  /** Organization-wide counts; shown only to people who manage content. */
  openAssignments: number
  completedAssignments: number
}

export interface CourseDetail {
  id: string
  title: string
  status: 'active' | 'archived'
  published: VersionDetail | null
  draft: VersionDetail | null
  history: VersionHistoryEntry[]
}

export interface CourseSummary {
  id: string
  title: string
  summary: string
  status: 'active' | 'archived'
  publishedVersionId: string | null
  publishedVersionNumber: number | null
  draftVersionNumber: number | null
  lessonCount: number
  totalMinutes: number
  updatedAt: Date
}

const MAX_LESSONS = 40

function contentCapability(actor: Actor, capability: Capability): void {
  if (can(actor, capability)) return
  // Somebody in training administration is told what they lack; anybody else
  // learns nothing about what exists.
  if (canUseTrainingAdmin(actor)) throw new ForbiddenError(capability)
  throw new NotFoundError('Course not found')
}

function titleFrom(raw: string, field = 'title'): string {
  const title = normalizeTitle(raw).slice(0, LIMITS.title)
  if (!title) throw new ValidationError({ [field]: ['Give it a title.'] })
  return title
}

function minutesFrom(raw: number): number {
  if (!Number.isInteger(raw) || raw < 1 || raw > LIMITS.minutes) {
    throw new ValidationError({
      estimatedMinutes: [`Enter a whole number of minutes from 1 to ${LIMITS.minutes}.`],
    })
  }
  return raw
}

async function names(
  tx: Tx,
  organizationId: string,
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((id): id is string => !!id))]
  if (clean.length === 0) return new Map()
  const rows = await tx
    .select({ id: employments.id, name: employments.displayName })
    .from(employments)
    .where(and(eq(employments.organizationId, organizationId), inArray(employments.id, clean)))
  return new Map(rows.map((r) => [r.id, r.name]))
}

export async function loadLessons(
  tx: Tx,
  organizationId: string,
  versionId: string,
): Promise<LessonDetail[]> {
  const rows = await tx
    .select()
    .from(courseLessons)
    .where(
      and(eq(courseLessons.organizationId, organizationId), eq(courseLessons.versionId, versionId)),
    )
    .orderBy(asc(courseLessons.position), asc(courseLessons.createdAt))
  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    title: row.title,
    kind: isLessonKind(row.kind) ? row.kind : 'reading',
    body: row.body,
    estimatedMinutes: row.estimatedMinutes,
    content: parseLessonContent(row.kind, row.content),
  }))
}

async function versionDetail(
  tx: Tx,
  organizationId: string,
  version: typeof courseVersions.$inferSelect,
): Promise<VersionDetail> {
  const lessons = await loadLessons(tx, organizationId, version.id)
  const publisher = await names(tx, organizationId, [version.publishedByEmploymentId])
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status as 'draft' | 'published',
    title: version.title,
    summary: version.summary,
    changeNote: version.changeNote,
    publishedAt: version.publishedAt,
    publishedByName: version.publishedByEmploymentId
      ? (publisher.get(version.publishedByEmploymentId) ?? null)
      : null,
    lessons,
    totalMinutes: lessons.reduce((sum, l) => sum + l.estimatedMinutes, 0),
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listCourses(
  tx: Tx,
  actor: Actor,
  options: { includeArchived?: boolean } = {},
): Promise<CourseSummary[]> {
  if (!canUseTrainingAdmin(actor)) throw new ForbiddenError('training.assign')
  const drafts = canSeeDrafts(actor)

  const courseRows = await tx
    .select()
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, actor.organizationId),
        options.includeArchived ? undefined : eq(courses.status, 'active'),
      ),
    )
    .orderBy(asc(courses.title))
  if (courseRows.length === 0) return []

  const versions = await tx
    .select({
      id: courseVersions.id,
      courseId: courseVersions.courseId,
      versionNumber: courseVersions.versionNumber,
      status: courseVersions.status,
      title: courseVersions.title,
      summary: courseVersions.summary,
    })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        inArray(
          courseVersions.courseId,
          courseRows.map((c) => c.id),
        ),
      ),
    )

  const relevant = versions.filter(
    (v) => v.status === 'draft' || courseRows.some((c) => c.publishedVersionId === v.id),
  )
  const totals = await lessonTotals(
    tx,
    actor.organizationId,
    relevant.map((v) => v.id),
  )

  const out: CourseSummary[] = []
  for (const course of courseRows) {
    const published = versions.find((v) => v.id === course.publishedVersionId) ?? null
    const draft = versions.find((v) => v.courseId === course.id && v.status === 'draft') ?? null
    if (!published && !drafts) continue
    const shown = published ?? draft
    const total = shown ? totals.get(shown.id) : undefined
    out.push({
      id: course.id,
      title: published?.title ?? course.title,
      summary: shown?.summary ?? '',
      status: course.status as 'active' | 'archived',
      publishedVersionId: published?.id ?? null,
      publishedVersionNumber: published?.versionNumber ?? null,
      draftVersionNumber: drafts ? (draft?.versionNumber ?? null) : null,
      lessonCount: total?.count ?? 0,
      totalMinutes: total?.minutes ?? 0,
      updatedAt: course.updatedAt,
    })
  }
  return out
}

async function lessonTotals(
  tx: Tx,
  organizationId: string,
  versionIds: readonly string[],
): Promise<Map<string, { count: number; minutes: number }>> {
  if (versionIds.length === 0) return new Map()
  const rows = await tx
    .select({
      versionId: courseLessons.versionId,
      count: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${courseLessons.estimatedMinutes}), 0)::int`,
    })
    .from(courseLessons)
    .where(
      and(
        eq(courseLessons.organizationId, organizationId),
        inArray(courseLessons.versionId, [...versionIds]),
      ),
    )
    .groupBy(courseLessons.versionId)
  return new Map(rows.map((r) => [r.versionId, { count: r.count, minutes: r.minutes }]))
}

/**
 * A course as managers see it. People who do not manage content see only the
 * published version - a GM assigning the allergen course has no business in
 * next month's unfinished draft.
 */
export async function getCourse(tx: Tx, actor: Actor, courseId: string): Promise<CourseDetail> {
  if (!canUseTrainingAdmin(actor)) throw new NotFoundError('Course not found')
  const drafts = canSeeDrafts(actor)

  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, actor.organizationId), eq(courses.id, courseId)))
    .limit(1)
  if (!course) throw new NotFoundError('Course not found')
  if (!course.publishedVersionId && !drafts) throw new NotFoundError('Course not found')

  const versions = await tx
    .select()
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        eq(courseVersions.courseId, courseId),
      ),
    )
    .orderBy(desc(courseVersions.versionNumber))

  const publishedRow = versions.find((v) => v.id === course.publishedVersionId) ?? null
  const draftRow = drafts ? (versions.find((v) => v.status === 'draft') ?? null) : null

  const shownVersions = drafts ? versions : versions.filter((v) => v.status === 'published')
  const totals = await lessonTotals(
    tx,
    actor.organizationId,
    shownVersions.map((v) => v.id),
  )
  const counts = drafts
    ? await tx
        .select({
          versionId: trainingAssignments.courseVersionId,
          open: sql<number>`count(*) filter (where ${trainingAssignments.status} in ('assigned','in_progress'))::int`,
          completed: sql<number>`count(*) filter (where ${trainingAssignments.status} = 'completed')::int`,
        })
        .from(trainingAssignments)
        .where(
          and(
            eq(trainingAssignments.organizationId, actor.organizationId),
            eq(trainingAssignments.courseId, courseId),
          ),
        )
        .groupBy(trainingAssignments.courseVersionId)
    : []
  const publishers = await names(
    tx,
    actor.organizationId,
    shownVersions.map((v) => v.publishedByEmploymentId),
  )

  return {
    id: course.id,
    title: publishedRow?.title ?? course.title,
    status: course.status as 'active' | 'archived',
    published: publishedRow ? await versionDetail(tx, actor.organizationId, publishedRow) : null,
    draft: draftRow ? await versionDetail(tx, actor.organizationId, draftRow) : null,
    history: shownVersions.map((v) => {
      const count = counts.find((c) => c.versionId === v.id)
      return {
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status as 'draft' | 'published',
        publishedAt: v.publishedAt,
        publishedByName: v.publishedByEmploymentId
          ? (publishers.get(v.publishedByEmploymentId) ?? null)
          : null,
        changeNote: v.changeNote,
        lessonCount: totals.get(v.id)?.count ?? 0,
        openAssignments: count?.open ?? 0,
        completedAssignments: count?.completed ?? 0,
      }
    }),
  }
}

/** One version by number, for the preview. Drafts only for people who manage content. */
export async function getVersionForPreview(
  tx: Tx,
  actor: Actor,
  courseId: string,
  versionNumber: number | null,
): Promise<{ courseTitle: string; version: VersionDetail; isCurrent: boolean }> {
  const course = await getCourse(tx, actor, courseId)
  const target =
    versionNumber === null
      ? (course.draft ?? course.published)
      : course.draft?.versionNumber === versionNumber
        ? course.draft
        : course.published?.versionNumber === versionNumber
          ? course.published
          : null
  if (target) {
    return {
      courseTitle: course.title,
      version: target,
      isCurrent: target.id === course.published?.id,
    }
  }

  // An older published version: history is readable, that is the point of it.
  const entry = course.history.find(
    (h) => h.versionNumber === versionNumber && h.status === 'published',
  )
  if (!entry) throw new NotFoundError('Version not found')
  const [row] = await tx
    .select()
    .from(courseVersions)
    .where(
      and(eq(courseVersions.organizationId, actor.organizationId), eq(courseVersions.id, entry.id)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Version not found')
  return {
    courseTitle: course.title,
    version: await versionDetail(tx, actor.organizationId, row),
    isCurrent: false,
  }
}

/** A lesson inside a draft, for its editor. */
export async function getDraftLesson(
  tx: Tx,
  actor: Actor,
  courseId: string,
  lessonId: string,
): Promise<{ course: CourseDetail; lesson: LessonDetail; index: number }> {
  contentCapability(actor, 'training.author')
  const course = await getCourse(tx, actor, courseId)
  const lessons = course.draft?.lessons ?? []
  const index = lessons.findIndex((l) => l.id === lessonId)
  if (index === -1) throw new NotFoundError('Lesson not found')
  return { course, lesson: lessons[index]!, index }
}

// ---------------------------------------------------------------------------
// Courses and drafts
// ---------------------------------------------------------------------------

export async function createCourse(
  tx: Tx,
  actor: Actor,
  input: { title: string; summary: string },
): Promise<string> {
  contentCapability(actor, 'training.author')
  const title = titleFrom(input.title)
  const summary = normalizeBody(input.summary).slice(0, 600)
  const courseId = newId()
  const versionId = newId()

  try {
    await tx.insert(courses).values({
      id: courseId,
      organizationId: actor.organizationId,
      title,
      createdByEmploymentId: actor.employmentId,
    })
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError({ title: ['There is already a course with this title.'] })
    }
    throw error
  }
  await tx.insert(courseVersions).values({
    id: versionId,
    organizationId: actor.organizationId,
    courseId,
    versionNumber: 1,
    title,
    summary,
    createdByEmploymentId: actor.employmentId,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_COURSE_CREATED,
    summary: `Created the course "${title}"`,
    subjectType: 'course',
    subjectId: courseId,
  })
  return courseId
}

interface DraftContext {
  version: typeof courseVersions.$inferSelect
  course: typeof courses.$inferSelect
}

/**
 * THE GATE for every content change. Locks the version, and refuses anything
 * that is not a draft of an active course.
 */
async function requireDraft(tx: Tx, actor: Actor, versionId: string): Promise<DraftContext> {
  contentCapability(actor, 'training.author')
  const [version] = await tx
    .select()
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        eq(courseVersions.id, versionId),
      ),
    )
    .for('update')
    .limit(1)
  if (!version) throw new NotFoundError('Version not found')
  if (version.status !== 'draft') {
    throw new ValidationError(
      {},
      `Version ${version.versionNumber} is published and cannot be changed. Start a new draft to make changes.`,
    )
  }
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, actor.organizationId), eq(courses.id, version.courseId)))
    .limit(1)
  if (!course) throw new NotFoundError('Course not found')
  if (course.status !== 'active') {
    throw new ValidationError({}, 'This course is archived. Restore it before changing it.')
  }
  return { version, course }
}

async function requireDraftLesson(
  tx: Tx,
  actor: Actor,
  lessonId: string,
): Promise<DraftContext & { lesson: typeof courseLessons.$inferSelect }> {
  contentCapability(actor, 'training.author')
  const [lesson] = await tx
    .select()
    .from(courseLessons)
    .where(
      and(eq(courseLessons.organizationId, actor.organizationId), eq(courseLessons.id, lessonId)),
    )
    .limit(1)
  if (!lesson) throw new NotFoundError('Lesson not found')
  const context = await requireDraft(tx, actor, lesson.versionId)
  return { ...context, lesson }
}

async function touch(tx: Tx, context: DraftContext): Promise<void> {
  const now = new Date()
  await tx
    .update(courseVersions)
    .set({ updatedAt: now })
    .where(eq(courseVersions.id, context.version.id))
  await tx.update(courses).set({ updatedAt: now }).where(eq(courses.id, context.course.id))
}

export async function updateDraftDetails(
  tx: Tx,
  actor: Actor,
  versionId: string,
  input: { title: string; summary: string },
): Promise<void> {
  const context = await requireDraft(tx, actor, versionId)
  const title = titleFrom(input.title)
  const summary = normalizeBody(input.summary).slice(0, 600)
  await tx
    .update(courseVersions)
    .set({ title, summary, updatedAt: new Date() })
    .where(eq(courseVersions.id, versionId))
  try {
    await tx
      .update(courses)
      .set({ title, updatedAt: new Date() })
      .where(eq(courses.id, context.course.id))
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError({ title: ['There is already a course with this title.'] })
    }
    throw error
  }
}

export async function addLesson(
  tx: Tx,
  actor: Actor,
  versionId: string,
  input: { title: string; kind: string; estimatedMinutes: number },
): Promise<string> {
  const context = await requireDraft(tx, actor, versionId)
  const title = titleFrom(input.title)
  if (!isLessonKind(input.kind)) {
    throw new ValidationError({ kind: ['Choose what kind of lesson this is.'] })
  }
  const minutes = minutesFrom(input.estimatedMinutes)

  const [{ count, last } = { count: 0, last: -1 }] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      last: sql<number>`coalesce(max(${courseLessons.position}), -1)::int`,
    })
    .from(courseLessons)
    .where(
      and(
        eq(courseLessons.organizationId, actor.organizationId),
        eq(courseLessons.versionId, versionId),
      ),
    )
  if (count >= MAX_LESSONS) {
    throw new ValidationError({}, `A course can have up to ${MAX_LESSONS} lessons.`)
  }

  const id = newId()
  await tx.insert(courseLessons).values({
    id,
    organizationId: actor.organizationId,
    versionId,
    position: last + 1,
    title,
    kind: input.kind,
    estimatedMinutes: minutes,
    content: serializeContent(emptyContent(input.kind)),
  })
  await touch(tx, context)
  return id
}

export interface LessonUpdate {
  title: string
  estimatedMinutes: number
  body: string
  /** Checklist items or practical criteria, one per line. */
  itemsText?: string
  passPercent?: number
  /** 0 or null means unlimited. */
  maxAttempts?: number | null
}

export async function updateLesson(
  tx: Tx,
  actor: Actor,
  lessonId: string,
  input: LessonUpdate,
): Promise<void> {
  const context = await requireDraftLesson(tx, actor, lessonId)
  const lesson = context.lesson
  const title = titleFrom(input.title)
  const minutes = minutesFrom(input.estimatedMinutes)
  const body = normalizeBody(input.body)
  const current = parseLessonContent(lesson.kind, lesson.content)

  let next: LessonContent = current
  if (current.kind === 'checklist') {
    next = { kind: 'checklist', items: linesToItems(input.itemsText ?? '', current.items) }
  } else if (current.kind === 'practical') {
    next = { kind: 'practical', criteria: linesToItems(input.itemsText ?? '', current.criteria) }
  } else if (current.kind === 'quiz') {
    const passPercent = input.passPercent ?? current.passPercent
    if (!Number.isInteger(passPercent) || passPercent < 1 || passPercent > 100) {
      throw new ValidationError({ passPercent: ['Enter a pass mark from 1 to 100 percent.'] })
    }
    const max = input.maxAttempts ?? null
    if (max !== null && max !== 0 && (!Number.isInteger(max) || max < 1 || max > 10)) {
      throw new ValidationError({
        maxAttempts: ['Allow from 1 to 10 attempts, or leave it unlimited.'],
      })
    }
    next = { ...current, passPercent, maxAttempts: max === 0 ? null : max }
  }

  await tx
    .update(courseLessons)
    .set({
      title,
      estimatedMinutes: minutes,
      body,
      content: serializeContent(next),
      updatedAt: new Date(),
    })
    .where(eq(courseLessons.id, lessonId))
  await touch(tx, context)
}

async function updateQuiz(
  tx: Tx,
  actor: Actor,
  lessonId: string,
  change: (
    content: Extract<LessonContent, { kind: 'quiz' }>,
  ) => Extract<LessonContent, { kind: 'quiz' }>,
): Promise<void> {
  const context = await requireDraftLesson(tx, actor, lessonId)
  const content = parseLessonContent(context.lesson.kind, context.lesson.content)
  if (content.kind !== 'quiz') throw new NotFoundError('Lesson not found')
  await tx
    .update(courseLessons)
    .set({ content: serializeContent(change(content)), updatedAt: new Date() })
    .where(eq(courseLessons.id, lessonId))
  await touch(tx, context)
}

/** Add a question, or replace one when `questionId` is given. */
export async function saveQuestion(
  tx: Tx,
  actor: Actor,
  lessonId: string,
  questionId: string | null,
  input: QuestionInput,
): Promise<void> {
  await updateQuiz(tx, actor, lessonId, (content) => {
    const existing = questionId ? content.questions.find((q) => q.id === questionId) : undefined
    if (questionId && !existing) throw new NotFoundError('Question not found')
    if (!existing && content.questions.length >= LIMITS.questions) {
      throw new ValidationError(
        {},
        `A knowledge check can have up to ${LIMITS.questions} questions.`,
      )
    }
    const result = buildQuestion(input, existing)
    if (!result.ok) throw new ValidationError(result.fieldErrors)
    return {
      ...content,
      questions: existing
        ? content.questions.map((q) => (q.id === existing.id ? result.question : q))
        : [...content.questions, result.question],
    }
  })
}

export async function removeQuestion(
  tx: Tx,
  actor: Actor,
  lessonId: string,
  questionId: string,
): Promise<void> {
  await updateQuiz(tx, actor, lessonId, (content) => {
    if (!content.questions.some((q) => q.id === questionId)) {
      throw new NotFoundError('Question not found')
    }
    return { ...content, questions: content.questions.filter((q) => q.id !== questionId) }
  })
}

export async function moveLesson(
  tx: Tx,
  actor: Actor,
  lessonId: string,
  direction: 'up' | 'down',
): Promise<void> {
  const context = await requireDraftLesson(tx, actor, lessonId)
  const lessons = await loadLessons(tx, actor.organizationId, context.version.id)
  const index = lessons.findIndex((l) => l.id === lessonId)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || target < 0 || target >= lessons.length) return
  const order = lessons.map((l) => l.id)
  ;[order[index], order[target]] = [order[target]!, order[index]!]
  await renumber(tx, actor.organizationId, order)
  await touch(tx, context)
}

export async function removeLesson(tx: Tx, actor: Actor, lessonId: string): Promise<void> {
  const context = await requireDraftLesson(tx, actor, lessonId)
  await tx.delete(courseLessons).where(eq(courseLessons.id, lessonId))
  const remaining = await loadLessons(tx, actor.organizationId, context.version.id)
  await renumber(
    tx,
    actor.organizationId,
    remaining.map((l) => l.id),
  )
  await touch(tx, context)
}

async function renumber(tx: Tx, organizationId: string, ids: readonly string[]): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await tx
      .update(courseLessons)
      .set({ position })
      .where(and(eq(courseLessons.organizationId, organizationId), eq(courseLessons.id, id)))
  }
}

export interface PublishResult {
  versionNumber: number
  /** People on an older version who have not started, and could be moved. */
  notStartedOnOlderVersions: number
}

/**
 * Publish a draft. New assignments get it from now on; nobody already
 * assigned changes version.
 */
export async function publishDraft(
  tx: Tx,
  actor: Actor,
  versionId: string,
  input: { changeNote: string },
  now = new Date(),
): Promise<PublishResult> {
  contentCapability(actor, 'training.publish')

  const [target] = await tx
    .select({ courseId: courseVersions.courseId })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        eq(courseVersions.id, versionId),
      ),
    )
    .limit(1)
  if (!target) throw new NotFoundError('Version not found')

  // Two people pressing Publish on the same course serialize here.
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, actor.organizationId), eq(courses.id, target.courseId)))
    .for('update')
    .limit(1)
  if (!course) throw new NotFoundError('Course not found')
  if (course.status !== 'active') {
    throw new ValidationError({}, 'This course is archived. Restore it before publishing.')
  }

  const [version] = await tx
    .select()
    .from(courseVersions)
    .where(eq(courseVersions.id, versionId))
    .for('update')
    .limit(1)
  if (!version || version.status !== 'draft') {
    throw new ValidationError({}, 'This version has already been published.')
  }

  const lessons = await loadLessons(tx, actor.organizationId, versionId)
  const problems = versionProblems(lessons)
  if (problems.length > 0) {
    throw new ValidationError({ publish: problems }, 'This draft is not ready to publish yet.')
  }

  const changeNote = normalizeBody(input.changeNote).slice(0, 600)
  if (course.publishedVersionId && !changeNote) {
    throw new ValidationError({
      changeNote: ['Say what changed, so managers can decide whether to move people to it.'],
    })
  }

  await tx
    .update(courseVersions)
    .set({
      status: 'published',
      changeNote,
      publishedAt: now,
      publishedByEmploymentId: actor.employmentId,
      updatedAt: now,
    })
    .where(eq(courseVersions.id, versionId))
  await tx
    .update(courses)
    .set({ publishedVersionId: versionId, title: version.title, updatedAt: now })
    .where(eq(courses.id, course.id))

  const [{ waiting } = { waiting: 0 }] = await tx
    .select({ waiting: sql<number>`count(*)::int` })
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, actor.organizationId),
        eq(trainingAssignments.courseId, course.id),
        eq(trainingAssignments.status, 'assigned'),
        lt(trainingAssignments.versionNumber, version.versionNumber),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_COURSE_PUBLISHED,
    summary: `Published version ${version.versionNumber} of "${version.title}"`,
    subjectType: 'course',
    subjectId: course.id,
    metadata: {
      versionId,
      versionNumber: version.versionNumber,
      lessons: lessons.length,
      previousVersionId: course.publishedVersionId,
    },
  })

  return { versionNumber: version.versionNumber, notStartedOnOlderVersions: waiting }
}

/**
 * Start editing a published course. Copies the published lessons into a new
 * draft; returns the existing draft if there already is one.
 */
export async function startNewDraft(tx: Tx, actor: Actor, courseId: string): Promise<string> {
  contentCapability(actor, 'training.author')
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, actor.organizationId), eq(courses.id, courseId)))
    .for('update')
    .limit(1)
  if (!course) throw new NotFoundError('Course not found')
  if (course.status !== 'active') {
    throw new ValidationError({}, 'This course is archived. Restore it before changing it.')
  }

  const [existing] = await tx
    .select({ id: courseVersions.id })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        eq(courseVersions.courseId, courseId),
        eq(courseVersions.status, 'draft'),
      ),
    )
    .limit(1)
  if (existing) return existing.id
  if (!course.publishedVersionId) throw new NotFoundError('Version not found')

  const [published] = await tx
    .select()
    .from(courseVersions)
    .where(eq(courseVersions.id, course.publishedVersionId))
    .limit(1)
  const [{ highest } = { highest: 0 }] = await tx
    .select({ highest: sql<number>`coalesce(max(${courseVersions.versionNumber}), 0)::int` })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        eq(courseVersions.courseId, courseId),
      ),
    )

  const draftId = newId()
  await tx.insert(courseVersions).values({
    id: draftId,
    organizationId: actor.organizationId,
    courseId,
    versionNumber: highest + 1,
    title: published!.title,
    summary: published!.summary,
    createdByEmploymentId: actor.employmentId,
  })

  const lessons = await tx
    .select()
    .from(courseLessons)
    .where(
      and(
        eq(courseLessons.organizationId, actor.organizationId),
        eq(courseLessons.versionId, published!.id),
      ),
    )
    .orderBy(asc(courseLessons.position))
  if (lessons.length > 0) {
    await tx.insert(courseLessons).values(
      lessons.map((lesson) => ({
        id: newId(),
        organizationId: actor.organizationId,
        versionId: draftId,
        position: lesson.position,
        title: lesson.title,
        kind: lesson.kind,
        body: lesson.body,
        estimatedMinutes: lesson.estimatedMinutes,
        content: lesson.content,
        sourceLessonId: lesson.id,
      })),
    )
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_DRAFT_STARTED,
    summary: `Started draft version ${highest + 1} of "${published!.title}"`,
    subjectType: 'course',
    subjectId: courseId,
    metadata: { versionId: draftId, fromVersionId: published!.id },
  })
  return draftId
}

/** Throw away a draft of a course that already has a published version. */
export async function discardDraft(tx: Tx, actor: Actor, versionId: string): Promise<void> {
  const context = await requireDraft(tx, actor, versionId)
  if (!context.course.publishedVersionId) {
    throw new ValidationError(
      {},
      'This course has never been published, so this draft is all of it. Archive the course instead.',
    )
  }
  await tx.delete(courseVersions).where(eq(courseVersions.id, versionId))
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_DRAFT_DISCARDED,
    summary: `Discarded draft version ${context.version.versionNumber} of "${context.version.title}"`,
    subjectType: 'course',
    subjectId: context.course.id,
  })
}

/**
 * Archive: no new assignments. People already assigned keep their training
 * and can finish it - withdrawing it from them is a separate, per-person
 * decision.
 */
export async function archiveCourse(
  tx: Tx,
  actor: Actor,
  courseId: string,
  now = new Date(),
): Promise<{ openAssignments: number }> {
  contentCapability(actor, 'training.publish')
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, actor.organizationId), eq(courses.id, courseId)))
    .for('update')
    .limit(1)
  if (!course) throw new NotFoundError('Course not found')
  if (course.status === 'archived') return { openAssignments: 0 }

  await tx
    .update(courses)
    .set({
      status: 'archived',
      archivedAt: now,
      archivedByEmploymentId: actor.employmentId,
      updatedAt: now,
    })
    .where(eq(courses.id, courseId))
  const [{ open } = { open: 0 }] = await tx
    .select({ open: sql<number>`count(*)::int` })
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, actor.organizationId),
        eq(trainingAssignments.courseId, courseId),
        inArray(trainingAssignments.status, ['assigned', 'in_progress']),
      ),
    )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_COURSE_ARCHIVED,
    summary: `Archived the course "${course.title}"`,
    subjectType: 'course',
    subjectId: courseId,
    metadata: { openAssignments: open },
  })
  return { openAssignments: open }
}

export async function restoreCourse(tx: Tx, actor: Actor, courseId: string): Promise<void> {
  contentCapability(actor, 'training.publish')
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, actor.organizationId), eq(courses.id, courseId)))
    .for('update')
    .limit(1)
  if (!course) throw new NotFoundError('Course not found')
  if (course.status === 'active') return
  try {
    await tx
      .update(courses)
      .set({
        status: 'active',
        archivedAt: null,
        archivedByEmploymentId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(courses.id, courseId), ne(courses.status, 'active')))
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError(
        {},
        'Another active course already has this title. Rename or archive that one first.',
      )
    }
    throw error
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_COURSE_RESTORED,
    summary: `Restored the course "${course.title}"`,
    subjectType: 'course',
    subjectId: courseId,
  })
}
