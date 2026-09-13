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
  requires: Capability | null
}

const ITEMS: NavItem[] = [
  { href: '/app', label: 'Overview', requires: null },
  { href: '/app/people', label: 'People', requires: 'people.view' },
  { href: '/app/onboarding', label: 'Onboarding', requires: 'onboarding.view_progress' },
  { href: '/app/comms', label: 'Communication', requires: 'announcement.create' },
  { href: '/app/settings', label: 'Settings', requires: 'org.view' },
]

export function visibleNavItems(actor: Actor): NavItem[] {
  return ITEMS.filter((item) => item.requires === null || canAtAnyLocation(actor, item.requires))
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
  return SETTINGS_NAV.filter(
    (item) => item.requires === null || canAtAnyLocation(actor, item.requires),
  )
}
