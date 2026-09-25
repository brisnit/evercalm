import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { canSeeDrafts, canUseTrainingAdmin } from '@/modules/training/access'
import { listCourses, type CourseSummary } from '@/modules/training/authoring'
import { signoffQueue, trainingOverview, type StatusCounts } from '@/modules/training/assignments'
import { formatMinutes } from '@/modules/training/progress'
import { Badge, Card, EmptyState, PageHeader, ProgressBar } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { StatTile } from '@/ui/patterns/stat-tile'
import { LINK_BUTTON_CLASS, SECONDARY_LINK_CLASS } from './_components/styles'

export const metadata: Metadata = { title: 'Training' }
export const dynamic = 'force-dynamic'

/**
 * Training, from the manager's side: the courses, and how the people you look
 * after are doing with them. Figures here are scoped to the locations the
 * viewer is responsible for, and each one links to where you would act on it.
 */
export default async function TrainingPage() {
  const { actor } = await requireActorContext()
  if (!canUseTrainingAdmin(actor)) {
    return <PermissionDenied capabilityLabel="Assign training" />
  }
  const drafts = canSeeDrafts(actor)

  const data = await withTenant(actor.organizationId, async (tx) => ({
    courses: await listCourses(tx, actor, { includeArchived: drafts }),
    overview: await trainingOverview(tx, actor),
    signoffs: canAtAnyLocation(actor, 'skill.verify')
      ? (await signoffQueue(tx, actor)).length
      : null,
  }))

  const active = data.courses.filter((c) => c.status === 'active')
  const archived = data.courses.filter((c) => c.status === 'archived')
  const counts = new Map((data.overview?.courses ?? []).map((c) => [c.courseId, c.counts]))
  const o = data.overview?.counts

  return (
    <>
      <PageHeader
        title="Courses"
        description="Build training once, publish it, and assign it to the people who need it. Everyone keeps the version they were given."
        action={
          can(actor, 'training.author') ? (
            <div className="flex flex-wrap gap-2.5">
              <Link href="/app/training/library" className={SECONDARY_LINK_CLASS}>
                Course library
              </Link>
              <Link href="/app/training/courses/new" className={LINK_BUTTON_CLASS}>
                New course
              </Link>
            </div>
          ) : null
        }
      />

      {o ? (
        <section
          aria-label="Training at a glance"
          className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <StatTile
            label="Not finished"
            value={o.total - o.completed}
            detail="assigned and still open"
            href="/app/training/progress?status=open"
          />
          <StatTile
            label="Overdue"
            value={o.overdue}
            detail="past their due date"
            href="/app/training/progress?status=overdue"
            tone={o.overdue > 0 ? 'urgent' : 'neutral'}
          />
          <StatTile
            label="Sign-offs"
            value={data.signoffs ?? o.awaitingSignoff}
            detail="practicals waiting for a manager"
            href={
              data.signoffs !== null
                ? '/app/training/sign-offs'
                : '/app/training/progress?status=awaiting_signoff'
            }
            tone={(data.signoffs ?? o.awaitingSignoff) > 0 ? 'attention' : 'neutral'}
          />
          <StatTile
            label="Completed"
            value={o.completedLast30Days}
            detail="in the last 30 days"
            href="/app/training/progress?status=completed"
            tone={o.completedLast30Days > 0 ? 'good' : 'neutral'}
          />
        </section>
      ) : null}

      {active.length === 0 ? (
        <EmptyState
          title="No courses yet"
          description={
            drafts
              ? 'Create a course, add its lessons, and publish it when it is ready.'
              : 'When a course is published, you can assign it from here.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {active.map((course) => (
            <li key={course.id}>
              <CourseRow course={course} counts={counts.get(course.id)} showDrafts={drafts} />
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <section aria-labelledby="archived-heading" className="mt-10">
          <h2
            id="archived-heading"
            className="font-display text-muted text-sm font-bold tracking-[0.06em] uppercase"
          >
            Archived
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {archived.map((course) => (
              <li key={course.id}>
                <CourseRow course={course} counts={counts.get(course.id)} showDrafts={drafts} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function CourseRow({
  course,
  counts,
  showDrafts,
}: {
  course: CourseSummary
  counts: StatusCounts | undefined
  showDrafts: boolean
}) {
  return (
    <Card className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-5">
      <div className="min-w-0 flex-1 basis-72">
        <h3 className="font-display text-ink text-base font-bold">
          <Link
            href={`/app/training/courses/${course.id}`}
            className="underline-offset-4 hover:underline"
          >
            {course.title}
          </Link>
        </h3>
        {course.summary ? (
          <p className="text-muted mt-1 line-clamp-2 text-sm">{course.summary}</p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {course.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
          {course.publishedVersionNumber !== null ? (
            <Badge tone="success">Published · version {course.publishedVersionNumber}</Badge>
          ) : (
            <Badge tone="neutral">Not published</Badge>
          )}
          {showDrafts &&
          course.draftVersionNumber !== null &&
          course.publishedVersionNumber !== null ? (
            <Badge tone="accent">Draft of version {course.draftVersionNumber}</Badge>
          ) : null}
          <span className="text-muted text-xs">
            {course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'} · about{' '}
            {formatMinutes(course.totalMinutes)}
          </span>
        </div>
      </div>

      {counts && counts.total > 0 ? (
        <div className="flex w-full flex-col gap-2 sm:w-56">
          <ProgressBar
            value={(counts.completed / counts.total) * 100}
            label={`${counts.completed} of ${counts.total} completed`}
            tone="success"
          />
          {counts.overdue > 0 ? (
            <span>
              <Badge tone="danger">{counts.overdue} overdue</Badge>
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
