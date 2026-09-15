import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { localDateOf } from '@/modules/scheduling/time'
import { buildReport } from '@/modules/reports/builders'
import { REPORT_KEYS, parseReportFilters } from '@/modules/reports/filters'
import { REPORT_META } from '@/modules/reports/model'
import { canSeeReport, canUseReports } from '@/modules/reports/scope'
import { organizationTimeZone } from '@/modules/training/records'
import { Card, PageHeader, TextLink } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { StatTile } from '@/ui/patterns/stat-tile'

export const metadata: Metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

/**
 * Reports: the exceptions worth acting on, across the business. Each number
 * opens the report and the list behind it.
 */
export default async function ReportsPage() {
  const { actor } = await requireActorContext()
  if (!canUseReports(actor)) return <PermissionDenied capabilityLabel="Reporting" />
  const visible = REPORT_KEYS.filter((k) => canSeeReport(actor, k))
  const reports = await withTenant(actor.organizationId, async (tx) => {
    const today = localDateOf(new Date(), await organizationTimeZone(tx, actor.organizationId))
    const filters = parseReportFilters({}, today)
    return Promise.all(
      visible.map(async (key) => (await buildReport(tx, actor, key, filters)).report),
    )
  })

  return (
    <>
      <PageHeader
        title="Reports"
        description="The last 30 days, for the locations you are responsible for. Open a report to change the period or narrow it down."
      />
      <div className="flex flex-col gap-6">
        {reports.map((report) => (
          <Card as="section" key={report.key} className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-ink text-lg font-bold">
                {REPORT_META[report.key].title}
              </h2>
              <TextLink href={`/app/reports/${report.key}`} className="text-sm">
                Open report
              </TextLink>
            </div>
            <p className="text-muted mt-1 text-sm">{REPORT_META[report.key].description}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {report.headlines.slice(0, 4).map((h) => (
                <StatTile
                  key={h.label}
                  label={h.label}
                  value={h.value}
                  detail={h.detail}
                  tone={h.tone}
                  href={`/app/reports/${report.key}#${h.tableId}`}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
