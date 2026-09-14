import type { Capability } from '@/server/authz'
import type { Actor } from '@/server/authz/actor'
import { canAtAnyLocation } from '@/server/authz/can'

/**
 * Navigation is derived from capabilities, never hard-coded per role.
 *
 * Two rules this list obeys:
 *   1. Every entry points at a page that exists and works.
 *   2. `requires: null` means the page is safe for anyone signed in; the page
 *      itself still authorizes anything it shows.
 *
 * Hiding an entry is a courtesy. The page's own server-side check is the gate,
 * and there is a browser test that proves navigating directly to a hidden
 * route is still refused.
 */

export interface NavItem {
  href: string
  label: string
  /** One capability, ANY of several, or null for anyone signed in. */
  requires: Capability | readonly Capability[] | null
}

/**
 * Everything that makes some part of scheduling reachable. HR decides time
 * off without building schedules; a Scheduler builds them without deciding
 * people matters. Either is enough to open the section - each page then asks
 * for exactly what it shows.
 */
export const SCHEDULING_CAPABILITIES: readonly Capability[] = [
  'schedule.view_all',
  'schedule.draft',
  'schedule.publish',
  'schedule.manage_templates',
  'availability.view_team',
  'timeoff.decide',
  'swap.decide',
  'openshift.manage',
]

/** Everything that opens some part of training administration. */
export const TRAINING_CAPABILITIES: readonly Capability[] = [
  'training.author',
  'training.publish',
  'training.assign',
  'training.view_progress_team',
  'training.view_progress_org',
  'skill.verify',
]

function allowed(actor: Actor, requires: NavItem['requires']): boolean {
  if (requires === null) return true
  const list: readonly Capability[] = typeof requires === 'string' ? [requires] : requires
  return list.some((capability) => canAtAnyLocation(actor, capability))
}

const ITEMS: NavItem[] = [
  { href: '/app', label: 'Overview', requires: null },
  { href: '/app/people', label: 'People', requires: 'people.view' },
  { href: '/app/onboarding', label: 'Onboarding', requires: 'onboarding.view_progress' },
  { href: '/app/comms', label: 'Communication', requires: 'announcement.create' },
  { href: '/app/schedule', label: 'Schedule', requires: SCHEDULING_CAPABILITIES },
  { href: '/app/training', label: 'Training', requires: TRAINING_CAPABILITIES },
  { href: '/app/settings', label: 'Settings', requires: 'org.view' },
]

export function visibleNavItems(actor: Actor): NavItem[] {
  return ITEMS.filter((item) => allowed(actor, item.requires))
}

/** True when the person has no administrative capability at all. */
export function isEmployeeOnly(actor: Actor): boolean {
  return actor.grants.every((g) => g.capabilities.size === 0)
}

/** Sub-navigation inside Settings. */
export const SETTINGS_NAV: NavItem[] = [
  { href: '/app/settings', label: 'Organization', requires: 'org.view' },
  { href: '/app/settings/structure', label: 'Structure', requires: 'org.view' },
  { href: '/app/settings/values', label: 'Values & standards', requires: 'org.view' },
  { href: '/app/settings/audit', label: 'Audit log', requires: 'org.view_audit' },
]

export function visibleSettingsNav(actor: Actor): NavItem[] {
  return SETTINGS_NAV.filter((item) => allowed(actor, item.requires))
}

/** Sub-navigation inside Schedule. */
export const SCHEDULE_NAV: NavItem[] = [
  { href: '/app/schedule', label: 'Week', requires: 'schedule.view_all' },
  {
    href: '/app/schedule/requests',
    label: 'Requests',
    requires: ['timeoff.decide', 'swap.decide', 'openshift.manage'],
  },
  { href: '/app/schedule/availability', label: 'Availability', requires: 'availability.view_team' },
  { href: '/app/schedule/templates', label: 'Templates', requires: 'schedule.view_all' },
]

export function visibleScheduleNav(actor: Actor): NavItem[] {
  return SCHEDULE_NAV.filter((item) => allowed(actor, item.requires))
}

/** Sub-navigation inside Training. */
export const TRAINING_NAV: NavItem[] = [
  { href: '/app/training', label: 'Courses', requires: TRAINING_CAPABILITIES },
  {
    href: '/app/training/progress',
    label: 'Progress',
    requires: ['training.view_progress_team', 'training.view_progress_org'],
  },
  { href: '/app/training/sign-offs', label: 'Sign-offs', requires: 'skill.verify' },
]

export function visibleTrainingNav(actor: Actor): NavItem[] {
  return TRAINING_NAV.filter((item) => allowed(actor, item.requires))
}
