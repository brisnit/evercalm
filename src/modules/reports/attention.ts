import type { Tx } from '@/server/db'
import type { Actor } from '@/server/authz/actor'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { localDateOf } from '@/modules/scheduling/time'
import { organizationTimeZone } from '@/modules/training/records'
import { buildReport } from './builders'
import { REPORT_KEYS, parseReportFilters, type ReportKey } from './filters'
import type { Headline } from './model'
import { canSeeReport } from './scope'

/*
 * WHAT NEEDS A MANAGER, ACROSS THE PRODUCT.
 *
 * The overview's queue. It reuses the reports' own headline figures, so every
 * count is scoped exactly as the report is: the locations this person may see,
 * the capabilities they hold. Only figures that ask for a decision or an
 * intervention appear, and each points at the page where it is dealt with -
 * falling back to the report when that page is not theirs to open.
 */

export interface AttentionItem {
  key: string
  label: string
  detail: string
  count: number
  tone: 'urgent' | 'attention'
  href: string
  area: string
}

const AREA: Record<ReportKey, string> = {
  people: 'People',
  training: 'Training',
  schedule: 'Schedule',
  operations: 'Shift work',
  communications: 'Messages',
}

/** Figures that are information, not a decision. */
const NOT_A_DECISION = new Set([
  'Onboarding completed',
  'Completed',
  'Messages sent',
  'Not yet read',
  'Required, not finished',
])

function destination(actor: Actor, key: ReportKey, h: Headline): string {
  const report = `/app/reports/${key}#${h.tableId}`
  const any = (c: Parameters<typeof canAtAnyLocation>[1]) => canAtAnyLocation(actor, c)
  switch (h.label) {
    case 'Time off to decide':
    case 'Swaps to decide':
      return any('timeoff.decide') || any('swap.decide') ? '/app/schedule/requests' : report
    case 'Shifts without anyone':
    case 'Clashes with time off':
      return any('schedule.view_all') ? '/app/schedule' : report
    case 'Blocked':
    case 'Waiting to verify':
    case 'Required work skipped':
      return any('checklist.view_runs') ? '/app/operations' : report
    case 'Handoffs not followed up':
      return any('checklist.view_runs') || any('handoff.manage')
        ? '/app/operations/handoffs'
        : report
    case 'Waiting for sign-off':
      return any('skill.verify') ? '/app/training/sign-offs' : report
    case 'Overdue':
    case 'Out of attempts':
      return any('training.view_progress_team') || any('training.view_progress_org')
        ? '/app/training/progress'
        : report
    case 'Onboarding blocked':
    case 'Onboarding overdue':
      return any('onboarding.view_progress') ? '/app/onboarding' : report
    case 'Could not deliver':
      return can(actor, 'org.view') ? '/app/settings/status' : report
    default:
      return report
  }
}

export async function attentionItems(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<AttentionItem[]> {
  const keys = REPORT_KEYS.filter((k) => canSeeReport(actor, k))
  if (keys.length === 0) return []
  const today = localDateOf(now, await organizationTimeZone(tx, actor.organizationId))
  const filters = parseReportFilters({}, today)
  const items: AttentionItem[] = []
  for (const key of keys) {
    try {
      const { report } = await buildReport(tx, actor, key, filters, { now })
      for (const h of report.headlines) {
        const count = typeof h.value === 'number' ? h.value : Number.parseInt(String(h.value), 10)
        if (!Number.isFinite(count) || count <= 0) continue
        if (h.tone !== 'urgent' && h.tone !== 'attention') continue
        if (NOT_A_DECISION.has(h.label)) continue
        items.push({
          key: `${key}:${h.label}`,
          label: h.label,
          detail: h.detail,
          count,
          tone: h.tone,
          href: destination(actor, key, h),
          area: AREA[key],
        })
      }
    } catch (error) {
      if (error instanceof ForbiddenError) continue
      throw error
    }
  }
  return items.sort((a, b) =>
    a.tone === b.tone ? b.count - a.count : a.tone === 'urgent' ? -1 : 1,
  )
}
