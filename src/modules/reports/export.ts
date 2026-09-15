import type { Tx } from '@/server/db'
import type { Actor } from '@/server/authz'
import { accessibleLocationIds, canAtAnyLocation } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { csvFileName, toCsv } from '@/lib/csv'
import { NotFoundError } from '@/lib/errors'
import { localDateOf } from '@/modules/scheduling/time'
import { organizationTimeZone } from '@/modules/training/records'
import { buildReport } from './builders'
import type { ReportKey } from './filters'
import { parseReportFilters } from './filters'

/*
 * EXPORTING ONE REPORT TABLE AS CSV.
 *
 * The same builder, filters and scope as the page, further limited to the
 * locations where the person holds report.export. Cells are neutralised
 * against formula injection by toCsv, rows carry no internal ids (the report
 * model never has them), and dates are calendar dates. Every export is
 * audited with its filters and row count, inside the same transaction.
 */

export interface ExportResult {
  csv: string
  fileName: string
  rows: number
}

export async function exportReport(
  tx: Tx,
  actor: Actor,
  key: ReportKey,
  query: Partial<Record<'table' | 'location' | 'department' | 'role' | 'from' | 'to', string>>,
  now = new Date(),
): Promise<ExportResult> {
  if (!canAtAnyLocation(actor, 'report.export')) throw new NotFoundError('Not found')
  const today = localDateOf(now, await organizationTimeZone(tx, actor.organizationId))
  const filters = parseReportFilters(query, today)
  const { report } = await buildReport(tx, actor, key, filters, {
    now,
    restrictTo: accessibleLocationIds(actor, 'report.export'),
  })
  const table = report.tables.find((t) => t.id === query.table) ?? report.tables[0]!
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.REPORT_EXPORTED,
    summary: `Exported "${table.title}" from the ${report.title} report (${table.rows.length} ${table.rows.length === 1 ? 'row' : 'rows'})`,
    subjectType: 'report',
    subjectId: `${key}:${table.id}`,
    locationId: filters.locationId,
    metadata: {
      report: key,
      table: table.id,
      rows: table.rows.length,
      from: filters.from,
      to: filters.to,
      location: filters.locationId,
      department: filters.departmentId,
      role: filters.jobRoleId,
    },
  })
  const csv = toCsv(
    table.columns.map((c) => ({
      header: c.header,
      value: (row: (typeof table.rows)[number]) => row.cells[c.key] ?? null,
    })),
    table.rows,
  )
  return {
    csv,
    fileName: csvFileName('evercalm', key, table.id, filters.from, 'to', filters.to),
    rows: table.rows.length,
  }
}
