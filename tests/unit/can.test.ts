import { describe, expect, it } from 'vitest'
import {
  accessibleLocationIds,
  authorize,
  authorizeSelfOr,
  can,
  canAtAnyLocation,
  isSelf,
} from '@/server/authz/can'
import type { Actor, ResolvedGrant } from '@/server/authz/actor'
import { ALL_CAPABILITIES, isLocationScopable, type Capability } from '@/server/authz/capabilities'
import { ROLE_KEYS, ROLE_PRESETS, type RoleKey } from '@/server/authz/role-presets'
import { ForbiddenError } from '@/lib/errors'

const ORG = 'org-harbor'
const RIVERSIDE = 'loc-riverside'
const DOWNTOWN = 'loc-downtown'

function grantFor(role: RoleKey, locationId: string | null): ResolvedGrant {
  const preset = ROLE_PRESETS[role]
  const capabilities = new Set<Capability>(
    // Mirrors resolveActor: a location grant never carries an org-only capability.
    locationId === null
      ? preset.capabilities
      : preset.capabilities.filter((c) => isLocationScopable(c)),
  )
  return {
    roleId: `role-${role}`,
    roleKey: role,
    roleName: preset.name,
    scope: locationId === null ? 'org' : 'location',
    locationId,
    capabilities,
  }
}

function actorWith(grants: ResolvedGrant[], employmentId = 'emp-1'): Actor {
  return {
    userId: `user-${employmentId}`,
    organizationId: ORG,
    employmentId,
    displayName: 'Test Person',
    grants,
    locationIds: [RIVERSIDE],
  }
}

const owner = actorWith([grantFor('owner', null)])
const gmRiverside = actorWith([grantFor('general_manager', RIVERSIDE)], 'emp-gm-riverside')
const employee = actorWith([grantFor('employee', null)], 'emp-employee')

describe('organization-scoped grants', () => {
  it('apply everywhere, including at a specific location', () => {
    expect(can(owner, 'schedule.publish')).toBe(true)
    expect(can(owner, 'schedule.publish', { locationId: RIVERSIDE })).toBe(true)
    expect(can(owner, 'schedule.publish', { locationId: DOWNTOWN })).toBe(true)
  })
})

describe('location-scoped grants', () => {
  it('allow the granted location', () => {
    expect(can(gmRiverside, 'schedule.publish', { locationId: RIVERSIDE })).toBe(true)
  })

  it('REFUSE another location in the same organization', () => {
    // The central multi-location rule: same tenant is not the same site.
    expect(can(gmRiverside, 'schedule.publish', { locationId: DOWNTOWN })).toBe(false)
    expect(can(gmRiverside, 'people.view', { locationId: DOWNTOWN })).toBe(false)
    expect(can(gmRiverside, 'checklist.verify', { locationId: DOWNTOWN })).toBe(false)
  })

  it('do not answer an organization-level question', () => {
    // Asking without a location is the STRONGER question, not a wildcard.
    expect(can(gmRiverside, 'schedule.publish')).toBe(false)
    expect(can(gmRiverside, 'people.view')).toBe(false)
  })

  it('still report the capability as held somewhere, for navigation', () => {
    expect(canAtAnyLocation(gmRiverside, 'schedule.publish')).toBe(true)
    expect(canAtAnyLocation(gmRiverside, 'org.manage_roles')).toBe(false)
  })

  it('never carry an organization-only capability', () => {
    const forged: ResolvedGrant = {
      ...grantFor('general_manager', RIVERSIDE),
      // Simulate corrupted data granting an org-only capability at a location.
      capabilities: new Set<Capability>(['org.manage_roles', 'people.separate']),
    }
    const tampered = actorWith([forged])
    expect(can(tampered, 'org.manage_roles', { locationId: RIVERSIDE })).toBe(false)
    expect(can(tampered, 'people.separate', { locationId: RIVERSIDE })).toBe(false)
  })
})

describe('a person holding different roles at different locations', () => {
  const dualRole = actorWith([grantFor('general_manager', RIVERSIDE), grantFor('employee', null)])

  it('manages only where they manage', () => {
    expect(can(dualRole, 'schedule.publish', { locationId: RIVERSIDE })).toBe(true)
    expect(can(dualRole, 'schedule.publish', { locationId: DOWNTOWN })).toBe(false)
  })

  it('reports exactly the locations a capability reaches', () => {
    expect(accessibleLocationIds(dualRole, 'schedule.publish')).toEqual([RIVERSIDE])
    expect(accessibleLocationIds(owner, 'schedule.publish')).toBeNull() // null = org-wide
    expect(accessibleLocationIds(employee, 'schedule.publish')).toEqual([])
  })
})

describe('authorize', () => {
  it('throws ForbiddenError naming the capability', () => {
    expect(() => authorize(gmRiverside, 'schedule.publish', { locationId: DOWNTOWN })).toThrow(
      ForbiddenError,
    )
    try {
      authorize(employee, 'org.view_audit')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as ForbiddenError).capability).toBe('org.view_audit')
      expect((error as ForbiddenError).status).toBe(403)
    }
  })

  it('passes silently when permitted', () => {
    expect(() => authorize(owner, 'org.manage_roles')).not.toThrow()
  })
})

describe('self-access is ownership, not capability', () => {
  it('lets an employee act on their own record with no capabilities at all', () => {
    expect(employee.grants[0]?.capabilities.size).toBe(0)
    expect(isSelf(employee, 'emp-employee')).toBe(true)
    expect(() => authorizeSelfOr(employee, 'emp-employee', 'people.update')).not.toThrow()
  })

  it('does not let them act on someone else without the capability', () => {
    expect(isSelf(employee, 'emp-someone-else')).toBe(false)
    expect(() => authorizeSelfOr(employee, 'emp-someone-else', 'people.update')).toThrow(
      ForbiddenError,
    )
  })
})

describe('denial coverage for every role and capability', () => {
  // Every capability a preset does NOT hold must be refused. This is the
  // "every capability has a denial test" rule, enforced mechanically.
  for (const role of ROLE_KEYS) {
    it(`refuses every capability ${role} does not hold`, () => {
      const held = new Set<Capability>(ROLE_PRESETS[role].capabilities)
      const orgActor = actorWith([grantFor(role, null)])
      const locationActor = actorWith([grantFor(role, RIVERSIDE)])

      for (const capability of ALL_CAPABILITIES) {
        if (held.has(capability)) continue
        expect(can(orgActor, capability), `${role} must not hold ${capability}`).toBe(false)
        expect(
          can(orgActor, capability, { locationId: RIVERSIDE }),
          `${role} must not hold ${capability} at a location`,
        ).toBe(false)
        expect(
          can(locationActor, capability, { locationId: RIVERSIDE }),
          `${role} scoped to a location must not hold ${capability}`,
        ).toBe(false)
      }
    })
  }

  it('refuses everything for an actor with no grants', () => {
    const stranger = actorWith([])
    for (const capability of ALL_CAPABILITIES) {
      expect(can(stranger, capability)).toBe(false)
      expect(can(stranger, capability, { locationId: RIVERSIDE })).toBe(false)
    }
  })
})
