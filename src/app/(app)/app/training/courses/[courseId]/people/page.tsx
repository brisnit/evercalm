import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { accessibleLocationIds, canAtAnyLocation } from '@/server/authz/can'
import { businessDate, formatCalendarDate, formatDateInZone } from '@/lib/dates'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import {
  canUseTrainingAdmin,
  canViewProgressAnywhere,
  locationsWhere,
} from '@/modules/training/access'
import { listAssignablePeople, scopedAssignments } from '@/modules/training/assignments'
import { getCourse } from '@/modules/training/authoring'
import { organizationTimeZone } from '@/modules/training/records'
import { PageHeader } from '@/ui/primitives'
import { Breadcrumb, CourseTabs } from '../../../_components/course-tabs'
import { PeopleWorkspace } from './people-workspace'

export const metadata: Metadata = { title: 'Course people' }
export const dynamic = 'force-dynamic'

/**
 * Who has this course, how they are doing, and assigning it to more people.
 * Everything is scoped to the locations the viewer looks after.
 */
export default async function CoursePeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>
  searchParams: Promise<{ location?: string }>
}) {
  const { courseId } = await params
  const wanted = (await searchParams).location
  if (!isUuid(courseId)) notFound()
  const { actor } = await requireActorContext()
  if (!canUseTrainingAdmin(actor)) notFound()

  const data = await withTenant(actor.organizationId, async (tx) => {
    let course
    try {
      course = await getCourse(tx, actor, courseId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
    const timeZone = await organizationTimeZone(tx, actor.organizationId)
    const assignLocations = canAtAnyLocation(actor, 'training.assign')
      ? await locationsWhere(tx, actor, 'training.assign')
      : []
    const location = assignLocations.find((l) => l.id === wanted) ?? assignLocations[0] ?? null

    let assignable = null
    if (location && course.published && course.status === 'active') {
      try {
        assignable = await listAssignablePeople(tx, actor, courseId, location.id)
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error
      }
    }
    const rows = canViewProgressAnywhere(actor)
      ? await scopedAssignments(tx, actor, { courseId })
      : null
    return { course, timeZone, assignLocations, location, assignable, rows }
  })
  if (!data) notFound()
  const { course, timeZone, assignable, rows } = data
  const current = course.published?.versionNumber ?? null
  const assignScope = accessibleLocationIds(actor, 'training.assign')
  const canAssignRow = (locationIds: string[]) =>
    assignScope === null || locationIds.some((id) => assignScope.includes(id))

  return (
    <>
      <Breadcrumb href="/app/training" label="Courses" />
      <PageHeader
        eyebrow="Training · People"
        title={course.title}
        description={
          current
            ? `Version ${current} is current. People keep the version they were assigned.`
            : 'This course is not published yet.'
        }
      />
      <CourseTabs courseId={courseId} current="people" showPeople />
      <PeopleWorkspace
        courseId={courseId}
        currentVersion={current}
        archived={course.status === 'archived'}
        today={businessDate(new Date(), data.location?.timeZone ?? timeZone)}
        locations={data.assignLocations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={data.location?.id ?? null}
        assignable={
          assignable
            ? {
                locationName: assignable.location.name,
                jobRoles: assignable.jobRoles,
                people: assignable.people.map((p) => ({
                  id: p.employmentId,
                  name: p.displayName,
                  roles: p.jobRoleNames.join(', ') || p.jobTitle || '',
                  existing: p.existing
                    ? p.existing.status === 'open'
                      ? `Working on version ${p.existing.versionNumber}`
                      : `Completed version ${p.existing.versionNumber}${
                          p.existing.completedAt
                            ? ` on ${formatDateInZone(p.existing.completedAt, timeZone)}`
                            : ''
                        }`
                    : null,
                  open: p.existing?.status === 'open',
                })),
              }
            : null
        }
        rows={
          rows
            ? rows.map((r) => ({
                assignmentId: r.assignmentId,
                personName: r.personName,
                locations: r.locationNames.join(', '),
                versionNumber: r.versionNumber,
                statusKey: r.status.key,
                statusLabel: r.status.label,
                statusTone: r.status.tone,
                percent: r.percent,
                progressLabel: `${r.completedLessons} of ${r.totalLessons} lessons`,
                dueLabel: r.dueOn ? `Due ${formatCalendarDate(r.dueOn)}` : 'No due date',
                completedLabel: r.completedAt
                  ? `Completed ${formatDateInZone(r.completedAt, timeZone)}`
                  : null,
                scoreLabel: r.bestScore !== null ? `Best knowledge check ${r.bestScore}%` : null,
                outOfAttempts: r.outOfAttempts,
                canManage: canAssignRow(r.locationIds),
                open: r.state !== 'completed',
                movable:
                  r.state === 'not_started' &&
                  current !== null &&
                  r.versionNumber < current &&
                  canAssignRow(r.locationIds),
              }))
            : null
        }
      />
    </>
  )
}
