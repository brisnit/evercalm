import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import {
  listClaimsForReview,
  listSwapsForReview,
  listTimeOffForReview,
} from '@/modules/scheduling/requests'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { RequestsBoard, type ClaimItem, type SwapItem, type TimeOffItem } from './requests-board'

export const metadata: Metadata = { title: 'Schedule requests' }
export const dynamic = 'force-dynamic'

const REASONS: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
  family: 'Family',
  other: 'Other',
}

/**
 * Everything waiting on a manager: time off, open-shift requests, and swaps
 * both colleagues have agreed to. Each list is only what the viewer may
 * decide - a Downtown manager sees nothing from Riverside, and HR sees time
 * off without the shift queues.
 */
export default async function ScheduleRequestsPage() {
  const { actor } = await requireActorContext()
  const may = {
    timeOff: canAtAnyLocation(actor, 'timeoff.decide'),
    claims: canAtAnyLocation(actor, 'openshift.manage'),
    swaps: canAtAnyLocation(actor, 'swap.decide'),
  }
  if (!may.timeOff && !may.claims && !may.swaps) {
    return <PermissionDenied capabilityLabel="Approve or deny time off" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => ({
    timeOff: may.timeOff ? await listTimeOffForReview(tx, actor) : [],
    claims: may.claims ? await listClaimsForReview(tx, actor, { status: 'pending' }) : [],
    swaps: may.swaps ? await listSwapsForReview(tx, actor) : [],
  }))

  const timeOff: TimeOffItem[] = data.timeOff.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    period: r.period,
    reason: REASONS[r.reason] ?? r.reason,
    note: r.note,
    status: r.status,
    decidedByName: r.decidedByName,
    decisionNote: r.decisionNote,
    affectedShifts: r.affectedShifts,
  }))
  const claims: ClaimItem[] = data.claims
    .filter((c) => c.status === 'pending')
    .map((c) => ({
      id: c.id,
      displayName: c.displayName,
      shiftId: c.shiftId,
      shiftLabel: c.shiftLabel,
      locationName: c.locationName,
      jobRoleName: c.jobRoleName,
      note: c.note,
      conflicts: c.conflicts,
    }))
  const swaps: SwapItem[] = data.swaps.map((s) => ({
    id: s.id,
    kind: s.kind,
    status: s.status,
    locationName: s.locationName,
    requesterName: s.requesterName,
    recipientName: s.recipientName,
    shiftLabel: s.shiftLabel,
    recipientShiftLabel: s.recipientShiftLabel,
    note: s.note,
    conflicts: s.conflicts,
    stale: s.stale,
    decidedByName: s.decidedByName,
    decisionNote: s.decisionNote,
  }))

  return (
    <>
      <PageHeader
        eyebrow="Schedule"
        title="Requests"
        description="Time off, open shifts, and swaps waiting for a decision. Everyone involved is told what you decide."
      />
      <RequestsBoard
        timeOff={may.timeOff ? timeOff : null}
        claims={may.claims ? claims : null}
        swaps={may.swaps ? swaps : null}
      />
    </>
  )
}
