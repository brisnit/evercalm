/*
 * CSV FOR PEOPLE WHO OPEN IT IN A SPREADSHEET.
 *
 * Two dangers, both handled here so no report has to remember them:
 *
 *   FORMULA INJECTION  A cell a spreadsheet reads as a formula runs when the
 *                      file is opened. Any text value starting with = + - @,
 *                      a tab, a carriage return, | or % is prefixed with a
 *                      single quote, so it is shown as the text someone typed.
 *                      Genuine numbers are written as numbers.
 *   QUOTING            Commas, quotes and line breaks are quoted per RFC 4180.
 *
 * Files start with a UTF-8 byte-order mark so accented names ("Beltrán")
 * survive being opened in Excel, and use CRLF line endings.
 */

export type CsvValue = string | number | boolean | null | undefined

export interface CsvColumn<T> {
  header: string
  value: (row: T) => CsvValue
}

const FORMULA_START = /^[=+\-@\t\r|%]/

/** One cell, neutralised and quoted as needed. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  let text: string
  if (typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : ''
  } else if (typeof value === 'boolean') {
    text = value ? 'Yes' : 'No'
  } else {
    text = value
    if (FORMULA_START.test(text)) text = `'${text}`
  }
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(',')),
  ]
  return `﻿${lines.join('\r\n')}\r\n`
}

/** A safe file name: letters, digits and dashes only. */
export function csvFileName(...parts: string[]): string {
  const stem = parts
    .map((p) =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean)
    .join('-')
  return `${stem || 'export'}.csv`
}
