import { describe, expect, it } from 'vitest'
import {
  isPinned,
  outstandingAcknowledgement,
  sortInbox,
  type InboxItem,
} from '@/modules/comms/inbox'
import {
  isWithinQuietHours,
  nextDeliverableAt,
  type DeliveryProfile,
} from '@/modules/notifications/service'
import { deliveryPolicy } from '@/modules/comms/delivery-policy'
import { MAX_DELIVERY_ATTEMPTS, retryBackoffMs } from '@/modules/notifications/service'
import { DEFAULT_ANNOUNCEMENT_CATEGORIES } from '@/modules/comms/categories'

/**
 * The behaviour rules, tested without a database.
 *
 * Inbox ordering, quiet hours, and what counts as mandatory are pure decisions
 * about product policy. Testing them here means every edge - an overnight
 * quiet window, a message that is urgent AND overdue, a category that
 * overrides preferences - is exhaustively covered without seeding a tenant.
 */

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    recipientId: Math.random().toString(36).slice(2),
    announcementId: Math.random().toString(36).slice(2),
    title: 'A message',
    preview: '',
    priority: 'normal',
    categoryKey: 'general',
    categoryName: 'General',
    publishedAt: new Date('2026-03-01T12:00:00Z'),
    expiresAt: null,
    requiresAcknowledgement: false,
    acknowledgementDueAt: null,
    unread: false,
    acknowledged: false,
    acknowledgedAt: null,
    needsReacknowledgement: false,
    revisedSinceViewed: false,
    status: 'published',
    authorName: 'A manager',
    ...overrides,
  }
}

describe('what counts as outstanding', () => {
  it('is nothing when no confirmation was asked for', () => {
    expect(outstandingAcknowledgement(item({ requiresAcknowledgement: false }))).toBe(false)
  })

  it('is outstanding until confirmed', () => {
    expect(
      outstandingAcknowledgement(item({ requiresAcknowledgement: true, acknowledged: false })),
    ).toBe(true)
  })

  it('becomes outstanding again after a material revision', () => {
    expect(
      outstandingAcknowledgement(
        item({ requiresAcknowledgement: true, acknowledged: true, needsReacknowledgement: true }),
      ),
    ).toBe(true)
  })
})

describe('pinning', () => {
  it('pins an unread urgent notice', () => {
    expect(isPinned(item({ priority: 'urgent', unread: true }))).toBe(true)
  })

  it('unpins an urgent notice once it has been read', () => {
    // It stops shouting when it has done its job.
    expect(isPinned(item({ priority: 'urgent', unread: false }))).toBe(false)
  })

  it('keeps an urgent notice pinned until CONFIRMED when it asks for that', () => {
    const read = item({
      priority: 'urgent',
      unread: false,
      requiresAcknowledgement: true,
      acknowledged: false,
    })
    expect(isPinned(read)).toBe(true)

    const confirmed = item({
      priority: 'urgent',
      unread: false,
      requiresAcknowledgement: true,
      acknowledged: true,
    })
    expect(isPinned(confirmed)).toBe(false)
  })

  it('never pins normal or important, however new', () => {
    expect(isPinned(item({ priority: 'normal', unread: true }))).toBe(false)
    expect(isPinned(item({ priority: 'important', unread: true }))).toBe(false)
  })
})

