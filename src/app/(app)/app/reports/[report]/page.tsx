import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { accessibleLocationIds, canAtAnyLocation } from '@/server/authz/can'
import { localDateOf } from '@/modules/scheduling/time'
import { buildReport } from '@/modules/reports/builders'
import { filtersToQuery, isReportKey, parseReportFilters } from '@/modules/reports/filters'
import { REPORT_CAPABILITY } from '@/modules/reports/scope'
import { organizationTimeZone } from '@/modules/training/records'
import { BackLink, Card, CardHeader, PageHeader, ScrollArea } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { StatTile } from '@/ui/patterns/stat-tile'
import { SECONDARY_LINK_CLASS, SELECT_CLASS } from '../../training/_components/styles'

export const metadata: Metadata = { title: 'Report' }
export const dynamic = 'force-dynamic'

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { report: key } = await params
  if (!isReportKey(key)) notFound()
  const query = await searchParams
  const { actor } = await requireActorContext()

  const result = await withTenant(actor.organizationId, async (tx) => {
    const today = localDateOf(new Date(), await organizationTimeZone(tx, actor.organizationId))
    const filters = parseReportFilters(
      {
        location: query.location,
        department: query.department,
        role: query.role,
        from: query.from,
        to: query.to,
      },
      today,
    )
    return { filters, ...(await buildReport(tx, actor, key, filters)) }
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return null
    throw error
  })
  if (!result) return <PermissionDenied capabilityLabel="This report" />
  const { report, scope, filters } = result

  // Export is its own permission, and must cover every location in view.
  const exportScope = accessibleLocationIds(actor, 'report.export')
  const reportScope = accessibleLocationIds(actor, REPORT_CAPABILITY[key])
  const mayExport =
    canAtAnyLocation(actor, 'report.export') &&
    (exportScope === null || scope.locationIds.every((id) => exportScope.includes(id))) &&
    (reportScope !== null || exportScope === null || filters.locationId !== null)
  const qs = filtersToQuery(filters)

  return (
    <>
      <BackLink href="/app/reports">Reports</BackLink>
      <PageHeader title={report.title} description={report.description} />

      <form
        method="get"
        className="rounded-card border-line bg-raise mb-5 grid gap-3 border p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end"
      >
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          <span className="text-muted">Location</span>
          <select name="location" defaultValue={filters.locationId ?? ''} className={SELECT_CLASS}>
            <option value="">{scope.partial ? 'All of yours' : 'All locations'}</option>
            {scope.available.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          <span className="text-muted">Department</span>
          <select
            name="department"
            defaultValue={filters.departmentId ?? ''}
            className={SELECT_CLASS}
          >
            <option value="">All departments</option>
            {scope.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          <span className="text-muted">Job role</span>
          <select name="role" defaultValue={filters.jobRoleId ?? ''} className={SELECT_CLASS}>
            <option value="">All roles</option>
            {scope.jobRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          <span className="text-muted">From</span>
          <input type="date" name="from" defaultValue={filters.from} className={SELECT_CLASS} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          <span className="text-muted">To</span>
          <input type="date" name="to" defaultValue={filters.to} className={SELECT_CLASS} />
        </label>
        <button
          type="submit"
          className="rounded-control inline-flex min-h-11 items-center justify-center bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700"
        >
          Apply
        </button>
      </form>

      {report.notes.length > 0 ? (
        <ul className="text-muted mb-4 flex flex-col gap-1 text-sm">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <section aria-label="Headline figures" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {report.headlines.map((h) => (
          <StatTile
            key={h.label}
            label={h.label}
            value={h.value}
            detail={h.detail}
            tone={h.tone}
            href={`#${h.tableId}`}
          />
        ))}
      </section>

      <div className="flex flex-col gap-5">
        {report.tables.map((table) => {
          const shown = table.shownLimit ? table.rows.slice(0, table.shownLimit) : table.rows
          return (
            <Card as="section" key={table.id}>
              <div id={table.id} className="scroll-mt-4">
                <CardHeader
                  title={`${table.title} (${table.rows.length})`}
                  description={table.description}
                  action={
                    mayExport && table.rows.length > 0 ? (
                      <a
                        href={`/app/reports/${key}/export?table=${table.id}&${qs}`}
                        className={SECONDARY_LINK_CLASS}
                        download
                      >
                        Download CSV<span className="sr-only">: {table.title}</span>
                      </a>
                    ) : null
                  }
                />
              </div>
              {table.rows.length === 0 ? (
                <p className="text-muted p-5 text-sm">{table.empty}</p>
              ) : (
                <ScrollArea label={table.title}>
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <thead className="text-muted text-xs">
                      <tr className="border-line border-b">
                        {table.columns.map((c) => (
                          <th
                            key={c.key}
                            scope="col"
                            className={`min-w-[7.5rem] px-4 py-2.5 font-medium ${c.numeric ? 'text-right' : ''}`}
                          >
                            {c.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {shown.map((row, i) => (
                        <tr key={i}>
                          {table.columns.map((c, ci) => {
                            const value = row.cells[c.key]
                            const text =
                              value === null || value === undefined || value === ''
                                ? '—'
                                : String(value)
                            return (
                              <td
                                key={c.key}
                                className={`text-ink min-w-[7.5rem] px-4 py-2.5 align-top ${c.numeric ? 'text-right tabular-nums' : ''}`}
                              >
                                {ci === 0 && row.href ? (
                                  <Link
                                    href={row.href}
                                    className="font-medium underline-offset-4 hover:underline"
                                  >
                                    {text}
                                  </Link>
                                ) : (
                                  text
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {shown.length < table.rows.length ? (
                    <p className="text-muted border-line border-t px-4 py-2.5 text-xs">
                      Showing {shown.length} of {table.rows.length}. The CSV has all of them.
                    </p>
                  ) : null}
                </ScrollArea>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
