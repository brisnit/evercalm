import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  archiveChannel,
  createChannel,
  getChannel,
  getThread,
  listChannels,
  listThreads,
  markThreadRead,
  MAX_CUSTOM_CHANNELS,
  messageablePeople,
  openThread,
  postToChannel,
  sendDirectMessage,
  unreadThreadCount,
} from '@/modules/messaging/service'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

/**
 * CHANNELS AND DIRECT MESSAGES, against real PostgreSQL.
 *
 * The promises under test:
 *
 *   two channels is a ceiling, not a suggestion
 *   a managers-only channel is invisible AND unreadable to an employee
 *   an employee can reach their own manager and nobody else
 *   a conversation opened twice is one conversation
 *   a thread belongs to its two people and to nobody else
 *   reading marks the other person's messages read, never your own
 */

let harborId: string
const userIds = new Map<string, string>()

const OWNER = 'dana@harborvine.test'
const GM_RIVERSIDE = 'marcus@harborvine.test'
const EMPLOYEE = 'sam@harborvine.test'
const OTHER_EMPLOYEE = 'camille@harborvine.test'
const SHIFT_LEAD = 'jordan@harborvine.test'

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  const pool = await migrationClient()
  const users = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of users.rows) userIds.set(row.email, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

async function actorFor(email: string): Promise<Actor> {
  const userId = userIds.get(email)
  if (!userId) throw new Error(`Seeded user ${email} not found`)
  const actor = await asTenant(harborId, (tx) => resolveActor(tx, harborId, userId))
  if (!actor) throw new Error(`No actor for ${email}`)
  return actor
}

/** Leave the organization with no channels, whatever the seed did. */
async function clearChannels() {
  const pool = await migrationClient()
  await pool.query('delete from channel_messages where organization_id = $1', [harborId])
  await pool.query('delete from channels where organization_id = $1', [harborId])
}

async function clearThreads() {
  const pool = await migrationClient()
  await pool.query('delete from direct_messages where organization_id = $1', [harborId])
  await pool.query('delete from direct_threads where organization_id = $1', [harborId])
}

describe('the two-channel ceiling', () => {
  it('refuses a third channel, and says why', async () => {
    await clearChannels()
    const owner = await actorFor(OWNER)

    for (let i = 0; i < MAX_CUSTOM_CHANNELS; i += 1) {
      await asTenant(harborId, (tx) =>
        createChannel(tx, owner, { name: `Room ${i}`, audience: 'everyone' }),
      )
    }

    await expect(
      asTenant(harborId, (tx) =>
        createChannel(tx, owner, { name: 'One too many', audience: 'everyone' }),
      ),
    ).rejects.toThrow(ValidationError)

    // Archiving frees the slot, and the archived channel is gone from the list.
    const list = await asTenant(harborId, (tx) => listChannels(tx, owner))
    await asTenant(harborId, (tx) => archiveChannel(tx, owner, list[0]!.id))
    const after = await asTenant(harborId, (tx) => listChannels(tx, owner))
    expect(after).toHaveLength(MAX_CUSTOM_CHANNELS - 1)

    await expect(
      asTenant(harborId, (tx) =>
        createChannel(tx, owner, { name: 'Now there is room', audience: 'everyone' }),
      ),
    ).resolves.toBeTruthy()
  })

  it('will not let a manager without moderation open one', async () => {
    await clearChannels()
    const gm = await actorFor(GM_RIVERSIDE)
    await expect(
      asTenant(harborId, (tx) => createChannel(tx, gm, { name: 'Mine', audience: 'everyone' })),
    ).rejects.toThrow(ForbiddenError)
  })

  it('refuses two channels with the same name', async () => {
    await clearChannels()
    const owner = await actorFor(OWNER)
    await asTenant(harborId, (tx) =>
      createChannel(tx, owner, { name: 'Floor', audience: 'everyone' }),
    )
    await expect(
      asTenant(harborId, (tx) => createChannel(tx, owner, { name: 'Floor', audience: 'managers' })),
    ).rejects.toThrow(ValidationError)
  })
})

describe('a managers-only channel', () => {
  it('is neither listed nor readable for an employee', async () => {
    await clearChannels()
    const owner = await actorFor(OWNER)
    const employee = await actorFor(EMPLOYEE)

    const open = await asTenant(harborId, (tx) =>
      createChannel(tx, owner, { name: 'Everyone', audience: 'everyone' }),
    )
    const closed = await asTenant(harborId, (tx) =>
      createChannel(tx, owner, { name: 'Managers', audience: 'managers' }),
    )

    const seen = await asTenant(harborId, (tx) => listChannels(tx, employee))
    expect(seen.map((c) => c.id)).toEqual([open])

    // Knowing the id is not access.
    await expect(asTenant(harborId, (tx) => getChannel(tx, employee, closed))).rejects.toThrow(
      ForbiddenError,
    )
    await expect(
      asTenant(harborId, (tx) => postToChannel(tx, employee, closed, 'Let me in')),
    ).rejects.toThrow(ForbiddenError)

    // The open one they can both read and post to.
    await asTenant(harborId, (tx) => postToChannel(tx, employee, open, 'Table 14 wobbles.'))
    const channel = await asTenant(harborId, (tx) => getChannel(tx, employee, open))
    expect(channel.messages.map((m) => m.body)).toContain('Table 14 wobbles.')
    expect(channel.messages[0]!.mine).toBe(true)
  })
})

describe('who an employee may message', () => {
  it('offers their own manager and nobody else', async () => {
    const employee = await actorFor(EMPLOYEE)
    const people = await asTenant(harborId, (tx) => messageablePeople(tx, employee))
    expect(people.map((p) => p.name)).toEqual(['Jordan Vega'])
  })

  it('refuses a conversation with somebody they do not report to', async () => {
    const employee = await actorFor(EMPLOYEE)
    const pool = await migrationClient()
    const { rows } = await pool.query<{ id: string }>(
      'select id from employments where organization_id = $1 and email = $2',
      [harborId, OTHER_EMPLOYEE],
    )
    await expect(asTenant(harborId, (tx) => openThread(tx, employee, rows[0]!.id))).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('lets a manager reach anyone, and opening twice is one conversation', async () => {
    await clearThreads()
    const gm = await actorFor(GM_RIVERSIDE)
    const employee = await actorFor(EMPLOYEE)

    const first = await asTenant(harborId, (tx) => openThread(tx, gm, employee.employmentId))
    const second = await asTenant(harborId, (tx) => openThread(tx, gm, employee.employmentId))
    expect(second).toBe(first)
  })

  it('is the same row whichever of the two people opens it', async () => {
    await clearThreads()
    const employee = await actorFor(EMPLOYEE)
    const lead = await actorFor(SHIFT_LEAD)

    // Sam reports to Jordan, so each may reach the other - Sam through the
    // reporting line, Jordan because Sam reports to them. Neither of them
    // holds conversation.start.
    const fromEmployee = await asTenant(harborId, (tx) =>
      openThread(tx, employee, lead.employmentId),
    )
    const fromLead = await asTenant(harborId, (tx) => openThread(tx, lead, employee.employmentId))
    expect(fromLead).toBe(fromEmployee)
  })

  it('refuses a conversation with yourself', async () => {
    const gm = await actorFor(GM_RIVERSIDE)
    await expect(asTenant(harborId, (tx) => openThread(tx, gm, gm.employmentId))).rejects.toThrow(
      ValidationError,
    )
  })
})

describe('a thread belongs to its two people', () => {
  it('is not found for anybody else, and reading marks only what they received', async () => {
    await clearThreads()
    const gm = await actorFor(GM_RIVERSIDE)
    const employee = await actorFor(EMPLOYEE)
    const outsider = await actorFor(OWNER)

    const threadId = await asTenant(harborId, (tx) => openThread(tx, gm, employee.employmentId))
    await asTenant(harborId, (tx) => sendDirectMessage(tx, gm, threadId, 'Can you take Saturday?'))

    // The owner is not in it, so it does not exist for them.
    await expect(asTenant(harborId, (tx) => getThread(tx, outsider, threadId))).rejects.toThrow(
      NotFoundError,
    )
    await expect(
      asTenant(harborId, (tx) => sendDirectMessage(tx, outsider, threadId, 'Butting in')),
    ).rejects.toThrow(NotFoundError)

    // The employee has one unread; the manager has none of their own.
    expect(await asTenant(harborId, (tx) => unreadThreadCount(tx, employee))).toBe(1)
    expect(await asTenant(harborId, (tx) => unreadThreadCount(tx, gm))).toBe(0)

    await asTenant(harborId, (tx) => markThreadRead(tx, employee, threadId))
    expect(await asTenant(harborId, (tx) => unreadThreadCount(tx, employee))).toBe(0)

    // Replying puts the unread back on the other side, not on the sender.
    await asTenant(harborId, (tx) => sendDirectMessage(tx, employee, threadId, 'Yes, that works.'))
    expect(await asTenant(harborId, (tx) => unreadThreadCount(tx, gm))).toBe(1)
    expect(await asTenant(harborId, (tx) => unreadThreadCount(tx, employee))).toBe(0)

    const threads = await asTenant(harborId, (tx) => listThreads(tx, gm))
    expect(threads[0]!.lastBody).toBe('Yes, that works.')
    expect(threads[0]!.otherName).toBe('Sam Whitfield')
  })

  it('refuses an empty message', async () => {
    await clearThreads()
    const gm = await actorFor(GM_RIVERSIDE)
    const employee = await actorFor(EMPLOYEE)
    const threadId = await asTenant(harborId, (tx) => openThread(tx, gm, employee.employmentId))
    await expect(
      asTenant(harborId, (tx) => sendDirectMessage(tx, gm, threadId, '   ')),
    ).rejects.toThrow(ValidationError)
  })
})