describe('inbox ordering', () => {
  it('puts what needs confirming above everything else', () => {
    const urgentRead = item({ title: 'urgent unread', priority: 'urgent', unread: true })
    const needsAck = item({
      title: 'needs confirming',
      priority: 'normal',
      requiresAcknowledgement: true,
    })
    expect(sortInbox([urgentRead, needsAck])[0]?.title).toBe('needs confirming')
  })

  it('orders outstanding confirmations by how soon they are due', () => {
    const later = item({
      title: 'later',
      requiresAcknowledgement: true,
      acknowledgementDueAt: new Date('2026-04-01T00:00:00Z'),
    })
    const sooner = item({
      title: 'sooner',
      requiresAcknowledgement: true,
      acknowledgementDueAt: new Date('2026-03-05T00:00:00Z'),
    })
    const undated = item({ title: 'no deadline', requiresAcknowledgement: true })

    expect(sortInbox([undated, later, sooner]).map((i) => i.title)).toEqual([
      'sooner',
      'later',
      'no deadline',
    ])
  })

  it('puts pinned urgency above ordinary news', () => {
    const ordinary = item({ title: 'ordinary', publishedAt: new Date('2026-03-10T00:00:00Z') })
    const urgent = item({
      title: 'urgent',
      priority: 'urgent',
      unread: true,
      publishedAt: new Date('2026-03-01T00:00:00Z'),
    })
    expect(sortInbox([ordinary, urgent])[0]?.title).toBe('urgent')
  })

  it('ranks emergency above urgent when both are pinned', () => {
    const urgent = item({ title: 'urgent', priority: 'urgent', unread: true })
    const emergency = item({ title: 'emergency', priority: 'emergency', unread: true })
    expect(sortInbox([urgent, emergency])[0]?.title).toBe('emergency')
  })

  it('falls back to newest first', () => {
    const old = item({ title: 'old', publishedAt: new Date('2026-01-01T00:00:00Z') })
    const recent = item({ title: 'recent', publishedAt: new Date('2026-03-01T00:00:00Z') })
    expect(sortInbox([old, recent]).map((i) => i.title)).toEqual(['recent', 'old'])
  })

  it('does not lose anything it sorts', () => {
    const items = [item(), item({ priority: 'urgent' }), item({ requiresAcknowledgement: true })]
    expect(sortInbox(items)).toHaveLength(3)
  })
})

describe('quiet hours', () => {
  function profile(overrides: Partial<DeliveryProfile> = {}): DeliveryProfile {
    return {
      employmentId: 'e1',
      timezone: 'America/Los_Angeles',
      quietHoursEnabled: true,
      quietStart: 22 * 60,
      quietEnd: 7 * 60,
      disabled: new Set(),
      ...overrides,
    }
  }

  it('is never quiet when the person has not switched it on', () => {
    const p = profile({ quietHoursEnabled: false })
    // 3am local, which would be inside the window if it were enabled.
    expect(isWithinQuietHours(p, new Date('2026-03-02T11:00:00Z'))).toBe(false)
  })

  it('handles the OVERNIGHT window, which is the normal shape', () => {
    const p = profile()
    // 23:00 Los Angeles.
    expect(isWithinQuietHours(p, new Date('2026-03-02T07:00:00Z'))).toBe(true)
    // 03:00 Los Angeles, past midnight and still inside.
    expect(isWithinQuietHours(p, new Date('2026-03-02T11:00:00Z'))).toBe(true)
    // 12:00 Los Angeles, plainly outside.
    expect(isWithinQuietHours(p, new Date('2026-03-02T20:00:00Z'))).toBe(false)
  })

  it('handles a daytime window too', () => {
    const p = profile({ quietStart: 9 * 60, quietEnd: 17 * 60 })
    expect(isWithinQuietHours(p, new Date('2026-03-02T20:00:00Z'))).toBe(true) // 12:00
    expect(isWithinQuietHours(p, new Date('2026-03-02T07:00:00Z'))).toBe(false) // 23:00
  })

  it('measures the window in the PERSON’S timezone, not the server’s', () => {
    const instant = new Date('2026-03-02T11:00:00Z')
    // 03:00 in Los Angeles - quiet.
    expect(isWithinQuietHours(profile({ timezone: 'America/Los_Angeles' }), instant)).toBe(true)
    // 12:00 in Berlin - awake.
    expect(isWithinQuietHours(profile({ timezone: 'Europe/Berlin' }), instant)).toBe(false)
  })

  it('treats an empty window as no quiet hours', () => {
    const p = profile({ quietStart: 8 * 60, quietEnd: 8 * 60 })
    expect(isWithinQuietHours(p, new Date('2026-03-02T16:00:00Z'))).toBe(false)
  })

  it('delays to the end of the window rather than dropping', () => {
    const p = profile()
    const at3am = new Date('2026-03-02T11:00:00Z')
    const due = nextDeliverableAt(p, at3am)
    expect(due.getTime()).toBeGreaterThan(at3am.getTime())
    // Four hours later: 03:00 -> 07:00 local.
    expect(due.getTime() - at3am.getTime()).toBe(4 * 60 * 60 * 1000)
    expect(isWithinQuietHours(p, due)).toBe(false)
  })

  it('leaves a deliverable instant alone', () => {
    const p = profile()
    const noon = new Date('2026-03-02T20:00:00Z')
    expect(nextDeliverableAt(p, noon)).toEqual(noon)
  })

  it('crosses midnight correctly when delaying from before it', () => {
    const p = profile()
    const at11pm = new Date('2026-03-02T07:00:00Z')
    const due = nextDeliverableAt(p, at11pm)
    // 23:00 -> 07:00 is eight hours.
    expect(due.getTime() - at11pm.getTime()).toBe(8 * 60 * 60 * 1000)
  })
})

