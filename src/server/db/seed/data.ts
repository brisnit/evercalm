import type { RoleKey } from '@/server/authz/role-presets'

/**
 * SEED TENANTS.
 *
 * Two organizations in deliberately different industries, sharing every table
 * and agreeing on nothing else. The salon exists to prove restaurant concepts
 * are not hard-coded: it has chairs rather than a bar, a colour bar rather
 * than an expo window, state licensure rather than food handler cards, and an
 * onboarding checklist built around a licence check.
 *
 * If a restaurant assumption ever leaks into the platform, the salon tenant is
 * where it will look wrong first.
 */

export interface SeedPerson {
  key: string
  displayName: string
  email: string
  jobTitle?: string
  grants: { role: RoleKey; location: string | null }[]
  locations: string[]
  jobRoles?: string[]
  /** Key of another person in the same tenant. */
  manager?: string
  hiredOn?: string
  status?: 'active' | 'invited' | 'suspended'
  onboarding?: {
    template: string
    startedOn: string
    /** Titles of steps already completed. */
    completed?: string[]
    blocked?: { title: string; reason: string }
  }
  credentials?: {
    name: string
    issuingAuthority: string
    identifier: string
    issuedOn: string
    expiresOn: string | null
  }[]
}

export interface SeedLocation {
  key: string
  name: string
  timezone: string
  city: string
  region: string
}

export interface SeedStep {
  title: string
  instructions?: string
  kind:
    | 'information'
    | 'employee_task'
    | 'manager_task'
    | 'document_request'
    | 'policy_ack'
    | 'training_assignment'
    | 'practical_verification'
    | 'credential_requirement'
  responsibility?: 'employee' | 'manager' | 'hr' | 'training_manager'
  required?: boolean
  dueDays?: number
  dueBasis?: 'hire_date' | 'onboarding_start'
  requiresManagerVerification?: boolean
  blocksCompletion?: boolean
}

export interface SeedSection {
  title: string
  description?: string
  steps: SeedStep[]
}

/** A team, plus who is on it. Person keys, resolved during seeding. */
export interface SeedTeam {
  key: string
  name: string
  department?: string
  location?: string
  members: string[]
}

export interface SeedEvent {
  key: string
  title: string
  description?: string
  kind: 'large_party' | 'training' | 'inspection' | 'promotion' | 'general'
  location?: string
  /** Days from the seed run. Keeps the demo permanently plausible. */
  inDays: number
  startHour?: number
  endHour?: number
  allDay?: boolean
  notes?: string
}

/**
 * A demo announcement.
 *
 * `readBy` and `acknowledgedBy` are person keys, which is how the demo shows a
 * partially completed acknowledgement report rather than an empty one.
 */
export interface SeedAnnouncement {
  key: string
  title: string
  body: string
  category: string
  priority?: 'normal' | 'important' | 'urgent' | 'emergency'
  author: string
  status?: 'draft' | 'scheduled' | 'published'
  /** Days ago it was published. Ignored when scheduled. */
  publishedDaysAgo?: number
  /** Days from now, for a scheduled announcement. */
  scheduledInDays?: number
  expiresInDays?: number
  requiresAcknowledgement?: boolean
  acknowledgementDueInDays?: number
  callToActionLabel?: string
  callToActionHref?: string
  event?: string
  audience: {
    mode?: 'include' | 'exclude'
    type:
      'organization' | 'location' | 'department' | 'job_role' | 'team' | 'station' | 'employment'
    /** Key of the location, department, role, team, station, or person. */
    ref?: string
  }[]
  readBy?: string[]
  acknowledgedBy?: string[]
}

export interface SeedOrganization {
  key: string
  name: string
  slug: string
  industry: string
  timezone: string
  jurisdiction: string
  locations: SeedLocation[]
  departments: { key: string; name: string; description: string }[]
  jobRoles: {
    key: string
    name: string
    department: string
    colorToken: string
    description: string
  }[]
  stations: { location: string; name: string; jobRole?: string; description?: string }[]
  values: { kind: 'value' | 'standard'; title: string; body: string }[]
  onboardingTemplates: {
    key: string
    name: string
    description: string
    jobRoles?: string[]
    locations?: string[]
    isDefault?: boolean
    sections: SeedSection[]
  }[]
  people: SeedPerson[]
  teams?: SeedTeam[]
  events?: SeedEvent[]
  announcements?: SeedAnnouncement[]
}

/** Development-only password, shared by every seeded account. */
export const SEED_PASSWORD = 'EverCalmDev!2026'

// ---------------------------------------------------------------------------
// Harbor & Vine - independent full-service restaurant, two locations
// ---------------------------------------------------------------------------

