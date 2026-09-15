import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { listAnnouncements, organizationTimeZone } from '@/modules/comms/service'
import { formatInZone } from '@/lib/dates'
import { ButtonLink, Card, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { PriorityMark, StatusMark } from '@/ui/patterns/priority-mark'

export const metadata: Metadata = { title: 'Communication' }
export const dynamic = 'force-dynamic'

/**
 * The announcement list.
 *
 * Ordered by most recently touched, because an author's question is usually
 * "what was I working on" rather than "what is oldest". Each row carries its
 * state as a word and, once published, the two numbers that matter: how many
 * have read it and how many have confirmed.
 */
export default async function CommsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()

  if (!canAtAnyLocation(actor, 'announcement.create')) {
    return <PermissionDenied capabilityLabel="Create announcements" />
  }

  const includeArchived = params.archived === '1'
  const { announcements, timeZone } = await withTenant(actor.organizationId, async (tx) => ({
    announcements: await listAnnouncements(tx, actor, { includeArchived }),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  }))

  const drafts = announcements.filter((a) => a.status === 'draft')
  const scheduled = announcements.filter((a) => a.status === 'scheduled')
  const live = announcements.filter((a) => a.status === 'published')
  const past = announcements.filter((a) => a.status === 'expired' || a.status === 'archived')

  return (
    <>
      <PageHeader
        title="Announcements"
        description="What you have told people, who has read it, and who still needs to confirm."
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink
              href={includeArchived ? '/app/comms' : '/app/comms?archived=1'}
              variant="secondary"
            >
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </ButtonLink>
            <ButtonLink href="/app/comms/new">New announcement</ButtonLink>
          </div>
        }
      />

      {announcements.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing posted yet"
            description="Write your first announcement and choose who should see it."
            action={<ButtonLink href="/app/comms/new">New announcement</ButtonLink>}
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          <Group
            title="Needs finishing"
            items={drafts}
            emptyHint="No drafts."
            timeZone={timeZone}
          />
          <Group
            title="Scheduled"
            items={scheduled}
            emptyHint="Nothing scheduled."
            timeZone={timeZone}
          />
          <Group
            title="Active"
            items={live}
            emptyHint="Nothing active right now."
            timeZone={timeZone}
          />
          {includeArchived || past.length > 0 ? (
            <Group
              title="Expired and archived"
              items={past}
              emptyHint="Nothing here."
              timeZone={timeZone}
            />
          ) : null}
        </div>
      )}
    </>
  )
}

function Group({
  title,
  items,
  emptyHint,
  timeZone,
}: {
  title: string
  items: Awaited<ReturnType<typeof listAnnouncements>>
  emptyHint: string
  timeZone: string
}) {
  return (
    <section aria-labelledby={`group-${title}`}>
      <h2
        id={`group-${title}`}
        className="font-display text-muted mb-3 text-sm font-bold tracking-[0.06em] uppercase"
      >
        {title} · {items.length}
      </h2>

      {items.length === 0 ? (
        <p className="text-faint text-sm">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/app/comms/${item.id}`} className="block">
                <Card className="hover:bg-raise relative overflow-hidden p-4">
                  {/*
                    Two columns on a wide screen, so the numbers a manager
                    scans for sit where the eye already is instead of leaving
                    half the row empty. Stacks on a phone.
                  */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusMark status={item.status} />
                        <PriorityMark priority={item.priority} />
                        {item.requiresAcknowledgement ? (
                          <span className="bg-sunk text-muted rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold">
                            Needs confirmation
                          </span>
                        ) : null}
                        <span className="text-faint text-xs">{item.categoryName}</span>
                      </div>

                      <h3 className="font-display text-ink mt-2.5 text-base font-bold">
                        {item.title}
                      </h3>

                      {item.authorName ? (
                        <p className="text-muted mt-1 text-xs">{item.authorName}</p>
                      ) : null}
                    </div>

                    <dl className="text-muted flex shrink-0 flex-wrap items-start gap-x-5 gap-y-1 text-xs sm:justify-end">
                      {item.status === 'published' ? (
                        <>
                          <Stat label="Sent to" value={String(item.recipientCount)} />
                          <Stat label="Read" value={String(item.viewedCount)} />
                          {item.requiresAcknowledgement ? (
                            <Stat
                              label="Confirmed"
                              value={`${item.acknowledgedCount} of ${item.recipientCount}`}
                            />
                          ) : null}
                        </>
                      ) : null}
                      {item.status === 'scheduled' && item.publishAt ? (
                        <Stat label="Goes out" value={formatInZone(item.publishAt, timeZone)} />
                      ) : null}
                      {item.revisionNumber > 1 ? (
                        <Stat label="Revision" value={String(item.revisionNumber)} />
                      ) : null}
                    </dl>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** One label-and-number pair in a list row. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:items-end">
      <dt className="text-faint text-[0.625rem] font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="text-ink font-semibold">{value}</dd>
    </div>
  )
}