describe('the delivery policy', () => {
  const ordinary = { overridesPreferences: false }
  const overriding = { overridesPreferences: true } // Safety, HR, Emergency

  const policy = (priority: string, requiresAcknowledgement: boolean, category = ordinary) =>
    deliveryPolicy({ priority, requiresAcknowledgement }, category)

  it('respects both settings for ordinary news', () => {
    expect(policy('normal', false)).toEqual({
      overridesPreferences: false,
      overridesQuietHours: false,
    })
  })

  it('does NOT interrupt anybody merely because a confirmation is required', () => {
    // A routine "please confirm you read the rota change" waits for morning
    // and respects a muted category. It stays pinned in the inbox instead.
    expect(policy('normal', true)).toEqual({
      overridesPreferences: false,
      overridesQuietHours: false,
    })
    expect(policy('important', true)).toEqual({
      overridesPreferences: false,
      overridesQuietHours: false,
    })
  })

  it('cannot be muted in a safety, HR or emergency category, but still waits for morning', () => {
    expect(policy('normal', true, overriding)).toEqual({
      overridesPreferences: true,
      overridesQuietHours: false,
    })
    expect(policy('important', false, overriding)).toEqual({
      overridesPreferences: true,
      overridesQuietHours: false,
    })
  })

  it('arrives immediately only when URGENT and in a safety, HR or emergency category', () => {
    expect(policy('urgent', true, overriding)).toEqual({
      overridesPreferences: true,
      overridesQuietHours: true,
    })
  })

  it('does not interrupt for an urgent message in an ordinary category', () => {
    expect(policy('urgent', true)).toEqual({
      overridesPreferences: false,
      overridesQuietHours: false,
    })
  })

  it('always overrides both for an emergency, in any category', () => {
    expect(policy('emergency', false)).toEqual({
      overridesPreferences: true,
      overridesQuietHours: true,
    })
  })
})

describe('delivery retries', () => {
  it('backs off 30s, 2m, 8m, 32m, then caps at an hour', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryBackoffMs)).toEqual([
      30_000, 120_000, 480_000, 1_920_000, 3_600_000, 3_600_000,
    ])
  })

  it('gives up after a bounded number of attempts', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBeGreaterThanOrEqual(3)
    expect(MAX_DELIVERY_ATTEMPTS).toBeLessThanOrEqual(10)
  })
})

describe('the default categories', () => {
  it('marks exactly safety, HR and emergency as overriding', () => {
    const overriding = DEFAULT_ANNOUNCEMENT_CATEGORIES.filter((c) => c.overridesPreferences).map(
      (c) => c.key,
    )
    expect(overriding.sort()).toEqual(['emergency', 'hr', 'safety'])
  })

  it('gives every category a stable key and a description', () => {
    for (const category of DEFAULT_ANNOUNCEMENT_CATEGORIES) {
      expect(category.key).toMatch(/^[a-z_]+$/)
      expect(category.description.length).toBeGreaterThan(10)
    }
  })

  it('has no duplicate keys', () => {
    const keys = DEFAULT_ANNOUNCEMENT_CATEGORIES.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
