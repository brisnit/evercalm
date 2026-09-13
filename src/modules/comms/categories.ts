/**
 * The categories a new organization starts with.
 *
 * These are seeded as ROWS, not compiled in as an enum, so a tenant can rename
 * "Operations" to "Front of house" or add "Catering" without a deploy. The
 * `key` is what code and notification preferences reference and never changes;
 * `name` is what people see and is theirs to edit.
 *
 * OVERRIDES PREFERENCES is the honest name for "mandatory". A category marked
 * this way reaches people who have switched that category off, so it is set
 * only where not receiving the message is worse than the annoyance of getting
 * one you muted:
 *
 *   Safety     — an allergen or hazard notice
 *   HR         — pay, policy, and employment matters
 *   Emergency  — a closure, an evacuation, an incident
 *
 * Everything else is genuinely optional and honours the switch. Changing which
 * categories override is an organization setting and an audited act, not
 * something an author picks per message - otherwise "mandatory" becomes a
 * checkbox everybody ticks and the preference means nothing.
 */
export interface DefaultCategory {
  key: string
  name: string
  description: string
  overridesPreferences: boolean
}

export const DEFAULT_ANNOUNCEMENT_CATEGORIES: readonly DefaultCategory[] = [
  {
    key: 'general',
    name: 'General',
    description: 'Everyday news that does not belong anywhere else.',
    overridesPreferences: false,
  },
  {
    key: 'operations',
    name: 'Operations',
    description: 'How the floor runs today: process changes, equipment, supply.',
    overridesPreferences: false,
  },
  {
    key: 'schedule',
    name: 'Schedule',
    description: 'Shifts, coverage, and changes to who is on.',
    overridesPreferences: false,
  },
  {
    key: 'training',
    name: 'Training',
    description: 'Learning, certification, and practical sign-off.',
    overridesPreferences: false,
  },
  {
    key: 'hr',
    name: 'HR',
    description: 'Pay, policy, benefits, and employment matters.',
    overridesPreferences: true,
  },
  {
    key: 'safety',
    name: 'Safety',
    description: 'Allergens, hazards, incidents, and anything that can hurt somebody.',
    overridesPreferences: true,
  },
  {
    key: 'event',
    name: 'Event',
    description: 'Something happening at a time: a large party, a visit, a launch.',
    overridesPreferences: false,
  },
  {
    key: 'emergency',
    name: 'Emergency',
    description: 'Closures, evacuations, and incidents that cannot wait.',
    overridesPreferences: true,
  },
] as const

/** Categories whose messages ignore a preference switch. */
export const MANDATORY_CATEGORY_KEYS = new Set(
  DEFAULT_ANNOUNCEMENT_CATEGORIES.filter((c) => c.overridesPreferences).map((c) => c.key),
)
