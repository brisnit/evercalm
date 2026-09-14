'use client'

import Link from 'next/link'
import { publishScheduleAction } from '@/modules/scheduling/actions'
import type { PublicationPreview } from '@/modules/scheduling/service'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Badge, Card, CardHeader } from '@/ui/primitives'

/**
 * Publication.
 *
 * Says what employees can see right now, refuses (with links) while any
 * assignment has a blocking conflict, and before anything is sent lists the
 * exact people who will be notified and what changed for each. Nobody is
 * surprised by who gets a message.
 */
export function PublishPanel({
  scheduleId,
  status,
  version,
  publishedAt,
  preview,
  canPublish,
}: {
  scheduleId: string | null
  status: 'empty' | 'draft' | 'changed' | 'published'
  version: number
  publishedAt: string | null
  preview: PublicationPreview | null
  canPublish: boolean
}) {
  const { notice, show, dismiss } = useActionNotice()

  const badge =
    status === 'draft' ? (
      <Badge tone="warning">Draft</Badge>
    ) : status === 'changed' ? (
      <Badge tone="info">Changes not published</Badge>
    ) : status === 'published' ? (
      <Badge tone="success">Published</Badge>
    ) : (
      <Badge>Empty</Badge>
    )

  const description =
    status === 'draft'
      ? 'Employees cannot see this week yet.'
      : status === 'changed'
        ? `Employees see version ${version}${publishedAt ? `, published ${publishedAt}` : ''}. Your edits since then are not visible to them yet.`
        : status === 'published'
          ? `Employees can see this week${publishedAt ? ` (published ${publishedAt})` : ''}.`
          : 'Add shifts to start this week.'

  const blocked = preview?.blocking ?? []
  const ready =
    preview &&
    scheduleId &&
    (status === 'draft' || status === 'changed') &&
    preview.changedShifts > 0

  return (
    <Card>
      <CardHeader title="Publication" description={description} action={badge} />
      <div className="flex flex-col gap-3 p-5">
        <ActionNotice notice={notice} onDismiss={dismiss} />

        {blocked.length > 0 ? (
          <div className="rounded-control border-danger/30 bg-danger-soft/50 border p-3">
            <p className="text-ink text-sm font-semibold">
              {blocked.length} {blocked.length === 1 ? 'shift needs' : 'shifts need'} fixing before
              this can be published
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {blocked.map((b) => (
                <li key={b.shiftId}>
                  <Link
                    href={`/app/schedule/shifts/${b.shiftId}`}
                    className="text-ink font-medium underline underline-offset-4"
                  >
                    {b.label}
                  </Link>
                  <span className="text-muted block text-xs">{b.messages[0]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!canPublish ? (
          <p className="text-muted text-sm">
            A manager with permission to publish sends this week to the team.
          </p>
        ) : ready && blocked.length === 0 ? (
          <ConfirmAction
            triggerLabel={status === 'draft' ? 'Publish this week' : 'Publish changes'}
            title={status === 'draft' ? 'Publish this week?' : 'Publish these changes?'}
            description={`${preview.people.length} ${preview.people.length === 1 ? 'person is' : 'people are'} notified${
              preview.unassigned > 0
                ? `. ${preview.unassigned} ${preview.unassigned === 1 ? 'shift is' : 'shifts are'} still unassigned`
                : ''
            }${preview.warnings > 0 ? `. ${preview.warnings} ${preview.warnings === 1 ? 'warning' : 'warnings'} to be aware of` : ''}.`}
          >
            {preview.people.length > 0 ? (
              <ul className="mb-3 flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
                {preview.people.map((person) => (
                  <li key={person.employmentId}>
                    <span className="text-ink font-medium">{person.displayName}</span>
                    <ul className="text-muted text-xs">
                      {person.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : null}
            <ActionForm action={publishScheduleAction} submitLabel="Yes, publish" onSuccess={show}>
              <input type="hidden" name="scheduleId" value={scheduleId} />
            </ActionForm>
          </ConfirmAction>
        ) : status === 'published' ? (
          <p className="text-muted text-sm">
            Nothing waiting. Edits you make appear here to publish.
          </p>
        ) : null}
      </div>
    </Card>
  )
}
