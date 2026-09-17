import type { Actor } from '@/server/authz/actor'
import type { AttentionItem } from '@/modules/reports/attention'
import type { ToolIconName } from '@/ui/patterns/tool-icon'
import {
  OPERATIONS_CAPABILITIES,
  SCHEDULING_CAPABILITIES,
  TRAINING_CAPABILITIES,
  allowed,
  type NavItem,
} from './navigation'

/*
 * THE ADMINISTRATION LAUNCHER.
 *
 * Home is the tools, not a to-do list. Each card is shown only to someone who
 * can open that section - the same rule as the navigation - and carries at
 * most one line: what needs a decision there, or else one calm fact. The
 * figures come from the attention queue, which is already scoped to the
 * locations and capabilities of the person looking.
 */

export interface LauncherTool {
  key: string
  href: string
  label: string
  icon: ToolIconName
  status: string | null
  tone: 'calm' | 'attention'
}

interface ToolDefinition {
  key: string
  href: string
  label: string
  icon: ToolIconName
  requires: NavItem['requires']
  /** Attention items whose destination starts with one of these belong here. */
  owns: readonly string[]
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    key: 'people',
    href: '/app/people',
    label: 'People',
    icon: 'people',
    requires: 'people.view',
    owns: ['/app/people', '/app/reports/people'],
  },
  {
    key: 'onboarding',
    href: '/app/onboarding',
    label: 'Onboarding',
    icon: 'onboarding',
    requires: 'onboarding.view_progress',
    owns: ['/app/onboarding'],
  },
  {
    key: 'schedule',
    href: '/app/schedule',
    label: 'Schedule',
    icon: 'calendar',
    requires: SCHEDULING_CAPABILITIES,
    owns: ['/app/schedule', '/app/reports/schedule'],
  },
  {
    key: 'training',
    href: '/app/training',
    label: 'Training',
    icon: 'book',
    requires: TRAINING_CAPABILITIES,
    owns: ['/app/training', '/app/reports/training'],
  },
  {
    key: 'operations',
    href: '/app/operations',
    label: 'Operations',
    icon: 'checklist',
    requires: OPERATIONS_CAPABILITIES,
    owns: ['/app/operations', '/app/reports/operations'],
  },
  {
    key: 'communication',
    href: '/app/comms',
    label: 'Communication',
    icon: 'megaphone',
    requires: 'announcement.create',
    owns: ['/app/comms', '/app/reports/communications'],
  },
  {
    key: 'settings',
    href: '/app/settings',
    label: 'Settings',
    icon: 'settings',
    requires: 'org.view',
    owns: ['/app/settings'],
  },
]

export function launcherTools(
  actor: Actor,
  attention: readonly AttentionItem[],
  calm: Partial<Record<string, string | null>> = {},
): LauncherTool[] {
  return TOOLS.filter((tool) => allowed(actor, tool.requires)).map((tool) => {
    const mine = attention.filter((item) =>
      tool.owns.some(
        (prefix) =>
          item.href === prefix ||
          item.href.startsWith(`${prefix}/`) ||
          item.href.startsWith(`${prefix}#`) ||
          item.href.startsWith(`${prefix}?`),
      ),
    )
    const status = attentionLine(mine)
    return {
      key: tool.key,
      href: tool.href,
      label: tool.label,
      icon: tool.icon,
      status: status ?? calm[tool.key] ?? null,
      tone: status ? 'attention' : 'calm',
    }
  })
}

/** "Time off to decide: 2", or "5 things need you" when there are several kinds. */
export function attentionLine(items: readonly AttentionItem[]): string | null {
  if (items.length === 0) return null
  if (items.length === 1) return `${items[0]!.label}: ${items[0]!.count}`
  const total = items.reduce((sum, item) => sum + item.count, 0)
  return `${total} things need you`
}

/** The compact summary on Home: the total, and at most three figures. */
export function attentionSummary(items: readonly AttentionItem[]) {
  return {
    total: items.reduce((sum, item) => sum + item.count, 0),
    kinds: items.length,
    urgent: items.some((item) => item.tone === 'urgent'),
    top: items.slice(0, 3).map((item) => ({ key: item.key, count: item.count, label: item.label })),
  }
}
