import { and, count, eq, gte, isNull } from 'drizzle-orm'
import {
  employmentJobRoles,
  employmentLocations,
  employments,
  jobRoles,
  locations,
} from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { ValidationError } from '@/lib/errors'
import { authorize } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { createInvitation } from '@/modules/invitations/service'
import { emailProvider } from '@/server/email'
import {
  MAX_IMPORT_ROWS,
  detectHeaders,
  normalizeEmail,
  parseCsv,
  parseHireDate,
  shapeRows,
  toCsv,
  validateRowsStandalone,
  type ImportField,
  type RawImportRow,
  type RowIssue,
} from './csv'

/**
 * EMPLOYEE CSV IMPORT.
 *
 * Security posture, stated once:
 *
 *  - **The organization comes from the session, never the file.** There is no
 *    code path that reads an organization id from a CSV. A column named
 *    `organization_id` is simply an unmapped column.
 *  - **Preview never writes.** It parses, validates, and returns. Nothing is
 *    created and no invitation is sent until an administrator confirms.
 *  - **Confirmation re-parses and re-validates the same text**, so the import
 *    path cannot be handed pre-approved rows that skip validation.
 *  - **One transaction.** Either every valid row is created or none is, so a
 *    failure halfway through cannot leave a half-imported directory.
 *  - **Row and rate limits** bound both the file and how often it can be run.
 *  - The error report escapes spreadsheet formulas - see `escapeCsvCell`.
 */

/** Imports one organization may run per rolling hour. */
const IMPORTS_PER_HOUR = 10

export interface PreviewRow {
  lineNumber: number
  displayName: string
  email: string
  jobTitle: string | null
  locationName: string | null
  locationId: string | null
  jobRoleName: string | null
  jobRoleId: string | null
  managerName: string | null
  managerEmploymentId: string | null
  hiredOn: string | null
  phone: string | null
  issues: RowIssue[]
  valid: boolean
}

export interface ImportPreview {
  headers: string[]
  mapping: Record<number, ImportField>
  unmappedHeaders: string[]
  rows: PreviewRow[]
  validCount: number
  invalidCount: number
  /** A problem with the file as a whole, rather than with a row. */
  fileError: string | null
}

function issue(field: RowIssue['field'], message: string): RowIssue {
  return { field, message }
}

/**
 * Parse and validate, against this tenant's real locations, roles and people.
 * Writes nothing.
 */
