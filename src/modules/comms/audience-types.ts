/**
 * Audience types, separated from the table definitions.
 *
 * Pages and other modules need to NAME a selector type without importing the
 * comms tables - the architecture rule keeps schema modules private, and a
 * page has no business seeing them. The values live here and schema.ts derives
 * its column checks from the same list, so the two cannot drift.
 */

export const AUDIENCE_SELECTOR_TYPES = [
  'organization',
  'location',
  'department',
  'job_role',
  'team',
  'station',
  'employment',
] as const
export type AudienceSelectorType = (typeof AUDIENCE_SELECTOR_TYPES)[number]

export const AUDIENCE_MODES = ['include', 'exclude'] as const
export type AudienceMode = (typeof AUDIENCE_MODES)[number]
