import type { RoleKey } from '@/server/authz/role-presets'

/**
 * SEED TENANTS.
 *
 * Two organizations in deliberately different industries. The salon exists to
 * prove restaurant vocabulary has not leaked into the core: it has chairs and
 * licensure rather than stations and an 86 list, and it spans two timezones so
 * per-location time handling is exercised from the first slice.
 *
 * Both tenants are seeded with the SAME shape of data so cross-tenant tests
 * have a symmetrical target.
 */

export interface SeedPerson {
  key: string
  displayName: string
  email: string
  /** Role preset plus the location it is scoped to (null = organization-wide). */
  grants: { role: RoleKey; location: string | null }[]
  locations: string[]
  status?: 'active' | 'invited'
}

export interface SeedLocation {
  key: string
  name: string
  timezone: string
  city: string
  region: string
}

export interface SeedOrganization {
  key: string
  name: string
  slug: string
  industry: string
  timezone: string
  jurisdiction: string
  locations: SeedLocation[]
  people: SeedPerson[]
}

/** Development-only password, shared by every seeded account. */
export const SEED_PASSWORD = 'EverCalmDev!2026'

export const SEED_ORGANIZATIONS: SeedOrganization[] = [
  {
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
    people: [
      {
        key: 'owner',
        displayName: 'Dana Okafor',
        email: 'dana@harborvine.test',
        grants: [{ role: 'owner', location: null }],
        locations: ['riverside', 'downtown'],
      },
      {
        key: 'hr',
        displayName: 'Priya Raman',
        email: 'priya@harborvine.test',
        grants: [{ role: 'hr_admin', location: null }],
        locations: ['riverside', 'downtown'],
      },
      {
        // The critical fixture: a manager scoped to ONE location inside a
        // multi-location tenant. Proves same-org is not the same as same-site.
        key: 'gm-riverside',
        displayName: 'Marcus Bell',
        email: 'marcus@harborvine.test',
        grants: [{ role: 'general_manager', location: 'riverside' }],
        locations: ['riverside'],
      },
      {
        key: 'gm-downtown',
        displayName: 'Tess Nakamura',
        email: 'tess@harborvine.test',
        grants: [{ role: 'general_manager', location: 'downtown' }],
        locations: ['downtown'],
      },
      {
        key: 'lead-riverside',
        displayName: 'Jordan Vega',
        email: 'jordan@harborvine.test',
        grants: [{ role: 'shift_lead', location: 'riverside' }],
        locations: ['riverside'],
      },
      {
        key: 'server',
        displayName: 'Sam Whitfield',
        email: 'sam@harborvine.test',
        grants: [{ role: 'employee', location: null }],
        locations: ['riverside'],
      },
      {
        // Works a second job at the salon tenant under the SAME identity.
        // The privacy fixture: neither organization may learn about the
        // other employment, and neither directory may surface it.
        key: 'dual-server',
        displayName: 'Noa Feldman',
        email: 'noa.feldman@example.test',
        grants: [{ role: 'employee', location: null }],
        locations: ['downtown'],
      },
    ],
  },

  {
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
      {
        // Different timezone on purpose: business dates are local to a site.
        key: 'bench',
        name: 'Boise Bench',
        timezone: 'America/Denver',
        city: 'Boise',
        region: 'ID',
      },
    ],
    people: [
      {
        key: 'owner',
        displayName: 'Ana Beltrán',
        email: 'ana@lumensalon.test',
        grants: [{ role: 'owner', location: null }],
        locations: ['pearl', 'bench'],
      },
      {
        key: 'gm-pearl',
        displayName: 'Kofi Mensah',
        email: 'kofi@lumensalon.test',
        grants: [{ role: 'general_manager', location: 'pearl' }],
        locations: ['pearl'],
      },
      {
        key: 'stylist',
        displayName: 'Riley Hoang',
        email: 'riley@lumensalon.test',
        grants: [{ role: 'employee', location: null }],
        locations: ['pearl'],
      },
      {
        // The same global identity as Harbor & Vine's 'dual-server'.
        key: 'dual-assistant',
        displayName: 'Noa Feldman',
        email: 'noa.feldman@example.test',
        grants: [{ role: 'employee', location: null }],
        locations: ['pearl'],
      },
    ],
  },
]
