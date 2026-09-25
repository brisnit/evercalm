import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { candidatesForSlot } from '@/modules/scheduling/slotted'
import { NotFoundError } from '@/lib/errors'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { CandidateList } from '@/ui/patterns/candidate-list'
import { CalloutForm } from '../../_components/callout-form'
import { Card, CardHeader } from '@/ui/primitives'
import { shiftDetail } from './detail'

export const metadata: Metadata = { title: 'Fill this slot' }
export const dynamic = 'force-dynamic'

/**
 * Pick by availability.
 *
 * Everyone who could take this slot, grouped by what they said about the
 * hours: available first, then people who would rather not, then people who
 * said no — who a manager may still choose, with a warning — and finally
 * approved time off, which is shown and locked.
 */
export default async function SlotPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.draft')) {
    return <PermissionDenied capabilityLabel="Build schedules" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return {
        detail: await shiftDetail(tx, actor, shiftId),
        ...(await candidatesForSlot(tx, actor, shiftId)),
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
        title={data.roleName ?? 'This shift'}
        accent="— who works it?"
        description={
          data.detail.assigneeName
            ? `${data.detail.assigneeName} has it now. Choosing somebody else replaces them.`
            : 'Nobody is in this slot yet.'
        }
      />
      <div className="flex flex-col gap-5 py-7">
        <NoticeProvider>
          <CandidateList
            shiftId={shiftId}
            candidates={data.candidates}
            assignedTo={data.detail.assigneeId}
            mode="assign"
            roleName={data.roleName}
          />
        </NoticeProvider>

        {data.detail.assigneeId && data.detail.assigneeName ? (
          <Card>
            <CardHeader
              title="They cannot work it"
              description="Recording a call-out keeps the reason with the shift and opens a ranked list of who could cover."
            />
            <div className="p-5">
              <NoticeProvider>
                <CalloutForm shiftId={shiftId} name={data.detail.assigneeName} />
              </NoticeProvider>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  )
}