const HARBOR: SeedOrganization = {
  key: 'harbor-vine',
  name: 'Harbor & Vine',
  slug: 'harbor-vine',
  industry: 'restaurant',
  timezone: 'America/Los_Angeles',
  jurisdiction: 'US-CA',

  locations: [
    {
      key: 'riverside',
      name: 'Riverside',
      timezone: 'America/Los_Angeles',
      city: 'Sacramento',
      region: 'CA',
    },
    {
      key: 'downtown',
      name: 'Downtown',
      timezone: 'America/Los_Angeles',
      city: 'Sacramento',
      region: 'CA',
    },
  ],

  departments: [
    { key: 'foh', name: 'Front of House', description: 'Everyone the guest meets.' },
    { key: 'boh', name: 'Back of House', description: 'Kitchen, prep, and dish.' },
    { key: 'mgmt', name: 'Management', description: 'Service leadership and administration.' },
  ],

  jobRoles: [
    {
      key: 'server',
      name: 'Server',
      department: 'foh',
      colorToken: 'violet',
      description: 'Takes care of a section from greet to goodbye.',
    },
    {
      key: 'host',
      name: 'Host',
      department: 'foh',
      colorToken: 'pink',
      description: 'Runs the door, the waitlist, and the seating plan.',
    },
    {
      key: 'bartender',
      name: 'Bartender',
      department: 'foh',
      colorToken: 'info',
      description: 'Builds drinks and runs the bar rail.',
    },
    {
      key: 'busser',
      name: 'Busser',
      department: 'foh',
      colorToken: 'neutral',
      description: 'Resets tables and supports the floor.',
    },
    {
      key: 'line-cook',
      name: 'Line Cook',
      department: 'boh',
      colorToken: 'warning',
      description: 'Works a station on the hot line.',
    },
    {
      key: 'prep-cook',
      name: 'Prep Cook',
      department: 'boh',
      colorToken: 'success',
      description: 'Preps the day and stocks the line.',
    },
    {
      key: 'dish',
      name: 'Dishwasher',
      department: 'boh',
      colorToken: 'neutral',
      description: 'Keeps the pit and the flow of clean ware.',
    },
    {
      key: 'sous',
      name: 'Sous Chef',
      department: 'boh',
      colorToken: 'warning',
      description: 'Runs the kitchen during service.',
    },
  ],

  stations: [
    {
      location: 'riverside',
      name: 'Bar',
      jobRole: 'bartender',
      description: 'Main bar and service well.',
    },
    {
      location: 'riverside',
      name: 'Host Stand',
      jobRole: 'host',
      description: 'Door, waitlist, and reservations.',
    },
    {
      location: 'riverside',
      name: 'Server Station A',
      jobRole: 'server',
      description: 'Sections 1 to 4.',
    },
    {
      location: 'riverside',
      name: 'Server Station B',
      jobRole: 'server',
      description: 'Sections 5 to 8 and the patio.',
    },
    {
      location: 'riverside',
      name: 'Expo',
      jobRole: 'sous',
      description: 'Pass and ticket coordination.',
    },
    {
      location: 'riverside',
      name: 'Grill',
      jobRole: 'line-cook',
      description: 'Proteins and the wood grill.',
    },
    {
      location: 'riverside',
      name: 'Saute',
      jobRole: 'line-cook',
      description: 'Pasta and pan work.',
    },
    {
      location: 'riverside',
      name: 'Dish Pit',
      jobRole: 'dish',
      description: 'Machine, pot sink, and clean ware.',
    },
    {
      location: 'downtown',
      name: 'Bar',
      jobRole: 'bartender',
      description: 'Front bar, sixteen seats.',
    },
    {
      location: 'downtown',
      name: 'Host Stand',
      jobRole: 'host',
      description: 'Door and the lounge waitlist.',
    },
    {
      location: 'downtown',
      name: 'Server Station',
      jobRole: 'server',
      description: 'Dining room and mezzanine.',
    },
    {
      location: 'downtown',
      name: 'Grill',
      jobRole: 'line-cook',
      description: 'Proteins and plancha.',
    },
    {
      location: 'downtown',
      name: 'Dish Pit',
      jobRole: 'dish',
      description: 'Machine and pot sink.',
    },
  ],

  values: [
    {
      kind: 'value',
      title: 'The table is the point',
      body: 'Everything we do is in service of the person sitting down to eat. Systems exist to protect that, never the other way round.',
    },
    {
      kind: 'value',
      title: 'Say the hard thing early',
      body: 'A problem raised at four o’clock is a plan. The same problem at seven is an apology to a guest.',
    },
    {
      kind: 'value',
      title: 'Leave it better than you found it',
      body: 'Stations, walk-ins, and shifts. The next person should be able to start clean.',
    },
    {
      kind: 'standard',
      title: 'Pre-shift happens every service',
      body: 'No one steps onto the floor without the 86 list, the reservation notes, and the night’s features.',
    },
    {
      kind: 'standard',
      title: 'Allergies are repeated back',
      body: 'Every allergy is read back to the guest and written on the ticket. No exceptions, however busy.',
    },
    {
      kind: 'standard',
      title: 'Side work is signed off, not assumed',
      body: 'A station is closed when a lead has checked it, not when the person doing it thinks it is done.',
    },
  ],

  onboardingTemplates: [
    {
      key: 'foh-onboarding',
      name: 'New Server Onboarding',
      description: 'First two weeks for anyone joining the floor.',
      jobRoles: ['server', 'host'],
      sections: [
        {
          title: 'Before your first shift',
          description: 'Paperwork and reading, so day one is about the floor.',
          steps: [
            {
              title: 'Complete your profile and emergency contact',
              instructions:
                'Add a phone number we can reach you on, and who to call if something happens during service.',
              kind: 'employee_task',
              dueDays: 1,
              dueBasis: 'hire_date',
            },
            {
              title: 'Read how we work and what we expect',
              instructions:
                'Our values and operating standards. Ask your manager about anything that is not clear.',
              kind: 'information',
              dueDays: 1,
            },
            { title: 'Employee handbook acknowledgement', kind: 'policy_ack', dueDays: 3 },
            {
              title: 'Upload your food handler card',
              instructions:
                'Sacramento County card. If yours has lapsed, tell your manager before your first shift.',
              kind: 'document_request',
              dueDays: 5,
            },
          ],
        },
        {
          title: 'Your first week',
          steps: [
            { title: 'Menu and allergen training', kind: 'training_assignment', dueDays: 7 },
            {
              title: 'Shadow two dinner services',
              instructions: 'Follow a senior server through a full turn, including close.',
              kind: 'employee_task',
              dueDays: 7,
            },
            {
              title: 'Table-side service check with a manager',
              instructions: 'Greet, take an order, read back an allergy, and close the table.',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 10,
            },
            { title: 'POS and payment walkthrough', kind: 'employee_task', dueDays: 10 },
          ],
        },
        {
          title: 'Ready for the floor',
          steps: [
            {
              title: 'First solo section signed off',
              instructions: 'A manager watches a full section from greet to goodbye.',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 14,
            },
          ],
        },
      ],
    },
    {
      key: 'boh-onboarding',
      name: 'Kitchen Onboarding',
      description: 'First two weeks on the line.',
      jobRoles: ['line-cook', 'prep-cook'],
      sections: [
        {
          title: 'Before your first shift',
          steps: [
            {
              title: 'Complete your profile and emergency contact',
              kind: 'employee_task',
              dueDays: 1,
              dueBasis: 'hire_date',
            },
            { title: 'Read how we work and what we expect', kind: 'information', dueDays: 1 },
            {
              title: 'Upload your food handler card',
              instructions: 'Required before you can work a station unsupervised.',
              kind: 'document_request',
              dueDays: 3,
            },
          ],
        },
        {
          title: 'Learning the kitchen',
          steps: [
            { title: 'Kitchen safety and knife handling', kind: 'training_assignment', dueDays: 5 },
            {
              title: 'Walk the walk-in, dry store, and par sheets',
              instructions:
                'With the sous chef. Learn where everything lives and how pars are set.',
              kind: 'employee_task',
              dueDays: 5,
            },
            {
              title: 'Station setup checked by the sous chef',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 10,
            },
          ],
        },
        {
          title: 'Running a station',
          steps: [
            {
              title: 'Run a station through a full service',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 14,
            },
          ],
        },
      ],
    },
    {
      key: 'default-onboarding',
      name: 'New Team Member',
      description: 'The basics everyone completes, whatever the role.',
      isDefault: true,
      sections: [
        {
          title: 'Getting started',
          steps: [
            {
              title: 'Complete your profile and emergency contact',
              kind: 'employee_task',
              dueDays: 1,
              dueBasis: 'hire_date',
            },
            { title: 'Read how we work and what we expect', kind: 'information', dueDays: 2 },
            { title: 'Employee handbook acknowledgement', kind: 'policy_ack', dueDays: 5 },
            {
              title: 'Meet your manager for a first week check-in',
              kind: 'manager_task',
              responsibility: 'manager',
              dueDays: 7,
            },
          ],
        },
      ],
    },
  ],

  people: [
    {
      key: 'owner',
      displayName: 'Dana Okafor',
      email: 'dana@harborvine.test',
      jobTitle: 'Owner',
      grants: [{ role: 'owner', location: null }],
      locations: ['riverside', 'downtown'],
      hiredOn: '2019-03-04',
    },
    {
      key: 'hr',
      displayName: 'Priya Raman',
      email: 'priya@harborvine.test',
      jobTitle: 'People & Culture Lead',
      grants: [{ role: 'hr_admin', location: null }],
      locations: ['riverside', 'downtown'],
      manager: 'owner',
      hiredOn: '2021-06-14',
    },
    {
      key: 'gm-riverside',
      displayName: 'Marcus Bell',
      email: 'marcus@harborvine.test',
      jobTitle: 'General Manager, Riverside',
      grants: [{ role: 'general_manager', location: 'riverside' }],
      locations: ['riverside'],
      manager: 'owner',
      hiredOn: '2020-09-01',
    },
    {
      key: 'gm-downtown',
      displayName: 'Tess Nakamura',
      email: 'tess@harborvine.test',
      jobTitle: 'General Manager, Downtown',
      grants: [{ role: 'general_manager', location: 'downtown' }],
      locations: ['downtown'],
      manager: 'owner',
      hiredOn: '2022-02-15',
    },
    {
      key: 'scheduler',
      displayName: 'Omar Haddad',
      email: 'omar@harborvine.test',
      jobTitle: 'Service Manager',
      grants: [{ role: 'scheduler', location: 'riverside' }],
      locations: ['riverside'],
      manager: 'gm-riverside',
      hiredOn: '2023-01-09',
    },
    {
      key: 'lead-riverside',
      displayName: 'Jordan Vega',
      email: 'jordan@harborvine.test',
      jobTitle: 'Shift Lead',
      grants: [{ role: 'shift_lead', location: 'riverside' }],
      locations: ['riverside'],
      jobRoles: ['server'],
      manager: 'gm-riverside',
      hiredOn: '2023-08-21',
      credentials: [
        {
          name: 'Food Handler Card',
          issuingAuthority: 'Sacramento County',
          identifier: 'FH-448120',
          issuedOn: '2025-09-02',
          expiresOn: '2028-09-02',
        },
      ],
    },
    {
      key: 'sous',
      displayName: 'Ines Duarte',
      email: 'ines@harborvine.test',
      jobTitle: 'Sous Chef',
      grants: [{ role: 'employee', location: null }],
      locations: ['riverside'],
      jobRoles: ['sous'],
      manager: 'gm-riverside',
      hiredOn: '2022-11-07',
      credentials: [
        {
          name: 'Food Manager Certification',
          issuingAuthority: 'ServSafe',
          identifier: 'SM-99214',
          issuedOn: '2024-01-18',
          expiresOn: '2029-01-18',
        },
      ],
    },
    {
      key: 'server',
      displayName: 'Sam Whitfield',
      email: 'sam@harborvine.test',
      jobTitle: 'Server',
      grants: [{ role: 'employee', location: null }],
      locations: ['riverside'],
      jobRoles: ['server'],
      manager: 'lead-riverside',
      hiredOn: '2024-05-30',
      credentials: [
        {
          name: 'Food Handler Card',
          issuingAuthority: 'Sacramento County',
          identifier: 'FH-501993',
          issuedOn: '2025-10-14',
          expiresOn: '2026-10-14',
        },
      ],
    },
    {
      key: 'bartender',
      displayName: 'Camille Fontaine',
      email: 'camille@harborvine.test',
      jobTitle: 'Bartender',
      grants: [{ role: 'employee', location: null }],
      locations: ['riverside'],
      jobRoles: ['bartender'],
      manager: 'gm-riverside',
      hiredOn: '2023-04-11',
    },
    {
      key: 'host',
      displayName: 'Theo Nakashima',
      email: 'theo@harborvine.test',
      jobTitle: 'Host',
      grants: [{ role: 'employee', location: null }],
      locations: ['downtown'],
      jobRoles: ['host'],
      manager: 'gm-downtown',
      hiredOn: '2025-02-03',
    },
    {
      // Mid-onboarding, on track.
      key: 'new-server',
      displayName: 'Ava Lindqvist',
      email: 'ava@harborvine.test',
      jobTitle: 'Server',
      grants: [{ role: 'employee', location: null }],
      locations: ['riverside'],
      jobRoles: ['server'],
      manager: 'lead-riverside',
      hiredOn: '2026-09-07',
      onboarding: {
        template: 'foh-onboarding',
        startedOn: '2026-09-07',
        completed: [
          'Complete your profile and emergency contact',
          'Read how we work and what we expect',
          'Shadow two dinner services',
        ],
      },
    },
    {
      // Onboarding blocked on a real-world dependency.
      key: 'new-cook',
      displayName: 'Dmitri Sokolov',
      email: 'dmitri@harborvine.test',
      jobTitle: 'Line Cook',
      grants: [{ role: 'employee', location: null }],
      locations: ['riverside'],
      jobRoles: ['line-cook'],
      manager: 'sous',
      hiredOn: '2026-09-01',
      onboarding: {
        template: 'boh-onboarding',
        startedOn: '2026-09-01',
        completed: [
          'Complete your profile and emergency contact',
          'Read how we work and what we expect',
        ],
        blocked: {
          title: 'Upload your food handler card',
          reason: 'County course booked for 18 September; card issues the same day.',
        },
      },
    },
    {
      // Onboarding overdue - started three weeks ago and stalled.
      key: 'new-busser',
      displayName: 'Kai Moreau',
      email: 'kai@harborvine.test',
      jobTitle: 'Busser',
      grants: [{ role: 'employee', location: null }],
      locations: ['downtown'],
      jobRoles: ['busser'],
      manager: 'gm-downtown',
      hiredOn: '2026-08-18',
      onboarding: {
        template: 'default-onboarding',
        startedOn: '2026-08-18',
        completed: ['Complete your profile and emergency contact'],
      },
    },
    {
      // Onboarding finished, for the completed state.
      key: 'prep',
      displayName: 'Bea Ortiz',
      email: 'bea@harborvine.test',
      jobTitle: 'Prep Cook',
      grants: [{ role: 'employee', location: null }],
      locations: ['riverside'],
      jobRoles: ['prep-cook'],
      manager: 'sous',
      hiredOn: '2026-07-14',
      onboarding: {
        template: 'default-onboarding',
        startedOn: '2026-07-14',
        completed: [
          'Complete your profile and emergency contact',
          'Read how we work and what we expect',
          'Employee handbook acknowledgement',
          'Meet your manager for a first week check-in',
        ],
      },
    },
    {
      // Works a second job at the salon tenant under the SAME identity.
      // The privacy fixture: neither organization may learn about the other
      // employment, and neither directory may surface it.
      key: 'dual-server',
      displayName: 'Noa Feldman',
      email: 'noa.feldman@example.test',
      jobTitle: 'Server',
      grants: [{ role: 'employee', location: null }],
      locations: ['downtown'],
      jobRoles: ['server'],
      manager: 'gm-downtown',
      hiredOn: '2025-11-02',
    },
  ],

  teams: [
    {
      key: 'closing-riverside',
      name: 'Riverside closing crew',
      department: 'foh',
      location: 'riverside',
      members: ['lead-riverside', 'bartender', 'server', 'new-busser'],
    },
    {
      key: 'kitchen-leads',
      name: 'Kitchen leads',
      department: 'boh',
      location: 'riverside',
      members: ['sous', 'prep'],
    },
  ],

  events: [
    {
      key: 'saturday-forty',
      title: 'Rehearsal dinner — 40 guests',
      description: 'Private booking in the back room. Set as two long tables.',
      kind: 'large_party',
      location: 'riverside',
      inDays: 3,
      startHour: 19,
      endHour: 22,
      notes: 'Two shellfish allergies and one coeliac. Chef has a fixed menu.',
    },
    {
      key: 'health-visit',
      title: 'County health inspection window opens',
      description: 'Routine annual window. Could be any service.',
      kind: 'inspection',
      location: 'riverside',
      inDays: 12,
      allDay: true,
      notes: 'Cooling logs and the allergen matrix are the two they always ask for.',
    },
  ],

  announcements: [
    {
      key: 'huddle',
      title: 'Tonight\u2019s pre-shift huddle',
      body: [
        'Doors at 4:30. Patio is open, so we are running section 3.',
        '',
        '- 86 the halibut. Salmon is the sub.',
        '- The Sancerre is back on by the glass.',
        '- Ramos is out. Devon covers section 3.',
        '',
        'Line up at **4:45 sharp** by the pass.',
      ].join('\n'),
      category: 'operations',
      priority: 'important',
      author: 'gm-riverside',
      publishedDaysAgo: 0,
      expiresInDays: 1,
      audience: [{ type: 'location', ref: 'riverside' }],
      readBy: ['server', 'bartender', 'lead-riverside'],
    },
    {
      key: 'large-party',
      title: 'Saturday: 40-guest rehearsal dinner',
      body: [
        'We have a 40-top in the back room on Saturday at 7pm.',
        '',
        '1. Back room is closed to walk-ins from 6pm.',
        '2. Two shellfish allergies and one coeliac \u2014 chef has a fixed menu.',
        '3. Bar, please pre-batch the welcome cocktail by 6:30.',
        '',
        'Section 3 will run light to cover the extra hands.',
      ].join('\n'),
      category: 'event',
      priority: 'important',
      author: 'gm-riverside',
      publishedDaysAgo: 1,
      event: 'saturday-forty',
      audience: [
        { type: 'location', ref: 'riverside' },
        { mode: 'exclude', type: 'job_role', ref: 'dish' },
      ],
      readBy: ['server', 'bartender', 'host', 'lead-riverside', 'sous'],
    },
    {
      key: 'eighty-six',
      title: 'The 86 list moves to the board at the pass',
      body: [
        'From Monday the 86 list lives on the board at the pass, not in the group chat.',
        '',
        '- Kitchen updates it when something runs out.',
        '- Servers check it before every table, not just at line-up.',
        '- If it is not on the board, it is on.',
        '',
        'The group chat goes back to being for scheduling only.',
      ].join('\n'),
      category: 'operations',
      author: 'owner',
      publishedDaysAgo: 4,
      audience: [{ type: 'organization' }],
      readBy: ['gm-riverside', 'gm-downtown', 'server', 'sous', 'bartender', 'lead-riverside'],
    },
    {
      key: 'allergen',
      title: 'Allergen handling \u2014 read and confirm',
      body: [
        'A guest was served the wrong dish last week. Nobody was hurt. It was close.',
        '',
        'The rule has not changed, and it is not negotiable:',
        '',
        '1. Any allergy goes on the ticket, in writing, every time.',
        '2. The expo repeats it back before the plate leaves the pass.',
        '3. A new pan and clean tongs. No exceptions, however busy we are.',
        '',
        'Read this and confirm you have. Your manager will ask.',
      ].join('\n'),
      category: 'safety',
      priority: 'urgent',
      author: 'hr',
      publishedDaysAgo: 6,
      requiresAcknowledgement: true,
      acknowledgementDueInDays: 2,
      callToActionLabel: 'Open the allergen matrix',
      callToActionHref: '/app/settings/values',
      audience: [{ type: 'organization' }],
      readBy: [
        'gm-riverside',
        'gm-downtown',
        'server',
        'bartender',
        'host',
        'sous',
        'lead-riverside',
        'prep',
      ],
      // Deliberately partial: the report shows real outstanding work.
      acknowledgedBy: ['gm-riverside', 'server', 'bartender', 'sous', 'lead-riverside'],
    },
    {
      key: 'riverside-parking',
      title: 'Riverside: staff parking moves to the north lot',
      body: [
        'The south lot is being resurfaced for two weeks from Monday.',
        '',
        'Staff parking is the north lot, past the loading bay. The code is the same.',
        'Give yourself an extra five minutes \u2014 it is a longer walk than it looks.',
      ].join('\n'),
      category: 'general',
      author: 'gm-riverside',
      publishedDaysAgo: 2,
      expiresInDays: 16,
      audience: [{ type: 'location', ref: 'riverside' }],
      readBy: ['server', 'lead-riverside'],
    },
    {
      key: 'owner-quarter',
      title: 'Where we are, and what changes next quarter',
      body: [
        'Both rooms finished the quarter ahead. That is you, and thank you.',
        '',
        'Three things change in the new quarter:',
        '',
        '- Downtown goes to seven days from the first.',
        '- We are putting real money into training. More on that shortly.',
        '- Every station gets a written standard, so nobody has to guess.',
        '',
        'Bring questions to your GM. I would rather answer them early.',
      ].join('\n'),
      category: 'general',
      priority: 'important',
      author: 'owner',
      publishedDaysAgo: 9,
      audience: [{ type: 'organization' }],
      readBy: ['gm-riverside', 'gm-downtown', 'hr', 'server', 'sous'],
    },
    {
      key: 'winter-menu',
      title: 'Winter menu launches Monday',
      body: [
        'The winter menu goes live on Monday. Tasting for all service staff is Sunday at 3pm.',
        '',
        '- Six new plates, four leaving.',
        '- The by-the-glass list changes with it.',
        '- Allergen matrix is updated and posted before the tasting.',
      ].join('\n'),
      category: 'operations',
      author: 'owner',
      status: 'scheduled',
      scheduledInDays: 2,
      audience: [{ type: 'organization' }],
    },
    {
      key: 'closing-crew',
      title: 'Closing crew: new lock-up order',
      body: [
        'Small change to lock-up, starting tonight.',
        '',
        '1. Bar cashes out first, then the floor.',
        '2. Kitchen signs the cooling log before anyone leaves.',
        '3. Last person out sets the alarm and texts the GM. Every night.',
      ].join('\n'),
      category: 'operations',
      author: 'gm-riverside',
      status: 'draft',
      audience: [{ type: 'team', ref: 'closing-riverside' }],
    },
  ],
}

