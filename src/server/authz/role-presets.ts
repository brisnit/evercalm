import type { Capability } from './capabilities'
import { isLocationScopable } from './capabilities'

/**
 * ROLE PRESETS.
 *
 * Presets are seeded into each organization as editable `roles` rows. They are
 * a starting point, not hard-coded authorization: every check in the codebase
 * asks for a capability, never for a role name. Shift Lead in particular is an
 * ordinary preset with a granular capability set and location scope - there is
 * no special-case branch for it anywhere.
 */

export const ROLE_KEYS = [
  'owner',
  'hr_admin',
  'general_manager',
  'scheduler',
  'training_manager',
  'shift_lead',
  'employee',
] as const

export type RoleKey = (typeof ROLE_KEYS)[number]

export type GrantScope = 'org' | 'location'

export interface RolePreset {
  readonly key: RoleKey
  readonly name: string
  readonly description: string
  /** The scope this role is normally granted at. An owner may override. */
  readonly defaultScope: GrantScope
  readonly capabilities: readonly Capability[]
}

const OWNER_CAPABILITIES: Capability[] = [
  'org.view',
  'org.update',
  'org.manage_locations',
  'org.manage_structure',
  'org.manage_roles',
  'org.view_audit',
  'billing.manage',
  'people.view',
  'people.view_sensitive',
  'people.invite',
  'people.update',
  'people.manage_employment',
  'people.separate',
  'people.export',
  'announcement.create',
  'announcement.publish',
  'announcement.publish_urgent',
  'announcement.view_receipts',
  'conversation.start',
  'conversation.moderate',
  'schedule.view_all',
  'schedule.draft',
  'schedule.publish',
  'schedule.manage_templates',
  'availability.view_team',
  'timeoff.decide',
  'swap.decide',
  'openshift.manage',
  'training.author',
  'training.publish',
  'training.assign',
  'training.view_progress_team',
  'training.view_progress_org',
  'skill.define',
  'skill.verify',
  'skill.revoke',
  'checklist.author',
  'checklist.view_runs',
  'checklist.verify',
  'checklist.reopen',
  'handoff.manage',
  'report.operations',
  'report.training',
  'report.people',
]

export const ROLE_PRESETS: Record<RoleKey, RolePreset> = {
  owner: {
    key: 'owner',
    name: 'Owner',
    description:
      'Company-wide oversight, culture and goals, high-risk approvals, billing, and permission governance.',
    defaultScope: 'org',
    capabilities: OWNER_CAPABILITIES,
  },

  hr_admin: {
    key: 'hr_admin',
    name: 'HR Administrator',
    description:
      'Employee records, policies, onboarding, leave, and offboarding. Holds sensitive employee information.',
    defaultScope: 'org',
    capabilities: [
      'org.view',
      'org.view_audit',
      'people.view',
      'people.view_sensitive',
      'people.invite',
      'people.update',
      'people.manage_employment',
      'people.separate',
      'people.export',
      'announcement.create',
      'announcement.publish',
      'announcement.publish_urgent',
      'announcement.view_receipts',
      'timeoff.decide',
      'training.assign',
      'training.view_progress_team',
      'training.view_progress_org',
      'report.training',
      'report.people',
    ],
  },

  general_manager: {
    key: 'general_manager',
    name: 'General Manager',
    description:
      'Daily operations at their location: staffing, communication, shift execution, coaching, and local training progress.',
    defaultScope: 'location',
    capabilities: [
      'people.view',
      'people.invite',
      'people.update',
      'people.manage_employment',
      'announcement.create',
      'announcement.publish',
      'announcement.publish_urgent',
      'announcement.view_receipts',
      'conversation.start',
      'schedule.view_all',
      'schedule.draft',
      'schedule.publish',
      'schedule.manage_templates',
      'availability.view_team',
      'timeoff.decide',
      'swap.decide',
      'openshift.manage',
      'training.assign',
      'training.view_progress_team',
      'skill.verify',
      'checklist.author',
      'checklist.view_runs',
      'checklist.verify',
      'checklist.reopen',
      'handoff.manage',
      'report.operations',
      'report.training',
    ],
  },

  scheduler: {
    key: 'scheduler',
    name: 'Scheduler',
    description:
      'Availability, shift templates, schedule creation and publication, open shifts, and swaps.',
    defaultScope: 'location',
    capabilities: [
      'people.view',
      'schedule.view_all',
      'schedule.draft',
      'schedule.publish',
      'schedule.manage_templates',
      'availability.view_team',
      'timeoff.decide',
      'swap.decide',
      'openshift.manage',
    ],
  },

  training_manager: {
    key: 'training_manager',
    name: 'Training Manager',
    description:
      'Curricula, courses, assignments, assessments, practical verification, and training reporting.',
    defaultScope: 'org',
    capabilities: [
      'people.view',
      'announcement.create',
      'announcement.publish',
      'announcement.view_receipts',
      'training.author',
      'training.publish',
      'training.assign',
      'training.view_progress_team',
      'training.view_progress_org',
      'skill.define',
      'skill.verify',
      'skill.revoke',
      'report.training',
    ],
  },

  shift_lead: {
    key: 'shift_lead',
    name: 'Shift Lead',
    description:
      'A keyholder who runs a shift without being a manager. Verifies checklists and passes work to the next shift.',
    defaultScope: 'location',
    capabilities: [
      'people.view',
      'announcement.view_receipts',
      'checklist.view_runs',
      'checklist.verify',
      'handoff.manage',
    ],
  },

  employee: {
    key: 'employee',
    name: 'Employee',
    description:
      'Personal onboarding, learning, availability, schedule, shift participation, and acknowledgements. Self-access needs no capability.',
    defaultScope: 'org',
    capabilities: [],
  },
}

export const ROLE_PRESET_LIST: readonly RolePreset[] = ROLE_KEYS.map((k) => ROLE_PRESETS[k])

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value)
}

/**
 * A location-scoped grant may only carry location-scopable capabilities.
 * Returns the capabilities that would be silently dropped - used to refuse a
 * grant rather than quietly narrowing it.
 */
export function nonLocationScopableCapabilities(capabilities: readonly Capability[]): Capability[] {
  return capabilities.filter((c) => !isLocationScopable(c))
}
