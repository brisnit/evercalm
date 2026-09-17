import { describe, expect, it } from 'vitest'
import type { Actor } from '@/server/authz/actor'
import type { Capability } from '@/server/authz/capabilities'
import type { AttentionItem } from '@/modules/reports/attention'
import { visibleNavItems } from '@/app/(app)/app/navigation'
import { attentionLine, attentionSummary, launcherTools } from '@/app/(app)/app/launcher'
import { signInErrorMessage } from '@/lib/auth-messages'

function actorWith(capabilities: Capability[], scope: 'org' | 'location' = 'org'): Actor {
  return {
    userId: 'u',
    organizationId: 'o',
    employmentId: 'e',
    displayName: 'Test Person',
    locationIds: ['loc-1'],
    grants: [
      {
        roleId: 'r',
        roleKey: 'k',
        roleName: 'Role',
        scope,
        locationId: scope === 'location' ? 'loc-1' : null,
        capabilities: new Set(capabilities),
      },
    ],
  }
}

const item = (over: Partial<AttentionItem>): AttentionItem => ({
  key: 'k',
  label: 'Time off to decide',
  detail: '',
  count: 2,
  tone: 'attention',
  href: '/app/schedule/requests',
  area: 'Schedule',
  ...over,
})

describe('administration navigation', () => {
  it('no longer lists Reports, even for someone who can open every report', () => {
    const owner = actorWith([
      'people.view',
      'org.view',
      'report.people',
      'report.training',
      'report.operations',
      'report.communications',
    ])
    const labels = visibleNavItems(owner).map((i) => i.label)
    expect(labels).not.toContain('Reports')
    expect(labels[0]).toBe('Home')
    expect(visibleNavItems(owner).some((i) => i.href.startsWith('/app/reports'))).toBe(false)
  })
})

describe('the administration launcher', () => {
  it('shows only the tools a person can open', () => {
    const scheduler = actorWith(['schedule.view_all', 'schedule.draft'], 'location')
    expect(launcherTools(scheduler, []).map((t) => t.key)).toEqual(['schedule'])

    const everything = actorWith([
      'people.view',
      'onboarding.view_progress',
      'schedule.view_all',
      'training.assign',
      'checklist.view_runs',
      'announcement.create',
      'org.view',
    ])
    expect(launcherTools(everything, []).map((t) => t.key)).toEqual([
      'people',
      'onboarding',
      'schedule',
      'training',
      'operations',
      'communication',
      'settings',
    ])
  })

  it('puts each figure on the card for the section where it is decided', () => {
    const actor = actorWith(['schedule.view_all', 'skill.verify', 'people.view'])
    const tools = launcherTools(
      actor,
      [
        item({ href: '/app/schedule/requests', label: 'Time off to decide', count: 2 }),
        item({
          key: 'b',
          href: '/app/training/sign-offs',
          label: 'Waiting for sign-off',
          count: 1,
        }),
      ],
      { people: '12 active' },
    )
    const byKey = Object.fromEntries(tools.map((t) => [t.key, t]))
    expect(byKey.schedule).toMatchObject({ status: 'Time off to decide: 2', tone: 'attention' })
    expect(byKey.training).toMatchObject({ status: 'Waiting for sign-off: 1', tone: 'attention' })
    expect(byKey.people).toMatchObject({ status: '12 active', tone: 'calm' })
  })

  it('does not mistake a longer path for a section it merely starts like', () => {
    const actor = actorWith(['people.view'])
    const [people] = launcherTools(actor, [item({ href: '/app/peoplex', count: 9 })])
    expect(people!.tone).toBe('calm')
  })

  it('summarises several kinds, and keeps the home box to three figures', () => {
    const items = [1, 2, 3, 4].map((n) => item({ key: `k${n}`, count: n }))
    expect(attentionLine(items.slice(0, 2))).toBe('3 things need you')
    const summary = attentionSummary(items)
    expect(summary).toMatchObject({ total: 10, kinds: 4, urgent: false })
    expect(summary.top).toHaveLength(3)
  })
})

describe('sign-in messages', () => {
  it('does not call too many attempts a wrong password', () => {
    expect(signInErrorMessage(429)).toMatch(/Too many sign-in attempts/)
    expect(signInErrorMessage(401)).toMatch(/did not match/)
    expect(signInErrorMessage(undefined)).toMatch(/did not match/)
    expect(signInErrorMessage(503)).toMatch(/not working right now/)
  })
})