export async function previewImport(
  tx: Tx,
  actor: Actor,
  csvText: string,
  overrideMapping?: Record<number, ImportField>,
): Promise<ImportPreview> {
  authorize(actor, 'people.invite')

  const table = parseCsv(csvText)
  if (table.length === 0) {
    return {
      headers: [],
      mapping: {},
      unmappedHeaders: [],
      rows: [],
      validCount: 0,
      invalidCount: 0,
      fileError: 'That file is empty.',
    }
  }

  const detection = detectHeaders(table[0]!)
  const mapping = overrideMapping ?? detection.mapping

  const missing = (['displayName', 'email'] as ImportField[]).filter(
    (field) => !Object.values(mapping).includes(field),
  )
  if (missing.length > 0) {
    return {
      headers: detection.headers,
      mapping,
      unmappedHeaders: detection.unmapped,
      rows: [],
      validCount: 0,
      invalidCount: 0,
      fileError: `Map a column to ${missing.map((m) => (m === 'displayName' ? 'Full name' : 'Email')).join(' and ')} before continuing.`,
    }
  }

  const shaped = shapeRows(table, mapping)
  if (shaped.error) {
    return {
      headers: detection.headers,
      mapping,
      unmappedHeaders: detection.unmapped,
      rows: [],
      validCount: 0,
      invalidCount: 0,
      fileError: shaped.error,
    }
  }

  const standalone = validateRowsStandalone(shaped.rows)

  // --- tenant-scoped lookups. Every one is constrained to this organization.
  const tenantLocations = await tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.organizationId, actor.organizationId), isNull(locations.archivedAt)))

  const tenantRoles = await tx
    .select({ id: jobRoles.id, name: jobRoles.name })
    .from(jobRoles)
    .where(and(eq(jobRoles.organizationId, actor.organizationId), isNull(jobRoles.archivedAt)))

  const tenantPeople = await tx
    .select({
      id: employments.id,
      displayName: employments.displayName,
      email: employments.email,
    })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), isNull(employments.archivedAt)),
    )

  const locationByName = new Map(tenantLocations.map((l) => [l.name.trim().toLowerCase(), l]))
  const roleByName = new Map(tenantRoles.map((r) => [r.name.trim().toLowerCase(), r]))
  const personByEmail = new Map(
    tenantPeople.filter((p) => p.email).map((p) => [normalizeEmail(p.email!), p]),
  )
  const personByName = new Map(tenantPeople.map((p) => [p.displayName.trim().toLowerCase(), p]))

  const rows: PreviewRow[] = shaped.rows.map((raw: RawImportRow) => {
    const issues = [...(standalone.get(raw.lineNumber) ?? [])]
    const email = raw.values.email ? normalizeEmail(raw.values.email) : ''

    // Already employed HERE. Scoped to the tenant, so it can never reveal that
    // the address is used at another organization.
    if (email && personByEmail.has(email)) {
      issues.push(issue('email', `${personByEmail.get(email)!.displayName} already works here.`))
    }

    let locationId: string | null = null
    const locationName = raw.values.location ?? null
    if (locationName) {
      const match = locationByName.get(locationName.trim().toLowerCase())
      if (match) locationId = match.id
      else issues.push(issue('location', `No location called "${locationName}".`))
    }

    let jobRoleId: string | null = null
    const jobRoleName = raw.values.jobRole ?? null
    if (jobRoleName) {
      const match = roleByName.get(jobRoleName.trim().toLowerCase())
      if (match) jobRoleId = match.id
      else issues.push(issue('jobRole', `No job role called "${jobRoleName}".`))
    }

    let managerEmploymentId: string | null = null
    const managerRef = raw.values.manager ?? null
    if (managerRef) {
      const byEmail = personByEmail.get(normalizeEmail(managerRef))
      const byName = personByName.get(managerRef.trim().toLowerCase())
      const match = byEmail ?? byName
      if (match) managerEmploymentId = match.id
      else issues.push(issue('manager', `No colleague matching "${managerRef}".`))
    }

    const hire = raw.values.hiredOn
      ? parseHireDate(raw.values.hiredOn)
      : { date: null, error: null }

    return {
      lineNumber: raw.lineNumber,
      displayName: raw.values.displayName ?? '',
      email: raw.values.email ?? '',
      jobTitle: raw.values.jobTitle ?? null,
      locationName,
      locationId,
      jobRoleName,
      jobRoleId,
      managerName: managerRef,
      managerEmploymentId,
      hiredOn: hire.date,
      phone: raw.values.phone ?? null,
      issues,
      valid: issues.length === 0,
    }
  })

  return {
    headers: detection.headers,
    mapping,
    unmappedHeaders: detection.unmapped,
    rows,
    validCount: rows.filter((r) => r.valid).length,
    invalidCount: rows.filter((r) => !r.valid).length,
    fileError: null,
  }
}

export interface ImportOutcome {
  imported: number
  skipped: number
  invited: number
}

async function assertWithinRateLimit(tx: Tx, actor: Actor): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000)
  const [row] = await tx
    .select({ total: count() })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), gte(employments.createdAt, since)),
    )

  // Bounded by people created recently, which is the thing an import actually
  // produces, rather than by a counter somebody could reset.
  if ((row?.total ?? 0) >= MAX_IMPORT_ROWS * IMPORTS_PER_HOUR) {
    throw new ValidationError(
      {},
      'Too many people have been added in the last hour. Try again shortly.',
    )
  }
}

/**
 * Create employments for every valid row, in ONE transaction.
 *
 * Re-parses and re-validates the CSV rather than trusting anything the preview
 * produced, so the write path applies exactly the same rules the preview
 * showed. Invitations are created only when the administrator asked for them.
 */