// ---------------------------------------------------------------------------
// Lumen Salon & Spa - two locations, two states, real licensure
// ---------------------------------------------------------------------------

const LUMEN: SeedOrganization = {
  key: 'lumen-salon',
  name: 'Lumen Salon & Spa',
  slug: 'lumen-salon',
  industry: 'salon_spa',
  timezone: 'America/Los_Angeles',
  jurisdiction: 'US-OR',

  locations: [
    {
      key: 'pearl',
      name: 'Pearl District',
      timezone: 'America/Los_Angeles',
      city: 'Portland',
      region: 'OR',
    },
    // Different timezone on purpose: a business date is local to a site.
    { key: 'bench', name: 'Boise Bench', timezone: 'America/Denver', city: 'Boise', region: 'ID' },
  ],

  departments: [
    { key: 'hair', name: 'Hair', description: 'Cutting, colour, and styling.' },
    { key: 'skin', name: 'Skin & Body', description: 'Facials, waxing, and massage.' },
    { key: 'desk', name: 'Guest Services', description: 'Booking, retail, and the guest journey.' },
  ],

  jobRoles: [
    {
      key: 'stylist',
      name: 'Stylist',
      department: 'hair',
      colorToken: 'violet',
      description: 'Cutting and styling on a booked column.',
    },
    {
      key: 'colourist',
      name: 'Colour Specialist',
      department: 'hair',
      colorToken: 'pink',
      description: 'Colour formulation, correction, and highlighting.',
    },
    {
      key: 'apprentice',
      name: 'Apprentice Stylist',
      department: 'hair',
      colorToken: 'neutral',
      description: 'Assisting on the floor while building a column.',
    },
    {
      key: 'esthetician',
      name: 'Esthetician',
      department: 'skin',
      colorToken: 'success',
      description: 'Facials, peels, and waxing.',
    },
    {
      key: 'massage',
      name: 'Massage Therapist',
      department: 'skin',
      colorToken: 'info',
      description: 'Therapeutic and relaxation massage.',
    },
    {
      key: 'coordinator',
      name: 'Guest Coordinator',
      department: 'desk',
      colorToken: 'warning',
      description: 'Front desk, booking, and retail.',
    },
  ],

  stations: [
    { location: 'pearl', name: 'Chair 1', jobRole: 'stylist', description: 'Window column.' },
    { location: 'pearl', name: 'Chair 2', jobRole: 'stylist' },
    { location: 'pearl', name: 'Chair 3', jobRole: 'stylist' },
    {
      location: 'pearl',
      name: 'Chair 4',
      jobRole: 'apprentice',
      description: 'Shared apprentice chair.',
    },
    {
      location: 'pearl',
      name: 'Colour Bar',
      jobRole: 'colourist',
      description: 'Formulation and processing.',
    },
    { location: 'pearl', name: 'Shampoo Area', description: 'Three bowls.' },
    { location: 'pearl', name: 'Treatment Room 1', jobRole: 'esthetician' },
    { location: 'pearl', name: 'Treatment Room 2', jobRole: 'massage' },
    { location: 'pearl', name: 'Front Desk', jobRole: 'coordinator' },
    { location: 'bench', name: 'Chair 1', jobRole: 'stylist' },
    { location: 'bench', name: 'Chair 2', jobRole: 'stylist' },
    { location: 'bench', name: 'Colour Bar', jobRole: 'colourist' },
    { location: 'bench', name: 'Treatment Room', jobRole: 'esthetician' },
    { location: 'bench', name: 'Front Desk', jobRole: 'coordinator' },
  ],

  values: [
    {
      kind: 'value',
      title: 'The consultation is the service',
      body: 'What we agree in the first five minutes decides whether someone loves the result. We never skip it because the column is full.',
    },
    {
      kind: 'value',
      title: 'Build each other’s columns',
      body: 'A guest who books with the right person stays for years. Referring across the floor is generosity, not lost revenue.',
    },
    {
      kind: 'value',
      title: 'Clean is not negotiable',
      body: 'Tools, bowls, and rooms are reset to open-ready between every guest.',
    },
    {
      kind: 'standard',
      title: 'Licences are current before the floor',
      body: 'No one takes a guest without a current licence on file. We track renewals ninety days out, and we cover the shift while you sit the exam.',
    },
    {
      kind: 'standard',
      title: 'Patch tests before colour',
      body: 'Every new colour guest is patch tested at least forty-eight hours ahead, recorded on the card.',
    },
    {
      kind: 'standard',
      title: 'Rooms reset within ten minutes',
      body: 'Linens changed, implements in disinfectant, and the room turned before the next booking.',
    },
  ],

  onboardingTemplates: [
    {
      key: 'stylist-onboarding',
      name: 'New Stylist Onboarding',
      description: 'Licence verification first, then floor readiness.',
      jobRoles: ['stylist', 'colourist', 'apprentice'],
      sections: [
        {
          title: 'Licence and paperwork',
          description: 'Nobody takes a guest before this section is complete.',
          steps: [
            {
              title: 'Complete your profile and emergency contact',
              kind: 'employee_task',
              dueDays: 1,
              dueBasis: 'hire_date',
            },
            {
              title: 'Read our values and salon standards',
              instructions: 'Especially the consultation standard and the sanitation standard.',
              kind: 'information',
              dueDays: 1,
            },
            {
              title: 'Provide your cosmetology licence',
              instructions:
                'Licence number and expiry are recorded on your profile and tracked for renewal.',
              kind: 'credential_requirement',
              dueDays: 2,
            },
            {
              title: 'Licence verified against the state board',
              instructions:
                'A manager checks the number against the board register before you are booked.',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 3,
            },
          ],
        },
        {
          title: 'Getting ready for the floor',
          steps: [
            {
              title: 'Sanitation and disinfection procedure',
              kind: 'training_assignment',
              dueDays: 5,
            },
            {
              title: 'Colour line and formulation overview',
              kind: 'training_assignment',
              dueDays: 7,
            },
            {
              title: 'Consultation observed by a senior stylist',
              instructions:
                'A full consultation, including patch-test discussion for colour guests.',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 10,
            },
            {
              title: 'Set up your booking column and service menu',
              kind: 'employee_task',
              dueDays: 10,
            },
          ],
        },
        {
          title: 'On the floor',
          steps: [
            {
              title: 'First full day on the floor signed off',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 21,
            },
          ],
        },
      ],
    },
    {
      key: 'desk-onboarding',
      name: 'Guest Services Onboarding',
      description: 'Front desk, booking system, and retail.',
      isDefault: true,
      sections: [
        {
          title: 'First days',
          steps: [
            {
              title: 'Complete your profile and emergency contact',
              kind: 'employee_task',
              dueDays: 1,
              dueBasis: 'hire_date',
            },
            { title: 'Read our values and salon standards', kind: 'information', dueDays: 2 },
            {
              title: 'Booking system walkthrough',
              instructions: 'Columns, service durations, and how we handle a double booking.',
              kind: 'employee_task',
              dueDays: 3,
            },
          ],
        },
        {
          title: 'Working the desk',
          steps: [
            { title: 'Retail and product knowledge', kind: 'training_assignment', dueDays: 7 },
            {
              title: 'Handle a full opening shift with support',
              kind: 'practical_verification',
              responsibility: 'manager',
              dueDays: 14,
            },
          ],
        },
      ],
    },
  ],

  people: [
    {
      key: 'owner',
      displayName: 'Ana Beltrán',
      email: 'ana@lumensalon.test',
      jobTitle: 'Owner',
      grants: [{ role: 'owner', location: null }],
      locations: ['pearl', 'bench'],
      hiredOn: '2017-05-22',
      credentials: [
        {
          name: 'Cosmetology Licence',
          issuingAuthority: 'Oregon Health Licensing Office',
          identifier: 'OR-CO-114882',
          issuedOn: '2023-06-30',
          expiresOn: '2027-06-30',
        },
      ],
    },
    {
      key: 'gm-pearl',
      displayName: 'Kofi Mensah',
      email: 'kofi@lumensalon.test',
      jobTitle: 'Salon Manager, Pearl District',
      grants: [{ role: 'general_manager', location: 'pearl' }],
      locations: ['pearl'],
      manager: 'owner',
      hiredOn: '2021-10-04',
      credentials: [
        {
          name: 'Cosmetology Licence',
          issuingAuthority: 'Oregon Health Licensing Office',
          identifier: 'OR-CO-120447',
          issuedOn: '2024-03-12',
          expiresOn: '2028-03-12',
        },
      ],
    },
    {
      key: 'gm-bench',
      displayName: 'Sierra Whitehorse',
      email: 'sierra@lumensalon.test',
      jobTitle: 'Salon Manager, Boise Bench',
      grants: [{ role: 'general_manager', location: 'bench' }],
      locations: ['bench'],
      manager: 'owner',
      hiredOn: '2023-07-17',
      credentials: [
        {
          name: 'Cosmetology Licence',
          issuingAuthority: 'Idaho Board of Cosmetology',
          identifier: 'ID-CS-77310',
          issuedOn: '2023-08-01',
          expiresOn: '2027-08-01',
        },
      ],
    },
    {
      key: 'trainer',
      displayName: 'Yuki Tanaka',
      email: 'yuki@lumensalon.test',
      jobTitle: 'Education Lead',
      grants: [{ role: 'training_manager', location: null }],
      locations: ['pearl', 'bench'],
      manager: 'owner',
      hiredOn: '2022-04-19',
    },
    {
      // Licence EXPIRING SOON - the readiness signal a salon actually needs.
      key: 'stylist-senior',
      displayName: 'Marisol Vega',
      email: 'marisol@lumensalon.test',
      jobTitle: 'Senior Stylist',
      grants: [{ role: 'employee', location: null }],
      locations: ['pearl'],
      jobRoles: ['stylist'],
      manager: 'gm-pearl',
      hiredOn: '2020-01-27',
      credentials: [
        {
          name: 'Cosmetology Licence',
          issuingAuthority: 'Oregon Health Licensing Office',
          identifier: 'OR-CO-098221',
          issuedOn: '2022-10-15',
          expiresOn: '2026-10-15',
        },
      ],
    },
    {
      // Licence ALREADY EXPIRED - cannot legally take a guest.
      key: 'colourist',
      displayName: 'Priyanka Shah',
      email: 'priyanka@lumensalon.test',
      jobTitle: 'Colour Specialist',
      grants: [{ role: 'employee', location: null }],
      locations: ['pearl'],
      jobRoles: ['colourist'],
      manager: 'gm-pearl',
      hiredOn: '2021-03-08',
      credentials: [
        {
          name: 'Cosmetology Licence',
          issuingAuthority: 'Oregon Health Licensing Office',
          identifier: 'OR-CO-101556',
          issuedOn: '2022-08-20',
          expiresOn: '2026-08-20',
        },
      ],
    },
    {
      key: 'esthetician',
      displayName: 'Grace Abara',
      email: 'grace@lumensalon.test',
      jobTitle: 'Esthetician',
      grants: [{ role: 'employee', location: null }],
      locations: ['pearl'],
      jobRoles: ['esthetician'],
      manager: 'gm-pearl',
      hiredOn: '2024-02-26',
      credentials: [
        {
          name: 'Esthetician Licence',
          issuingAuthority: 'Oregon Health Licensing Office',
          identifier: 'OR-ES-054118',
          issuedOn: '2024-02-01',
          expiresOn: '2028-02-01',
        },
      ],
    },
    {
      key: 'massage',
      displayName: 'Ruben Castillo',
      email: 'ruben@lumensalon.test',
      jobTitle: 'Massage Therapist',
      grants: [{ role: 'employee', location: null }],
      locations: ['bench'],
      jobRoles: ['massage'],
      manager: 'gm-bench',
      hiredOn: '2024-09-16',
      credentials: [
        {
          name: 'Massage Therapy Licence',
          issuingAuthority: 'Idaho Board of Massage Therapy',
          identifier: 'ID-MT-22904',
          issuedOn: '2024-09-01',
          expiresOn: '2027-09-01',
        },
      ],
    },
    {
      // Mid-onboarding, waiting on state board verification.
      key: 'new-stylist',
      displayName: 'Elodie Garnier',
      email: 'elodie@lumensalon.test',
      jobTitle: 'Stylist',
      grants: [{ role: 'employee', location: null }],
      locations: ['pearl'],
      jobRoles: ['stylist'],
      manager: 'gm-pearl',
      hiredOn: '2026-09-03',
      onboarding: {
        template: 'stylist-onboarding',
        startedOn: '2026-09-03',
        completed: [
          'Complete your profile and emergency contact',
          'Read our values and salon standards',
          'Provide your cosmetology licence',
        ],
        blocked: {
          title: 'Licence verified against the state board',
          reason: 'Transfer from Washington is with the Oregon board; reference number OR-T-44119.',
        },
      },
      credentials: [
        {
          name: 'Cosmetology Licence (transfer pending)',
          issuingAuthority: 'Washington Department of Licensing',
          identifier: 'WA-CO-330871',
          issuedOn: '2023-11-09',
          expiresOn: '2027-11-09',
        },
      ],
    },
    {
      key: 'apprentice',
      displayName: 'Tomas Reyes',
      email: 'tomas@lumensalon.test',
      jobTitle: 'Apprentice Stylist',
      grants: [{ role: 'employee', location: null }],
      locations: ['pearl'],
      jobRoles: ['apprentice'],
      manager: 'stylist-senior',
      hiredOn: '2026-08-10',
      onboarding: {
        template: 'desk-onboarding',
        startedOn: '2026-08-10',
        completed: [
          'Complete your profile and emergency contact',
          'Read our values and salon standards',
        ],
      },
    },
    {
      key: 'coordinator',
      displayName: 'Riley Hoang',
      email: 'riley@lumensalon.test',
      jobTitle: 'Guest Coordinator',
      grants: [{ role: 'employee', location: null }],
      locations: ['pearl'],
      jobRoles: ['coordinator'],
      manager: 'gm-pearl',
      hiredOn: '2025-05-19',
    },
    {
      // The same global identity as Harbor & Vine's 'dual-server'.
      key: 'dual-assistant',
      displayName: 'Noa Feldman',
      email: 'noa.feldman@example.test',
      jobTitle: 'Weekend Guest Coordinator',
      grants: [{ role: 'employee', location: null }],
      locations: ['pearl'],
      jobRoles: ['coordinator'],
      manager: 'gm-pearl',
      hiredOn: '2026-01-24',
    },
  ],

  teams: [
    {
      key: 'pearl-colour',
      name: 'Pearl colour team',
      department: 'hair',
      location: 'pearl',
      members: ['colourist', 'stylist-senior', 'new-stylist'],
    },
  ],

  events: [
    {
      key: 'boise-open-house',
      title: 'Boise Bench open house',
      description: 'Evening open house for the neighbourhood: consultations, retail, refreshments.',
      kind: 'promotion',
      location: 'bench',
      inDays: 9,
      startHour: 17,
      endHour: 20,
      notes: 'Two stylists on consultations, one on the retail floor. Front desk runs the list.',
    },
    {
      key: 'colour-class',
      title: 'Colour correction masterclass',
      description: 'Four continuing-education hours with the regional educator.',
      kind: 'training',
      location: 'pearl',
      inDays: 5,
      startHour: 10,
      endHour: 14,
      notes: 'Counts toward Oregon continuing education. Bring your own mannequin head.',
    },
  ],

  announcements: [
    {
      key: 'inventory',
      title: 'Retail inventory: new colour line lands Thursday',
      body: [
        'The new bond-building line arrives Thursday and replaces the old one on the shelf.',
        '',
        '- Old stock stays available for existing colour clients until it runs out.',
        '- Retail price list is updated at the desk.',
        '- Please do not open testers until the display is built.',
      ].join('\n'),
      category: 'operations',
      author: 'owner',
      publishedDaysAgo: 2,
      audience: [{ type: 'organization' }],
      readBy: ['gm-pearl', 'stylist-senior', 'colourist', 'coordinator'],
    },
    {
      key: 'continuing-ed',
      title: 'Continuing education hours are due this cycle',
      body: [
        'Oregon and Idaho both want hours logged before the cycle closes.',
        '',
        '1. Check how many you have at the desk binder or ask your GM.',
        '2. The colour correction masterclass on the 5th is four hours.',
        '3. Send certificates to the front desk so we can file them.',
      ].join('\n'),
      category: 'training',
      priority: 'important',
      author: 'trainer',
      publishedDaysAgo: 5,
      event: 'colour-class',
      requiresAcknowledgement: true,
      acknowledgementDueInDays: 10,
      audience: [
        { type: 'department', ref: 'hair' },
        { type: 'department', ref: 'skin' },
      ],
      readBy: ['stylist-senior', 'colourist', 'esthetician', 'new-stylist'],
      // Early in the cycle: read widely, acknowledged by few.
      acknowledgedBy: ['stylist-senior', 'colourist'],
    },
    {
      key: 'licence',
      title: 'Licence renewal \u2014 confirm your expiry date',
      body: [
        'We are tidying up licence records before the board inspection.',
        '',
        'Every stylist, colourist, esthetician and massage therapist needs a current licence on file.',
        '',
        '- Check the date we hold for you at the desk.',
        '- If it expires in the next ninety days, start the renewal now.',
        '- Confirm below once you have checked.',
      ].join('\n'),
      category: 'hr',
      priority: 'urgent',
      author: 'owner',
      publishedDaysAgo: 8,
      requiresAcknowledgement: true,
      acknowledgementDueInDays: -1,
      audience: [{ type: 'organization' }],
      readBy: ['gm-pearl', 'gm-bench', 'stylist-senior', 'colourist', 'esthetician', 'massage'],
      // Overdue and still outstanding for several people, on purpose.
      acknowledgedBy: ['gm-pearl', 'stylist-senior', 'esthetician'],
    },
    {
      key: 'pearl-water',
      title: 'Pearl District: hot water off Tuesday morning',
      body: [
        'The building is working on the boiler on Tuesday, 8am to about noon.',
        '',
        'No backwash bowls until it is back. The desk is moving colour appointments to the afternoon;',
        'cutting and styling run as normal.',
      ].join('\n'),
      category: 'operations',
      priority: 'important',
      author: 'gm-pearl',
      publishedDaysAgo: 1,
      expiresInDays: 4,
      audience: [{ type: 'location', ref: 'pearl' }],
      readBy: ['stylist-senior', 'colourist'],
    },
    {
      key: 'boise-event',
      title: 'Boise Bench open house \u2014 we need three volunteers',
      body: [
        'The open house is on the 9th, 5pm to 8pm.',
        '',
        'We need two stylists on consultations and one person on the retail floor.',
        'It is paid at your normal rate, and dinner is on the salon.',
        '',
        'Tell your GM by Friday if you want in.',
      ].join('\n'),
      category: 'event',
      author: 'gm-bench',
      publishedDaysAgo: 3,
      event: 'boise-open-house',
      audience: [{ type: 'location', ref: 'bench' }],
      readBy: ['gm-bench', 'massage'],
    },
  ],
}

export const SEED_ORGANIZATIONS: SeedOrganization[] = [HARBOR, LUMEN]
