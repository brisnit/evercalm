/**
 * CSV parsing, validation, and safe export.
 *
 * Deliberately dependency-free and PURE: no database, no tenant context, no
 * IO. That makes every rule here exhaustively unit-testable, which matters
 * because this is the one place in EverCalm that ingests a file somebody else
 * produced.
 *
 * The database-aware half of importing (matching locations, detecting existing
 * colleagues, writing rows) lives in import-service.ts.
 */

export const MAX_IMPORT_ROWS = 500
export const MAX_IMPORT_BYTES = 1024 * 1024 // 1 MB
export const ACCEPTED_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain']

/** The fields a column can be mapped to. */
export const IMPORT_FIELDS = [
  'displayName',
  'email',
  'jobTitle',
  'location',
  'jobRole',
  'manager',
  'hiredOn',
  'phone',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const REQUIRED_FIELDS: ImportField[] = ['displayName', 'email']

export const FIELD_LABELS: Record<ImportField, string> = {
  displayName: 'Full name',
  email: 'Email',
  jobTitle: 'Job title',
  location: 'Location',
  jobRole: 'Job role',
  manager: 'Manager (name or email)',
  hiredOn: 'Hire date',
  phone: 'Phone',
}

/** Header spellings we recognise automatically, all lower-cased. */
const HEADER_ALIASES: Record<string, ImportField> = {
  name: 'displayName',
  'full name': 'displayName',
  'employee name': 'displayName',
  'display name': 'displayName',
  email: 'email',
  'email address': 'email',
  'e-mail': 'email',
  'work email': 'email',
  'job title': 'jobTitle',
  title: 'jobTitle',
  position: 'jobTitle',
  location: 'location',
  site: 'location',
  store: 'location',
  salon: 'location',
  restaurant: 'location',
  branch: 'location',
  'job role': 'jobRole',
  role: 'jobRole',
  'primary role': 'jobRole',
  manager: 'manager',
  'reports to': 'manager',
  supervisor: 'manager',
  'hire date': 'hiredOn',
  'start date': 'hiredOn',
  hired: 'hiredOn',
  'hired on': 'hiredOn',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * A small RFC 4180 parser: quoted fields, escaped quotes, CR/LF or LF, and
 * embedded newlines inside quotes.
 *
 * Written rather than imported because the rules are few and the dependency
 * surface for "parse a CSV somebody emailed you" is not worth it.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // A leading UTF-8 BOM is common from Excel and would corrupt the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  while (i < input.length) {
    const char = input[i]!

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\r') {
      i += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }

    field += char
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop only TRAILING blank rows - the final newline every text editor adds.
  // Interior blank rows are kept so that line numbers in error messages match
  // the line numbers a person sees in their spreadsheet.
  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell.trim().length === 0)) {
    rows.pop()
  }
  return rows
}

/** True when a parsed row has no content at all. */
export function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim().length === 0)
}

export interface HeaderDetection {
  headers: string[]
  /** Header index -> field, for the ones we recognised. */
  mapping: Record<number, ImportField>
  unmapped: string[]
}

export function detectHeaders(headerRow: string[]): HeaderDetection {
  const mapping: Record<number, ImportField> = {}
  const unmapped: string[] = []
  const used = new Set<ImportField>()

  for (const [index, raw] of headerRow.entries()) {
    const key = raw.trim().toLowerCase()
    const field = HEADER_ALIASES[key]
    if (field && !used.has(field)) {
      mapping[index] = field
      used.add(field)
    } else if (raw.trim().length > 0) {
      unmapped.push(raw.trim())
    }
  }

  return { headers: headerRow.map((h) => h.trim()), mapping, unmapped }
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

/** Lower-cased and trimmed. Comparisons and duplicate checks use this form. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value)
  return email.length > 0 && email.length <= 200 && EMAIL_RE.test(email)
}

/**
 * Accepts ISO, US, and European orderings, plus common written months.
 *
 * An ambiguous value like 03/04/2026 is read as US month-first, because the
 * pilot is US-based - and the preview shows the parsed date back so a mistake
 * is visible before anything is imported rather than discovered later.
 */
export function parseHireDate(value: string): { date: string | null; error: string | null } {
  const raw = value.trim()
  if (raw.length === 0) return { date: null, error: null }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const slashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw)
  if (slashed) {
    const first = Number(slashed[1])
    const second = Number(slashed[2])
    const year = Number(slashed[3])
    // Unambiguous when the first part cannot be a month.
    if (first > 12 && second <= 12) return buildDate(year, second, first)
    return buildDate(year, first, second)
  }

  const written = new Date(`${raw} UTC`)
  if (!Number.isNaN(written.getTime())) {
    return { date: written.toISOString().slice(0, 10), error: null }
  }

  return { date: null, error: `Could not read "${raw}" as a date. Use YYYY-MM-DD.` }
}

