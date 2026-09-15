import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { formatDateInZone } from '@/lib/dates'
import { signoffQueue } from '@/modules/training/assignments'
import { organizationTimeZone } from '@/modules/training/records'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { SignoffQueue } from './signoff-queue'

export const metadata: Metadata = { title: 'Sign-offs' }
export const dynamic = 'force-dynamic'

/**
 * Practicals people have asked a manager to watch. Oldest first, so nobody's
 * request sits at the bottom of the pile. A manager's own requests are never
 * here: somebody else signs those off.
 */
export default async function SignoffsPage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'skill.verify')) {
    return <PermissionDenied capabilityLabel="Verify practical skills" />
  }
  const data = await withTenant(actor.organizationId, async (tx) => ({
    queue: await signoffQueue(tx, actor),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  }))

  return (
    <>
      <PageHeader
        title="Sign-offs"
        description="Sign off only what you have watched someone do. If they need more practice, send it back with a note saying what to work on."
      />
      <SignoffQueue
        requests={data.queue.map((r) => ({
          progressId: r.progressId,
          personName: r.personName,
          locations: r.locationNames.join(', '),
          courseTitle: r.courseTitle,
          versionNumber: r.versionNumber,
          lessonTitle: r.lessonTitle,
          body: r.body,
          criteria: r.criteria,
          askedLabel:
            r.waitingDays === 0
              ? 'Asked today'
              : r.waitingDays === 1
                ? 'Asked yesterday'
                : `Asked ${r.waitingDays} days ago`,
          previous: r.previous.map((p) => ({
            label: `${p.decision === 'returned' ? 'Sent back' : 'Signed off'} by ${p.byName} on ${formatDateInZone(p.at, data.timeZone)}`,
            note: p.note,
          })),
        }))}
      />
    </>
  )
}
