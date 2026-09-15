import type { ReportKey } from './filters'

/*
 * WHAT A REPORT IS.
 *
 * Headline figures, each pointing at the table that explains it, and tables
 * whose rows link to the record that produced them. A CSV export is one of
 * these tables, cell for cell, so the file a manager downloads is exactly what
 * the screen showed.
 *
 * Cells are display text or numbers - never internal ids, and never a
 * sensitive HR field.
 */

export type Tone = 'neutral' | 'attention' | 'urgent' | 'good'

export interface Headline {
  label: string
  value: number | string
  detail: string
  tone: Tone
  /** The table that lists what this number counts. */
  tableId: string
}

export interface ReportColumn {
  key: string
  header: string
  numeric?: boolean
}

export interface ReportRow {
  cells: Record<string, string | number | null>
  /** Where to act on this row, inside EverCalm. Not exported. */
  href?: string
}

export interface ReportTable {
  id: string
  title: string
  description: string
  columns: ReportColumn[]
  rows: ReportRow[]
  empty: string
  /** Rows are capped on screen; the export always has all of them. */
  shownLimit?: number
}

export interface Report {
  key: ReportKey
  title: string
  description: string
  headlines: Headline[]
  tables: ReportTable[]
  /** Plain-language caveats: a partial location view, approximations. */
  notes: string[]
}

export const REPORT_META: Record<ReportKey, { title: string; description: string }> = {
  people: {
    title: 'People and compliance',
    description:
      'Onboarding that is stuck, credentials that are lapsing, confirmations people owe, and who joined or left.',
  },
  training: {
    title: 'Training',
    description:
      'Overdue training, practicals waiting for sign-off, people out of knowledge-check attempts, and what was completed.',
  },
  schedule: {
    title: 'Schedule and coverage',
    description:
      'Shifts without people, time off, swaps and claims, and shifts that clash with approved time off.',
  },
  operations: {
    title: 'Shift operations',
    description:
      'Required work that was skipped, blocked work, verification that is waiting, and handoffs nobody has followed up.',
  },
  communications: {
    title: 'Communication',
    description:
      'What was sent, who has read and confirmed it, what is overdue, and what could not be delivered.',
  },
}