function buildDate(
  year: number,
  month: number,
  day: number,
): { date: string | null; error: string | null } {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { date: null, error: 'That date does not exist.' }
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { date: null, error: 'That date does not exist.' }
  }
  if (year < 1900 || year > 2200) return { date: null, error: 'That year looks wrong.' }
  return { date: date.toISOString().slice(0, 10), error: null }
}

// ---------------------------------------------------------------------------
// Safe CSV output
// ---------------------------------------------------------------------------

/**
 * Neutralise spreadsheet formula injection.
 *
 * A cell beginning with =, +, - or @ is executed as a formula by Excel,
 * Sheets and LibreOffice when the file is opened. Since the error report
 * echoes values that came from an untrusted upload, a malicious row could
 * otherwise turn our own error report into an attack on whoever opens it.
 *
 * Prefixing with a single quote is the accepted mitigation: spreadsheets treat
 * the cell as text, and the quote is not shown in the cell.
 */
export function escapeCsvCell(value: string): string {
  const raw = value ?? ''
  // Tab and carriage return are included because some spreadsheets strip
  // leading whitespace before deciding whether a cell is a formula.
  const dangerous = /^[\t\r ]*[=+\-@]/.test(raw)
  const neutralised = dangerous ? `'${raw}` : raw
  if (/[",\n\r]/.test(neutralised)) {
    return `"${neutralised.replace(/"/g, '""')}"`
  }
  return neutralised
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

/** The blank file an administrator downloads to fill in. */
export function importTemplateCsv(): string {
  return toCsv([
    ['Full name', 'Email', 'Job title', 'Location', 'Job role', 'Manager', 'Hire date'],
    [
      'Alex Rivera',
      'alex.rivera@example.com',
      'Server',
      'Riverside',
      'Server',
      'marcus@harborvine.test',
      '2026-09-01',
    ],
  ])
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

export interface RawImportRow {
  /** 1-based line in the file, counting the header, for error messages. */
  lineNumber: number
  values: Partial<Record<ImportField, string>>
}

export function shapeRows(
  rows: string[][],
  mapping: Record<number, ImportField>,
): { rows: RawImportRow[]; error: string | null } {
  const [, ...body] = rows

  // Blank lines are skipped, but only AFTER their line number has been fixed,
  // so a stray empty row in the middle of a file does not shift every
  // subsequent error message onto the wrong line.
  const shaped = body
    .map((cells, index) => ({ cells, lineNumber: index + 2 }))
    .filter(({ cells }) => !isBlankRow(cells))
    .map(({ cells, lineNumber }) => {
      const values: Partial<Record<ImportField, string>> = {}
      for (const [columnIndex, field] of Object.entries(mapping)) {
        const cell = cells[Number(columnIndex)]
        if (cell !== undefined && cell.trim().length > 0) values[field] = cell.trim()
      }
      return { lineNumber, values }
    })

  if (shaped.length === 0) return { rows: [], error: 'That file has a header but no rows.' }
  if (shaped.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      error: `That file has ${shaped.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`,
    }
  }

  return { rows: shaped, error: null }
}

export interface RowIssue {
  field: ImportField | 'row'
  message: string
}

/**
 * Everything checkable without the database: presence, format, and duplicates
 * within the file itself.
 */
export function validateRowsStandalone(rows: RawImportRow[]): Map<number, RowIssue[]> {
  const issues = new Map<number, RowIssue[]>()
  const add = (line: number, issue: RowIssue) => {
    const list = issues.get(line) ?? []
    list.push(issue)
    issues.set(line, list)
  }

  const seenEmails = new Map<string, number>()

  for (const row of rows) {
    const name = row.values.displayName?.trim() ?? ''
    if (name.length < 2) {
      add(row.lineNumber, { field: 'displayName', message: 'A full name is required.' })
    } else if (name.length > 120) {
      add(row.lineNumber, { field: 'displayName', message: 'That name is too long.' })
    }

    const email = row.values.email ?? ''
    if (email.length === 0) {
      add(row.lineNumber, { field: 'email', message: 'An email address is required.' })
    } else if (!isValidEmail(email)) {
      add(row.lineNumber, { field: 'email', message: `"${email}" is not a valid email address.` })
    } else {
      const normalized = normalizeEmail(email)
      const firstSeen = seenEmails.get(normalized)
      if (firstSeen !== undefined) {
        add(row.lineNumber, {
          field: 'email',
          message: `Duplicate of line ${firstSeen} in this file.`,
        })
      } else {
        seenEmails.set(normalized, row.lineNumber)
      }
    }

    if (row.values.hiredOn) {
      const { error } = parseHireDate(row.values.hiredOn)
      if (error) add(row.lineNumber, { field: 'hiredOn', message: error })
    }

    if (row.values.jobTitle && row.values.jobTitle.length > 120) {
      add(row.lineNumber, { field: 'jobTitle', message: 'That job title is too long.' })
    }
  }

  return issues
}
