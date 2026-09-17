import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { canUseTrainingAdmin } from '@/modules/training/access'
import { getCourse, getVersionForPreview } from '@/modules/training/authoring'
import { LESSON_KIND_LABELS, QUESTION_KIND_LABELS, neededToPass } from '@/modules/training/content'
import { formatMinutes } from '@/modules/training/progress'
import { AnnouncementBody } from '@/ui/patterns/announcement-body'
import { Badge, Card, PageHeader } from '@/ui/primitives'
import { Breadcrumb, CourseTabs } from '../../../_components/course-tabs'

export const metadata: Metadata = { title: 'Preview' }
export const dynamic = 'force-dynamic'

/**
 * The employee's view of a version, built from the same lessons an assignment
 * would pin - so what a manager checks here is what people get, not a mock-up.
 * Correct answers are marked for the manager; employees never see them before
 * they pass.
 */
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const { courseId } = await params
  const requested = Number((await searchParams).version)
  if (!isUuid(courseId)) notFound()
  const { actor } = await requireActorContext()
  if (!canUseTrainingAdmin(actor)) notFound()

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      const course = await getCourse(tx, actor, courseId)
      const preview = await getVersionForPreview(
        tx,
        actor,
        courseId,
        Number.isInteger(requested) && requested > 0 ? requested : null,
      )
      return { course, preview }
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()
  const { course, preview } = data
  const version = preview.version
  const kind =
    version.status === 'draft' ? 'Draft' : preview.isCurrent ? 'Current version' : 'Earlier version'

  return (
    <>
      <Breadcrumb href="/app/training" label="Courses" />
      <PageHeader
        eyebrow="Training · Preview"
        title={version.title}
        description={`Version ${version.versionNumber} · ${kind} · ${version.lessons.length} ${version.lessons.length === 1 ? 'lesson' : 'lessons'}, about ${formatMinutes(version.totalMinutes)}`}
      />
      <CourseTabs courseId={courseId} current="preview" showPeople={course.published !== null} />

      <div className="mx-auto flex max-w-xl flex-col gap-4">
        {course.history.length > 1 ? (
          <nav aria-label="Versions" className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Versions:</span>
            {course.history.map((entry) => (
              <Link
                key={entry.id}
                href={`/app/training/courses/${courseId}/preview?version=${entry.versionNumber}`}
                aria-current={entry.versionNumber === version.versionNumber ? 'page' : undefined}
                className={
                  entry.versionNumber === version.versionNumber
                    ? 'rounded-full bg-teal-600 px-3 py-1 font-medium text-white'
                    : 'border-line-strong text-ink hover:bg-sunk rounded-full border bg-white px-3 py-1'
                }
              >
                {entry.versionNumber}
                {entry.status === 'draft' ? ' (draft)' : ''}
              </Link>
            ))}
          </nav>
        ) : null}

        <p className="rounded-card text-ink border border-teal-200 bg-teal-50 px-4 py-3 text-sm">
          This is what employees see, lesson by lesson. Nothing here is saved. Correct answers are
          marked for you; employees see them only after they pass.
        </p>

        {version.summary ? <p className="text-muted">{version.summary}</p> : null}

        {version.lessons.map((lesson, index) => (
          <Card key={lesson.id} as="article" className="p-5">
            <p className="text-muted text-xs font-medium">
              Lesson {index + 1} of {version.lessons.length} · {LESSON_KIND_LABELS[lesson.kind]} ·{' '}
              {lesson.estimatedMinutes} min
            </p>
            <h2 className="font-display text-ink mt-1 text-lg font-bold">{lesson.title}</h2>
            {lesson.body ? (
              <div className="mt-3">
                <AnnouncementBody body={lesson.body} />
              </div>
            ) : null}

            {lesson.content.kind === 'checklist' ? (
              <ul className="mt-4 flex flex-col gap-2">
                {lesson.content.items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-control border-line text-ink flex items-start gap-3 border bg-white px-3.5 py-3 text-sm"
                  >
                    <span
                      aria-hidden="true"
                      className="border-line-strong mt-0.5 size-4 shrink-0 rounded border"
                    />
                    {item.text}
                  </li>
                ))}
              </ul>
            ) : null}

            {lesson.content.kind === 'practical' ? (
              <div className="mt-4">
                <h3 className="text-ink text-sm font-semibold">What the manager looks for</h3>
                <ul className="text-ink mt-2 list-disc pl-5 text-sm">
                  {lesson.content.criteria.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {lesson.content.kind === 'quiz' ? (
              <div className="mt-4">
                <p className="text-muted text-sm">
                  A pass needs{' '}
                  {neededToPass(lesson.content.passPercent, lesson.content.questions.length)} of{' '}
                  {lesson.content.questions.length} correct.{' '}
                  {lesson.content.maxAttempts
                    ? `${lesson.content.maxAttempts} attempts allowed.`
                    : 'As many attempts as they need.'}
                </p>
                <ol className="mt-3 flex flex-col gap-4">
                  {lesson.content.questions.map((q, i) => (
                    <li key={q.id}>
                      <p className="text-ink text-sm font-medium">
                        {i + 1}. {q.prompt}
                      </p>
                      <p className="text-muted text-xs">{QUESTION_KIND_LABELS[q.kind]}</p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {q.options.map((o) => (
                          <li
                            key={o.id}
                            className="rounded-control border-line text-ink flex flex-wrap items-center justify-between gap-2 border bg-white px-3 py-2 text-sm"
                          >
                            {o.text}
                            {q.correctOptionIds.includes(o.id) ? (
                              <Badge tone="success">Correct</Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {q.explanation ? (
                        <p className="text-muted mt-1.5 text-xs">{q.explanation}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  )
}
