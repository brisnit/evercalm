import { describe, expect, it } from 'vitest'
import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  isCapability,
  isLocationScopable,
  type Capability,
} from '@/server/authz/capabilities'
import {
  nonLocationScopableCapabilities,
  ROLE_KEYS,
  ROLE_PRESETS,
} from '@/server/authz/role-presets'

describe('capability registry', () => {
  it('keys every definition to its own name', () => {
    for (const [key, definition] of Object.entries(CAPABILITIES)) {
      expect(definition.key).toBe(key)
    }
  })

  it('recognises real capabilities and rejects invented ones', () => {
    expect(isCapability('org.manage_roles')).toBe(true)
    expect(isCapability('org.definitely_not_real')).toBe(false)
    expect(isCapability('')).toBe(false)
  })

  it('gives every capability a human-readable label and description', () => {
    for (const key of ALL_CAPABILITIES) {
      expect(CAPABILITIES[key].label.length).toBeGreaterThan(3)
      expect(CAPABILITIES[key].description.length).toBeGreaterThan(10)
    }
  })

  it('keeps organization-level controls out of reach of a location grant', () => {
    // These must never be grantable to a single-location manager.
    const orgOnly: Capability[] = [
      'org.manage_roles',
      'org.manage_locations',
      'org.update',
      'org.view_audit',
      'billing.manage',
      'people.separate',
      'people.export',
      'training.view_progress_org',
    ]
    for (const key of orgOnly) {
      expect(isLocationScopable(key), `${key} must not be location-scopable`).toBe(false)
    }
  })
})

describe('role presets', () => {
  it('references only capabilities that exist', () => {
    for (const key of ROLE_KEYS) {
      for (const capability of ROLE_PRESETS[key].capabilities) {
        expect(isCapability(capability), `${key} references unknown "${capability}"`).toBe(true)
      }
    }
  })

  it('lists no capability twice within a role', () => {
    for (const key of ROLE_KEYS) {
      const caps = ROLE_PRESETS[key].capabilities
      expect(new Set(caps).size).toBe(caps.length)
    }
  })

  it('gives the Employee preset no capabilities - self-access is ownership', () => {
    expect(ROLE_PRESETS.employee.capabilities).toHaveLength(0)
  })

  it('makes Owner the only role that can grant permissions', () => {
    const canManageRoles = ROLE_KEYS.filter((k) =>
      ROLE_PRESETS[k].capabilities.includes('org.manage_roles'),
    )
    expect(canManageRoles).toEqual(['owner'])
  })

  it('withholds sensitive employee data from General Manager and Scheduler', () => {
    expect(ROLE_PRESETS.general_manager.capabilities).not.toContain('people.view_sensitive')
    expect(ROLE_PRESETS.scheduler.capabilities).not.toContain('people.view_sensitive')
    // ...while HR and Owner do hold it.
    expect(ROLE_PRESETS.hr_admin.capabilities).toContain('people.view_sensitive')
    expect(ROLE_PRESETS.owner.capabilities).toContain('people.view_sensitive')
  })

  it('restricts separation to Owner and HR', () => {
    const canSeparate = ROLE_KEYS.filter((k) =>
      ROLE_PRESETS[k].capabilities.includes('people.separate'),
    )
    expect(canSeparate.sort()).toEqual(['hr_admin', 'owner'])
  })

  it('gives Owner every capability, so no permission is unreachable', () => {
    expect([...ROLE_PRESETS.owner.capabilities].sort()).toEqual([...ALL_CAPABILITIES].sort())
  })

  it('keeps every location-default preset free of organization-only capabilities', () => {
    for (const key of ROLE_KEYS) {
      const preset = ROLE_PRESETS[key]
      if (preset.defaultScope !== 'location') continue
      expect(
        nonLocationScopableCapabilities(preset.capabilities),
        `${key} is granted per location but carries organization-only capabilities`,
      ).toEqual([])
    }
  })

  it('defines Shift Lead through granular capabilities, not a special case', () => {
    const lead = ROLE_PRESETS.shift_lead
    expect(lead.defaultScope).toBe('location')
    expect(lead.capabilities).toContain('checklist.verify')
    expect(lead.capabilities).toContain('handoff.manage')
    // A lead is not a manager: no scheduling or people management.
    expect(lead.capabilities).not.toContain('schedule.publish')
    expect(lead.capabilities).not.toContain('people.manage_employment')
    expect(lead.capabilities).not.toContain('people.view_sensitive')
  })
})
