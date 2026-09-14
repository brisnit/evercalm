import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can } from '@/server/authz/can'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { canUseTrainingAdmin } from '@/modules/training/access'
import { getDraftLesson } from '@/modules/training/authoring'
import { LESSON_KIND_LABELS, itemsToLines, lessonProblems } from '@/modules/training/content'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { Breadcrumb } from '../../../../_components/course-tabs'
import { LessonEditor } from './lesson-editor'

export const metadata: Metadata = { title: 'Edit lesson' }
export const dynamic = 'force-dynamic'

export default async function LessonEditorPage({
  params,
}: {
  params: Promise<{ courseId: string; lessonId: string }>
}) {
  const { courseId, lessonId } = await params
  if (!isUuid(courseId) || !isUuid(lessonId)) notFound()
  const { actor } = await requireActorContext()
  if (!can(actor, 'training.author')) {
    if (!canUseTrainingAdmin(actor)) notFound()
    return <PermissionDenied capabilityLabel="Author training" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await getDraftLesson(tx, actor, courseId, lessonId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()
  const { course, lesson, index } = data
  const content = lesson.content

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        href={`/app/training/courses/${courseId}`}
        label={course.draft?.title ?? course.title}
      />
      <PageHeader
        eyebrow={`Draft of version ${course.draft!.versionNumber} · Lesson ${index + 1} of ${course.draft!.lessons.length}`}
        title={lesson.title}
        description={LESSON_KIND_LABELS[lesson.kind]}
      />
      <LessonEditor
        courseId={courseId}
        problems={lessonProblems(lesson)}
        lesson={{
          id: lesson.id,
          title: lesson.title,
          kind: lesson.kind,
          body: lesson.body,
          estimatedMinutes: lesson.estimatedMinutes,
          itemsText:
            content.kind === 'checklist'
              ? itemsToLines(content.items)
              : content.kind === 'practical'
                ? itemsToLines(content.criteria)
                : '',
          passPercent: content.kind === 'quiz' ? content.passPercent : 80,
          maxAttempts: content.kind === 'quiz' ? (content.maxAttempts ?? 0) : 0,
          questions: content.kind === 'quiz' ? content.questions : [],
        }}
      />
    </div>
  )
}
