import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NotFoundError } from '@/lib/errors'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { handoffAssignees, listHandoffs } from '@/modules/operations/handoffs'
import { cn } from '@/lib/cn'
import { HandoffCard } from '@/ui/patterns/handoff-card'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { BoardToolbar } from '../_components/board-toolbar'
import { ManagerHandoffForm } from './manager-handoff-form'

export const metadata: Metadata = { title: 'Handoffs' }
export const dynamic = 'force-dynamic'

/**
 * Every handoff at a location: what is open, most pressing first, and what
 * was resolved and how. Nothing here is ever deleted.
 */
export default async function HandoffsPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; status?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()
  if (
    !canAtAnyLocation(actor, 'checklist.view_runs') &&
    !canAtAnyLocation(actor, 'handoff.manage')
  ) {
    return <PermissionDenied capabilityLabel="Manage handoffs" />
  }
  const data = await withTenant(actor.organizationId, async (tx) => {
    const list = await listHandoffs(tx, actor, {
      locationId: params.location ?? null,
      status: params.status ?? null,
    })
    return {
      list,
      assignees: list?.canCreate ? await handoffAssignees(tx, actor, list.location.id) : [],
    }
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })
  if (!data.list) {
    return (
      <EmptyState
        title="No locations"
        description="You can see handoffs only for the locations you manage."
      />
    )
  }
  const { list } = data
  const tab = (status: 'open' | 'resolved', label: string) => (
    <Link
      href={`/app/operations/handoffs?location=${list.location.id}&status=${status}`}
      aria-current={list.status === status ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center border-b-2 px-3 text-sm',
        list.status === status
          ? 'text-ink border-teal-600 font-semibold'
          : 'text-muted hover:text-ink border-transparent',
      )}
    >
      {label}
    </Link>
  )

  return (
    <NoticeProvider>
      <PageHeader
        eyebrow={list.location.name}
        title="Handoffs"
        description="What one shift needs the next to know. Anyone who works here can read and acknowledge them; a manager resolves them."
      />
      <BoardToolbar
        basePath="/app/operations/handoffs"
        locations={list.locations}
        locationId={list.location.id}
      />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <section aria-labelledby="handoff-list">
          <h2 id="handoff-list" className="sr-only">
            {list.status === 'open' ? 'Open handoffs' : 'Resolved handoffs'}
          </h2>
          <nav aria-label="Handoff status" className="border-line mb-4 border-b">
            <div className="-mb-px flex gap-1">
              {tab('open', `Open (${list.counts.open})`)}
              {tab('resolved', 'Resolved')}
            </div>
          </nav>
          {list.handoffs.length === 0 ? (
            <EmptyState
              title={list.status === 'open' ? 'Nothing open' : 'Nothing resolved yet'}
              description={
                list.status === 'open'
                  ? 'Every handoff at this location has been dealt with.'
                  : 'Resolved handoffs appear here with what was done.'
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {list.handoffs.map((h) => (
                <HandoffCard key={h.id} handoff={h} />
              ))}
            </div>
          )}
        </section>
        {list.canCreate ? (
          <Card>
            <CardHeader
              title="Leave a handoff"
              description="A task for the next shift, or for one person who works here. They see it when they next open EverCalm."
            />
            <div className="p-5">
              <ManagerHandoffForm locationId={list.location.id} assignees={data.assignees} />
            </div>
          </Card>
        ) : null}
      </div>
    </NoticeProvider>
  )
}
