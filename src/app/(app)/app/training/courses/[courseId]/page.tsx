import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can } from '@/server/authz/can'
import { formatDateInZone } from '@/lib/dates'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { canSeeDrafts, canUseTrainingAdmin } from '@/modules/training/access'
import { getCourse, type LessonDetail } from '@/modules/training/authoring'
import { LESSON_KIND_LABELS, lessonProblems, versionProblems } from '@/modules/training/content'
import { organizationTimeZone } from '@/modules/training/records'
import { Badge, PageHeader } from '@/ui/primitives'
import { Breadcrumb, CourseTabs } from '../../_components/course-tabs'
import { describeLesson } from '../../_components/describe'
import { CourseWorkspace, type LessonRow } from './course-workspace'

export const metadata: Metadata = { title: 'Course' }
export const dynamic = 'force-dynamic'

/**
 * One course: its content, publication, and version history.
 *
 * Content is edited only as a draft. When a course is live and has no draft,
 * the only way to change it is "Start a new draft", which says in words that
 * nothing changes for anyone until it is published.
 */
export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  if (!isUuid(courseId)) notFound()
  const { actor } = await requireActorContext()
  if (!canUseTrainingAdmin(actor)) notFound()

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return {
        course: await getCourse(tx, actor, courseId),
        timeZone: await organizationTimeZone(tx, actor.organizationId),
      }
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()
  const { course, timeZone } = data

  const rows = (lessons: LessonDetail[]): LessonRow[] =>
    lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      kindLabel: LESSON_KIND_LABELS[lesson.kind],
      minutes: lesson.estimatedMinutes,
      detail: describeLesson(lesson.content),
      problems: lessonProblems(lesson),
    }))

  const canAuthor = can(actor, 'training.author')
  const title = canAuthor && course.draft ? course.draft.title : course.title
  const summary = (canAuthor && course.draft ? course.draft : course.published)?.summary

  return (
    <>
      <Breadcrumb href="/app/training" label="Courses" />
      <PageHeader
        eyebrow="Training · Course"
        title={title}
        description={summary || undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {course.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
            {course.published ? (
              <Badge tone="success">Published · version {course.published.versionNumber}</Badge>
            ) : (
              <Badge tone="neutral">Not published</Badge>
            )}
          </div>
        }
      />
      <CourseTabs courseId={course.id} current="content" showPeople={course.published !== null} />
      <CourseWorkspace
        courseId={course.id}
        archived={course.status === 'archived'}
        canAuthor={canAuthor}
        canPublish={can(actor, 'training.publish')}
        showCounts={canSeeDrafts(actor)}
        published={
          course.published
            ? {
                versionNumber: course.published.versionNumber,
                publishedLabel: `Published ${formatDateInZone(course.published.publishedAt!, timeZone)}${
                  course.published.publishedByName ? ` by ${course.published.publishedByName}` : ''
                }`,
                totalMinutes: course.published.totalMinutes,
                lessons: rows(course.published.lessons),
              }
            : null
        }
        draft={
          course.draft
            ? {
                id: course.draft.id,
                versionNumber: course.draft.versionNumber,
                title: course.draft.title,
                summary: course.draft.summary,
                totalMinutes: course.draft.totalMinutes,
                lessons: rows(course.draft.lessons),
                problems: versionProblems(course.draft.lessons),
              }
            : null
        }
        history={course.history.map((entry) => ({
          id: entry.id,
          versionNumber: entry.versionNumber,
          status: entry.status,
          isCurrent: entry.id === course.published?.id,
          publishedLabel: entry.publishedAt
            ? `${formatDateInZone(entry.publishedAt, timeZone)}${entry.publishedByName ? ` · ${entry.publishedByName}` : ''}`
            : null,
          changeNote: entry.changeNote,
          lessonCount: entry.lessonCount,
          openAssignments: entry.openAssignments,
          completedAssignments: entry.completedAssignments,
        }))}
      />
    </>
  )
}
