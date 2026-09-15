import { describe, expect, it } from 'vitest'
import { csvCell, csvFileName, toCsv } from '@/lib/csv'

/** Spreadsheet-safe CSV: nothing a person typed can run as a formula. */

describe('csv cells', () => {
  it('neutralises anything a spreadsheet would treat as a formula', () => {
    for (const dangerous of [
      '=HYPERLINK("http://x","click")',
      '+1+1',
      '-2+3',
      '@SUM(A1)',
      '\tcmd',
      '\rcmd',
      '|calc',
      '%0A',
    ]) {
      const cell = csvCell(dangerous)
      const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell
      expect(unquoted.startsWith("'"), dangerous).toBe(true)
    }
  })

  it('writes real numbers as numbers, including negative ones', () => {
    expect(csvCell(-4)).toBe('-4')
    expect(csvCell(38.5)).toBe('38.5')
    expect(csvCell(Number.NaN)).toBe('')
  })

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Riverside, Sacramento')).toBe('"Riverside, Sacramento"')
    expect(csvCell('She said "hi"')).toBe('"She said ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(' padded')).toBe('" padded"')
  })

  it('writes empty values and yes/no', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(true)).toBe('Yes')
  })
})

describe('csv files', () => {
  it('has a byte-order mark, a header row and CRLF lines', () => {
    const csv = toCsv(
      [
        { header: 'Person', value: (r: { name: string; n: number }) => r.name },
        { header: 'Overdue', value: (r) => r.n },
      ],
      [
        { name: 'Elodie Garnier', n: 2 },
        { name: '=cmd|"/c calc"!A1', n: 0 },
      ],
    )
    expect(csv.startsWith('﻿Person,Overdue\r\n')).toBe(true)
    expect(csv).toContain('Elodie Garnier,2\r\n')
    expect(csv).toContain(`"'=cmd|""/c calc""!A1",0\r\n`)
  })

  it('makes safe file names', () => {
    expect(csvFileName('Harbor & Vine', 'training', '2026-09-14')).toBe(
      'harbor-vine-training-2026-09-14.csv',
    )
    expect(csvFileName('../../etc')).toBe('etc.csv')
  })
})