export async function runImport(
  tx: Tx,
  actor: Actor,
  csvText: string,
  options: { mapping?: Record<number, ImportField>; sendInvitations: boolean; appUrl: string },
): Promise<ImportOutcome> {
  authorize(actor, 'people.invite')
  await assertWithinRateLimit(tx, actor)

  // Deliberately re-validated. The preview's output is never trusted as input.
  const preview = await previewImport(tx, actor, csvText, options.mapping)
  if (preview.fileError) throw new ValidationError({}, preview.fileError)

  const valid = preview.rows.filter((r) => r.valid)
  if (valid.length === 0) {
    throw new ValidationError({}, 'There are no valid rows to import.')
  }

  let invited = 0

  for (const row of valid) {
    const employmentId = newId()

    await tx.insert(employments).values({
      id: employmentId,
      // The tenant comes from the SESSION. No CSV column can influence it.
      organizationId: actor.organizationId,
      displayName: row.displayName.trim(),
      email: normalizeEmail(row.email),
      jobTitle: row.jobTitle,
      phone: row.phone,
      hiredOn: row.hiredOn,
      homeLocationId: row.locationId,
      managerEmploymentId: row.managerEmploymentId,
      // Imported people exist as records but cannot sign in until they accept
      // an invitation, so an import never silently creates accounts.
      status: 'invited',
    })

    if (row.locationId) {
      await tx.insert(employmentLocations).values({
        id: newId(),
        organizationId: actor.organizationId,
        employmentId,
        locationId: row.locationId,
      })
    }

    if (row.jobRoleId) {
      await tx.insert(employmentJobRoles).values({
        id: newId(),
        organizationId: actor.organizationId,
        employmentId,
        jobRoleId: row.jobRoleId,
        isPrimary: true,
      })
    }

    // Invitations are sent ONLY when the administrator asked for them at
    // confirmation. The preview never sends anything.
    if (options.sendInvitations) {
      const issued = await createInvitation(
        tx,
        actor,
        {
          email: row.email,
          displayName: row.displayName,
          jobTitle: row.jobTitle ?? undefined,
          roleKey: 'employee',
          scope: row.locationId ? 'location' : 'org',
          scopeLocationId: row.locationId,
          homeLocationId: row.locationId,
          locationIds: row.locationId ? [row.locationId] : [],
          jobRoleIds: row.jobRoleId ? [row.jobRoleId] : [],
          // Link to the record we just created rather than creating a second
          // person when they accept.
          targetEmploymentId: employmentId,
        },
        options.appUrl,
      )
      await emailProvider().send({
        to: row.email,
        subject: 'You have been added to your team on EverCalm',
        text: `${row.displayName},\n\nAccept your invitation: ${issued.acceptUrl}`,
      })
      invited += 1
    }
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EMPLOYEES_IMPORTED,
    summary: `Imported ${valid.length} ${valid.length === 1 ? 'person' : 'people'} from a CSV file`,
    subjectType: 'organization',
    subjectId: actor.organizationId,
    // Counts only. Audit metadata must not become a store of contact details.
    metadata: {
      imported: valid.length,
      skipped: preview.invalidCount,
      invitationsSent: invited,
    },
  })

  return {
    imported: valid.length,
    skipped: preview.invalidCount,
    invited,
  }
}

/**
 * The downloadable error report.
 *
 * Every cell goes through `escapeCsvCell`, so a row crafted to contain
 * `=HYPERLINK(...)` cannot execute when an administrator opens the report.
 */
export function errorReportCsv(preview: ImportPreview): string {
  const rows: string[][] = [['Line', 'Full name', 'Email', 'Problem']]
  for (const row of preview.rows) {
    if (row.valid) continue
    rows.push([
      String(row.lineNumber),
      row.displayName,
      row.email,
      row.issues.map((i) => i.message).join(' '),
    ])
  }
  return toCsv(rows)
}
