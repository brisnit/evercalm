/**
 * CAPABILITY REGISTRY.
 *
 * Capabilities are code constants, not database rows. A typo is a compile
 * error, and the set of capabilities can never drift from the code that
 * checks them.
 *
 * `locationScopable: true` means a grant limited to one location can carry
 * this capability. A capability that is NOT location-scopable (organization
 * settings, billing, permission management) can only ever be held org-wide -
 * enforcing that a location manager cannot reach organization-level controls.
 */

export type CapabilityGroup =
  | 'organization'
  | 'people'
  | 'communication'
  | 'scheduling'
  | 'learning'
  | 'operations'
  | 'reporting'

export interface CapabilityDefinition {
  readonly key: string
  readonly label: string
  readonly description: string
  readonly group: CapabilityGroup
  readonly locationScopable: boolean
  /**
   * Declared now, enforced now, but the feature that consumes it ships in a
   * later slice. Declaring these early is what lets messaging and scheduling
   * land without an authorization retrofit. Nothing in the UI offers them.
   */
  readonly plannedSlice?: number
}

function def<T extends Record<string, Omit<CapabilityDefinition, 'key'>>>(
  defs: T,
): { [K in keyof T]: CapabilityDefinition & { key: K } } {
  const out = {} as Record<string, CapabilityDefinition>
  for (const [key, value] of Object.entries(defs)) out[key] = { key, ...value }
  return out as { [K in keyof T]: CapabilityDefinition & { key: K } }
}

