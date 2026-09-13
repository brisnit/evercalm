'use client'

import { useState } from 'react'
import { sendRemindersAction } from '@/modules/comms/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { Badge, Card, CardHeader, ScrollArea } from '@/ui/primitives'

/**
 * The receipt report.
 *
 * Totals first, then a breakdown, then the names. `partialView` is stated
 * plainly at the top when the viewer only covers some locations - presenting a
 * slice as the whole picture would let a manager conclude "everyone has read
 * it" when they can only see a third of the audience.
 */

interface Row {
  employmentId: string
  displayName: string
  locationName: string | null
  jobRoleName: string | null
  deliveryStatus: string
  deliveryFailureReason: string | null
  viewed: boolean
  acknowledged: boolean
  needsReacknowledgement: boolean
  reminderCount: number
}

interface Breakdown {
  label: string
  targeted: number
  viewed: number
  acknowledged: number
}

export function ReceiptsPanel({
  announcementId,
  report,
  mayRemind,
}: {
  announcementId: string
  report: {
    totals: {
      targeted: number
      delivered: number
      failed: number
      viewed: number
      unread: number
      acknowledged: number
      outstanding: number
      overdue: number
    }
    partialView: boolean
    requiresAcknowledgement: boolean
    acknowledgementDueAt: string | null
    byLocation: Breakdown[]
    byDepartment: Breakdown[]
    byJobRole: Breakdown[]
    rows: Row[]
  }
  mayRemind: boolean
}) {
  const [filter, setFilter] = useState<'all' | 'outstanding' | 'unread'>('all')
  const { totals } = report

  const rows = report.rows.filter((row) => {
    if (filter === 'unread') return !row.viewed
    if (filter === 'outstanding') {
      return report.requiresAcknowledgement && (!row.acknowledged || row.needsReacknowledgement)
    }
    return true
  })

  return (
    <Card>
      <CardHeader
        title="Who has read it"
        description={
          report.partialView
            ? 'You are seeing the people at your own locations. Other locations are not included in these numbers.'
            : 'Everyone this was sent to.'
        }
      />

      <div className="p-5">
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Total label="Sent to" value={totals.targeted} />
          <Total label="Read" value={totals.viewed} sub={`${totals.unread} not yet`} />
          {report.requiresAcknowledgement ? (
            <>
              <Total label="Confirmed" value={totals.acknowledged} />
              <Total
                label="Outstanding"
                value={totals.outstanding}
                sub={totals.overdue > 0 ? `${totals.overdue} overdue` : undefined}
                emphasis={totals.overdue > 0}
              />
            </>
          ) : (
            <>
              <Total label="Delivered" value={totals.delivered} />
              <Total label="Failed" value={totals.failed} emphasis={totals.failed > 0} />
            </>
          )}
        </dl>

        {report.requiresAcknowledgement && report.acknowledgementDueAt ? (
          <p className="text-muted mt-3 text-sm">Confirmation due {report.acknowledgementDueAt}.</p>
        ) : null}

        {totals.failed > 0 ? (
          <p className="rounded-control border-warning/30 bg-warning-soft text-ink mt-3 border px-3.5 py-2.5 text-sm">
            {totals.failed} {totals.failed === 1 ? 'delivery' : 'deliveries'} failed. The people
            below are marked, and the message is still in their inbox.
          </p>
        ) : null}

        {mayRemind && totals.outstanding > 0 ? (
          <div className="mt-4">
            <ActionForm
              action={sendRemindersAction}
              submitLabel={`Remind the ${totals.outstanding} outstanding`}
              variant="secondary"
            >
              <input type="hidden" name="announcementId" value={announcementId} />
              <p className="text-muted text-sm">
                Sends one nudge to everyone who has not confirmed. Pressing it twice in a row does
                not send twice.
              </p>
            </ActionForm>
          </div>
        ) : null}

        {/* --- breakdowns ------------------------------------------------ */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <BreakdownList title="By location" items={report.byLocation} />
          <BreakdownList title="By department" items={report.byDepartment} />
          <BreakdownList title="By job role" items={report.byJobRole} />
        </div>

        {/* --- people ---------------------------------------------------- */}
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter recipients">
            {(
              [
                ['all', `Everyone (${report.rows.length})`],
                ['unread', `Not read (${totals.unread})`],
                ...(report.requiresAcknowledgement
                  ? ([['outstanding', `Outstanding (${totals.outstanding})`]] as const)
                  : []),
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={
                  filter === value
                    ? 'rounded-control min-h-9 bg-violet-600 px-3 text-xs font-semibold text-white'
                    : 'rounded-control border-line text-ink min-h-9 border bg-white px-3 text-xs font-medium'
                }
              >
                {label}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-muted text-sm">Nobody in this view.</p>
          ) : (
            <ScrollArea label="Recipients, scrollable horizontally">
              <table className="w-full min-w-[34rem] table-fixed text-sm">
                <caption className="sr-only">
                  Every recipient and whether they have read and confirmed
                </caption>
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[22%]" />
                  <col className="w-[18%]" />
                  <col className="w-[26%]" />
                </colgroup>
                <thead>
                  <tr className="border-line-strong bg-sunk border-b text-left">
                    {['Name', 'Where', 'Read', 'Confirmed'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="text-muted px-3 py-2.5 text-xs font-semibold tracking-wide uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.employmentId} className="border-line border-b last:border-b-0">
                      <td className="text-ink px-3 py-2.5 break-words">
                        {row.displayName}
                        {row.deliveryStatus === 'failed' ? (
                          <span className="text-danger block text-xs">
                            Delivery failed
                            {row.deliveryFailureReason ? `: ${row.deliveryFailureReason}` : ''}
                          </span>
                        ) : null}
                        {row.reminderCount > 0 ? (
                          <span className="text-faint block text-xs">
                            Reminded {row.reminderCount}×
                          </span>
                        ) : null}
                      </td>
                      <td className="text-muted px-3 py-2.5 text-xs break-words">
                        {row.locationName ?? '—'}
                        {row.jobRoleName ? <span className="block">{row.jobRoleName}</span> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.viewed ? (
                          <Badge tone="success">Read</Badge>
                        ) : (
                          <Badge tone="neutral">Not yet</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {!report.requiresAcknowledgement ? (
                          <span className="text-faint text-xs">Not required</span>
                        ) : row.needsReacknowledgement ? (
                          <Badge tone="warning">Asked again</Badge>
                        ) : row.acknowledged ? (
                          <Badge tone="success">Confirmed</Badge>
                        ) : (
                          <Badge tone="warning">Outstanding</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>
      </div>
    </Card>
  )
}

function Total({
  label,
  value,
  sub,
  emphasis = false,
}: {
  label: string
  value: number
  sub?: string
  emphasis?: boolean
}) {
  return (
    <div className="border-line/70 bg-raise rounded-control border px-3 py-2.5">
      <dt className="text-faint text-[0.625rem] font-semibold tracking-wide uppercase">{label}</dt>
      <dd
        className={
          emphasis
            ? 'font-display text-warning mt-1 text-xl font-extrabold'
            : 'font-display text-ink mt-1 text-xl font-extrabold'
        }
      >
        {value}
        {sub ? <span className="text-muted block text-xs font-medium">{sub}</span> : null}
      </dd>
    </div>
  )
}

function BreakdownList({ title, items }: { title: string; items: Breakdown[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="text-faint text-[0.6875rem] font-semibold tracking-wide uppercase">{title}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.label} className="text-sm">
            <span className="text-ink">{item.label}</span>
            <span className="text-muted block text-xs">
              {item.viewed}/{item.targeted} read
              {item.acknowledged > 0 ? ` · ${item.acknowledged} confirmed` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
