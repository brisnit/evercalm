import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { weekReview } from '@/modules/scheduling/slotted'
import { NotFoundError } from '@/lib/errors'
import { ButtonLink, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { ReviewStack } from './review-stack'

export const metadata: Metadata = { title: 'Review the week' }
export const dynamic = 'force-dynamic'

/**
 * The review stack: one card per day, one decision each.
 *
 * Review and edit are separate on purpose. Here a manager answers a single
 * question about a whole day — is this right? — and the days they are not sure
 * about go to the back of the stack rather than blocking the ones that are
 * fine.
 */
export default async function ReviewPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.draft')) {
    return <PermissionDenied capabilityLabel="Build schedules" />
  }

  const review = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await weekReview(tx, actor, scheduleId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!review) notFound()

  const scheduled = review.days.filter((d) => d.slots > 0)
  const remaining = scheduled.filter((d) => d.state !== 'approved')

  return (
    <>
      <PageHeader
        back={{
          href: `/app/schedule?location=${review.locationId}&week=${review.weekStart}`,
          label: 'The week',
        }}
        eyebrow={review.locationName}
        title="Review the"
        accent="week"
        description={
          remaining.length === 0
            ? 'Every day is approved. The last step is the final check.'
            : `${remaining.length} of ${scheduled.length} days still to look at. Approve moves you on; flag brings it back at the end.`
        }
        action={
          remaining.length === 0 ? (
            <ButtonLink href={`/app/schedule/publish/${scheduleId}`} size="lg">
              Final check
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="py-7">
        <ReviewStack review={review} />
      </div>
    </>
  )
}
