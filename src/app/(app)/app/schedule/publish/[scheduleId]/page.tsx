import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { weekReview } from '@/modules/scheduling/slotted'
import { previewPublication } from '@/modules/scheduling/service'
import { NotFoundError } from '@/lib/errors'
import { formatIsoDate } from '@/modules/scheduling/time'
import { Badge, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { MiniForm } from '@/ui/patterns/mini-form'
import { publishScheduleAction } from '@/modules/scheduling/actions'

export const metadata: Metadata = { title: 'Final check' }
export const dynamic = 'force-dynamic'

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The final check.
 *
 * Everything approved, every override listed by name, and the exact count of
 * people who will be told. Publishing is one tap, and it is the only moment
 * anything reaches an employee — autofill and review never do.
 */
export default async function PublishPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.publish')) {
    return <PermissionDenied capabilityLabel="Publish schedules" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return {
        review: await weekReview(tx, actor, scheduleId),
        preview: await previewPublication(tx, actor, scheduleId),
      }
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()

  const { review, preview } = data
  const scheduled = review.days.filter((d) => d.slots > 0)
  const approved = scheduled.filter((d) => d.state === 'approved').length
  const ready = approved === scheduled.length && preview.blocking.length === 0
  const open = review.slots - review.filled

  return (
    <>
      <PageHeader
        back={{ href: `/app/schedule/review/${scheduleId}`, label: 'Review' }}
        eyebrow={review.locationName}
        title={ready ? 'Ready to' : 'Not quite'}
        accent={ready ? 'publish' : 'ready'}
        description={
          ready
            ? `Week of ${formatIsoDate(review.weekStart)}. Publishing tells people their shifts and their break times.`
            : 'A few things first. Nothing below stops you coming back.'
        }
      />

      <div className="flex flex-col gap-5 py-7">
        <Card>
          <CardHeader title={`Week of ${formatIsoDate(review.weekStart)}`} />
          <div className="p-5">
            <ul className="mb-5 flex gap-1.5" aria-label="Days approved">
              {review.days.map((day, index) => (
                <li
                  key={day.date}
                  className={
                    day.state === 'approved'
                      ? 'bg-success-soft text-success flex size-9 items-center justify-center rounded-full text-sm font-semibold'
                      : day.state === 'flagged'
                        ? 'bg-danger-soft text-danger flex size-9 items-center justify-center rounded-full text-sm font-semibold'
                        : 'border-line text-faint flex size-9 items-center justify-center rounded-full border border-dashed text-sm'
                  }
                >
                  <span aria-hidden="true">{WEEKDAY[index]}</span>
                  <span className="sr-only">
                    {formatIsoDate(day.date)}: {day.state}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="divide-line divide-y">
              <Row label="Days approved" value={`${approved} / ${scheduled.length}`} />
              <Row label="Slots filled" value={`${review.filled} / ${review.slots}`} />
              <Row label="Still open" value={open === 0 ? 'None' : String(open)} />
              <Row label="People who will be told" value={String(preview.people.length)} />
              <Row
                label="Your overrides"
                value={review.overrides.length === 0 ? 'None' : String(review.overrides.length)}
              />
            </dl>
          </div>
        </Card>

        {review.overrides.length > 0 ? (
          <Card className="border-warning/30">
            <CardHeader
              title="Scheduled against their availability"
              description="You chose to. Each of these people sees a note on their own schedule saying so, and can reply."
            />
            <ul className="divide-line divide-y">
              {review.overrides.map((override) => (
                <li key={override.shiftId} className="px-5 py-3">
                  <p className="text-ink text-sm font-medium">
                    {override.name} — {override.when}
                  </p>
                  {override.reason ? (
                    <p className="text-muted mt-0.5 text-sm">{override.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {preview.blocking.length > 0 ? (
          <Card className="border-danger/30">
            <CardHeader
              title="These have to change first"
              description="Nobody can be told to work a shift they cannot work."
            />
            <ul className="divide-line divide-y">
              {preview.blocking.map((item) => (
                <li key={item.shiftId} className="px-5 py-3">
                  <p className="text-ink text-sm font-medium">{item.label}</p>
                  {item.messages.map((message) => (
                    <p key={message} className="text-danger mt-0.5 text-sm">
                      {message}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title={preview.firstPublication ? 'Publish this week' : 'Publish the changes'}
            description={
              preview.firstPublication
                ? 'Everyone assigned sees their shifts and break times, and is notified.'
                : 'Only the people whose shifts changed are notified.'
            }
            action={
              review.status === 'published' ? <Badge tone="success">Published</Badge> : undefined
            }
          />
          <div className="p-5">
            {approved < scheduled.length ? (
              <p className="text-warning mb-4 text-sm font-medium">
                {review.days.length - approved}{' '}
                {review.days.length - approved === 1 ? 'day has' : 'days have'} not been approved
                yet. You can still publish — the review is yours, not a gate.
              </p>
            ) : null}
            <NoticeProvider>
              <MiniForm
                action={publishScheduleAction}
                hidden={{ scheduleId }}
                submitLabel={preview.firstPublication ? 'Publish schedule' : 'Publish the changes'}
                variant="primary"
                size="lg"
              />
            </NoticeProvider>
            <p className="text-muted mt-3 text-sm">
              You can still edit after publishing — changes notify only the people affected.
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-ink text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
