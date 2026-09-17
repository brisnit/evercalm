import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { formatCalendarDate, formatDateInZone } from '@/lib/dates'
import { canViewProgressAnywhere } from '@/modules/training/access'
import {
  countStatuses,
  progressLocations,
  scopedAssignments,
  type AssignmentReportRow,
} from '@/modules/training/assignments'
import { organizationTimeZone } from '@/modules/training/records'
import { Badge, Button, Card, EmptyState, PageHeader, ProgressBar } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { SELECT_CLASS } from '../_components/styles'

export const metadata: Metadata = { title: 'Training progress' }
export const dynamic = 'force-dynamic'

const STATUSES = [
  { key: 'open', label: 'Not finished' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'awaiting_signoff', label: 'Waiting for sign-off' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'Everything' },
] as const

function matches(row: AssignmentReportRow, status: string): boolean {
  if (status === 'all') return true
  if (status === 'open') return row.state !== 'completed'
  return row.status.key === status
}

/**
 * Everyone's training at the locations the viewer looks after, person by
 * person. A plain GET form filters it, so it works before any script loads
 * and a filtered view can be bookmarked or shared with a colleague.
 */
export default async function TrainingProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; status?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()
  if (!canViewProgressAnywhere(actor)) {
    return <PermissionDenied capabilityLabel="View team training progress" />
  }
  const status = STATUSES.some((s) => s.key === params.status) ? params.status! : 'open'

  const data = await withTenant(actor.organizationId, async (tx) => {
    const locations = await progressLocations(tx, actor)
    const locationId = locations.some((l) => l.id === params.location) ? params.location : undefined
    return {
      locations,
      locationId,
      rows: await scopedAssignments(tx, actor, { locationId }),
      timeZone: await organizationTimeZone(tx, actor.organizationId),
    }
  })

  const counts = countStatuses(data.rows)
  const shown = data.rows.filter((r) => matches(r, status))
  const people = new Map<string, AssignmentReportRow[]>()
  for (const row of shown)
    people.set(row.employmentId, [...(people.get(row.employmentId) ?? []), row])
  const everyone = new Map<string, AssignmentReportRow[]>()
  for (const row of data.rows)
    everyone.set(row.employmentId, [...(everyone.get(row.employmentId) ?? []), row])

  return (
    <>
      <PageHeader
        title="Progress"
        description="Training for the people at the locations you look after. Overdue work comes first."
      />

      <form
        method="get"
        className="rounded-card border-line bg-raise mb-5 flex flex-wrap items-end gap-3 border p-3"
      >
        {data.locations.length > 1 ? (
          <div className="flex min-w-44 flex-1 flex-col gap-1.5 sm:flex-none">
            <label htmlFor="progress-location" className="text-muted text-xs font-medium">
              Location
            </label>
            <select
              id="progress-location"
              name="location"
              defaultValue={data.locationId ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">All your locations</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex min-w-44 flex-1 flex-col gap-1.5 sm:flex-none">
          <label htmlFor="progress-status" className="text-muted text-xs font-medium">
            Show
          </label>
          <select id="progress-status" name="status" defaultValue={status} className={SELECT_CLASS}>
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <p className="text-muted mb-4 text-sm" aria-live="polite">
        {counts.total} {counts.total === 1 ? 'assignment' : 'assignments'}: {counts.completed}{' '}
        completed, {counts.overdue} overdue, {counts.awaitingSignoff} waiting for sign-off,{' '}
        {counts.inProgress} in progress, {counts.notStarted} not started.
      </p>

      {people.size === 0 ? (
        <EmptyState
          title="Nothing to show"
          description={
            data.rows.length === 0
              ? 'Nobody you look after has been assigned training yet.'
              : 'Nothing matches this filter.'
          }
        />
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {[...people.entries()].map(([employmentId, rows]) => {
            const all = everyone.get(employmentId) ?? rows
            const done = all.filter((r) => r.state === 'completed').length
            const overdue = all.filter((r) => r.status.key === 'overdue').length
            return (
              <li key={employmentId}>
                <Card as="article" className="h-full">
                  <header className="border-line flex flex-wrap items-start justify-between gap-2 border-b px-5 py-4">
                    <div className="min-w-0">
                      <h2 className="font-display text-ink text-base font-bold">
                        {rows[0]!.personName}
                      </h2>
                      <p className="text-muted text-xs">{rows[0]!.locationNames.join(', ')}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="neutral">
                        {done} of {all.length} complete
                      </Badge>
                      {overdue > 0 ? <Badge tone="danger">{overdue} overdue</Badge> : null}
                    </div>
                  </header>
                  <ul className="divide-line divide-y">
                    {rows.map((row) => (
                      <li key={row.assignmentId} className="flex flex-col gap-2 px-5 py-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            href={`/app/training/courses/${row.courseId}/people`}
                            className="text-ink min-w-0 text-sm font-medium underline underline-offset-4"
                          >
                            {row.courseTitle}
                          </Link>
                          <Badge tone={row.status.tone}>{row.status.label}</Badge>
                        </div>
                        <ProgressBar
                          value={row.percent}
                          label={`${row.completedLessons} of ${row.totalLessons} lessons · version ${row.versionNumber}`}
                          tone={
                            row.state === 'completed'
                              ? 'success'
                              : row.status.key === 'overdue'
                                ? 'danger'
                                : 'accent'
                          }
                        />
                        <p className="text-muted text-xs">
                          {row.completedAt
                            ? `Completed ${formatDateInZone(row.completedAt, data.timeZone)}`
                            : row.dueOn
                              ? `Due ${formatCalendarDate(row.dueOn)}`
                              : 'No due date'}
                          {row.outOfAttempts.length > 0 ? ' · Out of knowledge-check attempts' : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