export const CAPABILITIES = def({
  // --- organization --------------------------------------------------------
  'org.view': {
    label: 'View organization settings',
    description: 'See organization profile, industry, and timezone.',
    group: 'organization',
    locationScopable: false,
  },
  'org.update': {
    label: 'Update organization settings',
    description: 'Change organization profile and defaults.',
    group: 'organization',
    locationScopable: false,
  },
  'org.manage_locations': {
    label: 'Manage locations',
    description: 'Create, rename, and archive locations.',
    group: 'organization',
    locationScopable: false,
  },
  'org.manage_structure': {
    label: 'Manage structure',
    description: 'Manage departments, teams, job roles, and stations.',
    group: 'organization',
    locationScopable: false,
  },
  'org.manage_roles': {
    label: 'Manage roles and permissions',
    description: 'Grant and revoke access. Owner-only, so nobody can widen their own access.',
    group: 'organization',
    locationScopable: false,
  },
  'org.view_audit': {
    label: 'View audit history',
    description: 'Read the append-only record of sensitive actions.',
    group: 'organization',
    locationScopable: false,
  },
  'billing.manage': {
    label: 'Manage billing',
    description: 'Subscription and payment settings.',
    group: 'organization',
    locationScopable: false,
    plannedSlice: 7,
  },

  // --- people --------------------------------------------------------------
  'people.view': {
    label: 'View people',
    description: 'See the employee directory and non-sensitive profile fields.',
    group: 'people',
    locationScopable: true,
  },
  'people.view_sensitive': {
    label: 'View sensitive employee information',
    description:
      'Date of birth, emergency contacts, and personal contact details. Deliberately withheld from General Managers.',
    group: 'people',
    locationScopable: true,
  },
  'people.invite': {
    label: 'Invite people',
    description: 'Send invitations to join the organization.',
    group: 'people',
    locationScopable: true,
  },
  'people.update': {
    label: 'Update people',
    description: 'Edit employee profile details.',
    group: 'people',
    locationScopable: true,
  },
  'people.manage_employment': {
    label: 'Manage employment',
    description: 'Change status, hire dates, and location assignment.',
    group: 'people',
    locationScopable: true,
  },
  'people.separate': {
    label: 'Separate an employee',
    description:
      'Offboarding. Requires a second distinct approver holding this capability organization-wide.',
    group: 'people',
    locationScopable: false,
  },
  'people.manage_credentials': {
    label: 'Manage professional credentials',
    description:
      'Record licences and certifications and their expiry. Reading the licence number itself additionally requires people.view_sensitive.',
    group: 'people',
    locationScopable: true,
  },
  'people.export': {
    label: 'Export people data',
    description: 'Export employee records.',
    group: 'people',
    locationScopable: false,
    plannedSlice: 7,
  },

  // --- onboarding ----------------------------------------------------------
  'onboarding.manage': {
    label: 'Manage onboarding checklists',
    description: 'Create and edit the onboarding templates new hires follow.',
    group: 'people',
    locationScopable: false,
  },
  'onboarding.view_progress': {
    label: 'View onboarding progress',
    description: 'See how far each new hire has got, and what is blocking them.',
    group: 'people',
    locationScopable: true,
  },
  'onboarding.verify': {
    label: 'Verify onboarding steps',
    description:
      'Confirm in person that a step was completed. An employee can never complete their own manager-verified step.',
    group: 'people',
    locationScopable: true,
  },

  // --- communication -------------------------------------------------------
  'announcement.create': {
    label: 'Create announcements',
    description: 'Draft announcements for an audience.',
    group: 'communication',
    locationScopable: true,
    plannedSlice: 3,
  },
  'announcement.publish': {
    label: 'Publish announcements',
    description: 'Send announcements to their audience.',
    group: 'communication',
    locationScopable: true,
    plannedSlice: 3,
  },
  'announcement.publish_urgent': {
    label: 'Publish urgent announcements',
    description: 'Bypass quiet hours. Separated so urgency cannot be used casually.',
    group: 'communication',
    locationScopable: true,
    plannedSlice: 3,
  },
  'announcement.view_receipts': {
    label: 'View read and acknowledgement receipts',
    description: 'See who has read and acknowledged.',
    group: 'communication',
    locationScopable: true,
    plannedSlice: 3,
  },
  // Declared in Slice 1 so two-way messaging lands without an authz retrofit.
  // No interface offers these in Phase 1.
  'conversation.start': {
    label: 'Start conversations',
    description: 'Open a direct or group conversation.',
    group: 'communication',
    locationScopable: true,
    plannedSlice: 8,
  },
  'conversation.moderate': {
    label: 'Moderate conversations',
    description: 'Review reported messages and remove content.',
    group: 'communication',
    locationScopable: true,
    plannedSlice: 8,
  },

  // --- scheduling ----------------------------------------------------------
  'schedule.view_all': {
    label: 'View all schedules',
    description: "See every employee's schedule, not only your own.",
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },
  'schedule.draft': {
    label: 'Build schedules',
    description: 'Create and edit draft schedules and shifts.',
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },
  'schedule.publish': {
    label: 'Publish schedules',
    description: 'Make a schedule visible to employees and send notifications.',
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },
  'schedule.manage_templates': {
    label: 'Manage shift templates',
    description: 'Create reusable shift patterns.',
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },
  'availability.view_team': {
    label: 'View team availability',
    description: 'See declared availability for staff.',
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },
  'timeoff.decide': {
    label: 'Approve or deny time off',
    description: 'Decide time-off requests.',
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },
  'swap.decide': {
    label: 'Approve shift swaps',
    description: 'Approve or deny swap and giveaway requests.',
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },
  'openshift.manage': {
    label: 'Manage open shifts',
    description: 'Post open shifts and decide claims.',
    group: 'scheduling',
    locationScopable: true,
    plannedSlice: 4,
  },

  // --- learning ------------------------------------------------------------
  'training.author': {
    label: 'Author training',
    description: 'Build courses, modules, lessons, and assessments.',
    group: 'learning',
    locationScopable: false,
    plannedSlice: 5,
  },
  'training.publish': {
    label: 'Publish training',
    description: 'Make courses and learning paths available.',
    group: 'learning',
    locationScopable: false,
    plannedSlice: 5,
  },
  'training.assign': {
    label: 'Assign training',
    description: 'Assign courses and paths to people.',
    group: 'learning',
    locationScopable: true,
    plannedSlice: 5,
  },
  'training.view_progress_team': {
    label: 'View team training progress',
    description: 'See progress for staff at your locations.',
    group: 'learning',
    locationScopable: true,
    plannedSlice: 5,
  },
  'training.view_progress_org': {
    label: 'View organization training progress',
    description: 'See progress across the whole organization.',
    group: 'learning',
    locationScopable: false,
    plannedSlice: 5,
  },
  'skill.define': {
    label: 'Define skills',
    description: 'Create skills and the evidence they require.',
    group: 'learning',
    locationScopable: false,
    plannedSlice: 5,
  },
  'skill.verify': {
    label: 'Verify practical skills',
    description: 'Sign off that someone demonstrated a skill.',
    group: 'learning',
    locationScopable: true,
    plannedSlice: 5,
  },
  'skill.revoke': {
    label: 'Revoke a skill sign-off',
    description: 'Withdraw a previous verification.',
    group: 'learning',
    locationScopable: false,
    plannedSlice: 5,
  },

  // --- operations ----------------------------------------------------------
  'checklist.author': {
    label: 'Author checklists',
    description: 'Build pre-shift, side work, opening, and closing templates.',
    group: 'operations',
    locationScopable: true,
    plannedSlice: 6,
  },
  'checklist.view_runs': {
    label: 'View checklist runs',
    description: 'See completion for a shift or day.',
    group: 'operations',
    locationScopable: true,
    plannedSlice: 6,
  },
  'checklist.verify': {
    label: 'Verify checklist runs',
    description: 'Confirm work was completed to standard.',
    group: 'operations',
    locationScopable: true,
    plannedSlice: 6,
  },
  'checklist.reopen': {
    label: 'Reopen a checklist run',
    description: 'Undo a submission so it can be corrected.',
    group: 'operations',
    locationScopable: true,
    plannedSlice: 6,
  },
  'handoff.manage': {
    label: 'Manage handoffs',
    description: 'Create and resolve work passed between shifts.',
    group: 'operations',
    locationScopable: true,
    plannedSlice: 6,
  },

  // --- reporting -----------------------------------------------------------
  'report.operations': {
    label: 'Operations reporting',
    description: 'Coverage and checklist completion.',
    group: 'reporting',
    locationScopable: true,
    plannedSlice: 7,
  },
  'report.training': {
    label: 'Training reporting',
    description: 'Completion, readiness, and overdue training.',
    group: 'reporting',
    locationScopable: true,
    plannedSlice: 7,
  },
  'report.people': {
    label: 'People reporting',
    description: 'Headcount, onboarding funnel, and status.',
    group: 'reporting',
    locationScopable: false,
    plannedSlice: 7,
  },
})

export type Capability = keyof typeof CAPABILITIES

export const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as Capability[]

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value)
}

export function capability(key: Capability): CapabilityDefinition {
  return CAPABILITIES[key]
}

/** Capabilities that a location-scoped grant is permitted to carry. */
export function isLocationScopable(key: Capability): boolean {
  return CAPABILITIES[key].locationScopable
}
