import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { replacementCandidates } from '@/modules/scheduling/slotted'
import { NotFoundError } from '@/lib/errors'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { CandidateList } from '@/ui/patterns/candidate-list'
import { shiftDetail } from '../../slots/[shiftId]/detail'

export const metadata: Metadata = { title: 'Find a replacement' }
export const dynamic = 'force-dynamic'

/**
 * A call-out is a ranked list and one tap, not a rebuild.
 *
 * Qualified people grouped by what they said about the hours, with the number
 * that actually decides it in the open: what their week becomes if they say
 * yes, and whether that crosses forty hours.
 */
export default async function CalloutPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.draft')) {
    return <PermissionDenied capabilityLabel="Build schedules" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return {
        detail: await shiftDetail(tx, actor, shiftId),
        ...(await replacementCandidates(tx, actor, shiftId)),
      }
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()

  return (
    <>
      <PageHeader
        back={{
          href: `/app/schedule?location=${data.detail.locationId}&week=${data.detail.weekStart}`,
          label: 'The week',
        }}
        eyebrow={`${data.detail.day} · ${data.detail.time}`}
        title={`${data.detail.assigneeName ?? 'Somebody'} can’t work`}
        accent="— who covers?"
        description={`${data.roleName ? `${data.roleName}-qualified people` : 'Everyone'} first, then anyone else. Hours and overtime are shown before you commit.`}
      />
      <div className="py-7">
        <NoticeProvider>
          <CandidateList
            shiftId={shiftId}
            candidates={data.candidates}
            assignedTo={null}
            mode="callout"
            roleName={data.roleName}
          />
        </NoticeProvider>
      </div>
    </>
  )
}
