import { and, asc, count, desc, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { channelMessages, channels, directMessages, directThreads } from './schema'
import { employments } from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { canAtAnyLocation } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import type { ChannelAudience } from './schema'

/**
 * CHANNELS AND DIRECT MESSAGES.
 *
 * Round 2 draws a hard line around this feature: announcements for anything
 * that must be read, at most two channels for the ongoing conversation of the
 * business, and a direct thread between two people for everything else. This
 * module refuses to become a chat product, and the refusal is enforced here
 * rather than in a form.
 *
 * WHO MAY DO WHAT, and why it needs no new capability:
 *
 *   creating or archiving a channel   conversation.moderate - shaping the
 *                                     organization's rooms is an owner act
 *   posting in a channel              being in its audience
 *   reading a managers-only channel   announcement.create - the people who can
 *                                     already speak for the business
 *   starting a direct thread          conversation.start, OR the two people
 *                                     already report to one another
 *
 * That last clause is the only rule here that is not a capability check. An
 * employee holds no capabilities at all - self-access never needs one - and a
 * person must be able to message the manager they report to. It is deliberately
 * the narrowest possible opening: their own manager, nobody else's.
 */

export const MAX_CUSTOM_CHANNELS = 2

const MAX_BODY = 4000

/**
 * A manager for the purpose of a managers-only room.
 *
 * The people who can already speak for the business - not everybody who can
 * see the directory. A shift lead is a keyholder, not a manager, and the same
 * rule governs a managers-only document, so the two never disagree.
 */
function isManager(actor: Actor): boolean {
  return canAtAnyLocation(actor, 'announcement.create')
}

function cleanBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) throw new ValidationError({ body: ['Write a message first'] })
  if (trimmed.length > MAX_BODY) throw new ValidationError({ body: ['That message is too long'] })
  return trimmed
}

// --- channels --------------------------------------------------------------

export interface ChannelSummary {
  id: string
  name: string
  purpose: string | null
  audience: ChannelAudience
  messageCount: number
  lastMessageAt: Date | null
  lastAuthor: string | null
  lastBody: string | null
}

export async function listChannels(tx: Tx, actor: Actor): Promise<ChannelSummary[]> {
  const rows = await tx
    .select({
      id: channels.id,
      name: channels.name,
      purpose: channels.purpose,
      audience: channels.audience,
      messageCount: count(channelMessages.id),
      lastMessageAt: sql<Date | null>`max(${channelMessages.createdAt})`,
    })
    .from(channels)
    .leftJoin(
      channelMessages,
      and(
        eq(channelMessages.organizationId, channels.organizationId),
        eq(channelMessages.channelId, channels.id),
      ),
    )
    .where(and(eq(channels.organizationId, actor.organizationId), isNull(channels.archivedAt)))
    .groupBy(channels.id, channels.name, channels.purpose, channels.audience, channels.createdAt)
    .orderBy(asc(channels.createdAt))

  const visible = rows.filter((row) => row.audience === 'everyone' || isManager(actor))

  // The most recent line, so the list reads as a conversation rather than a
  // directory of empty rooms.
  const out: ChannelSummary[] = []
  for (const row of visible) {
    const [last] = await tx
      .select({
        body: channelMessages.body,
        author: employments.displayName,
        createdAt: channelMessages.createdAt,
      })
      .from(channelMessages)
      .innerJoin(
        employments,
        and(
          eq(employments.organizationId, channelMessages.organizationId),
          eq(employments.id, channelMessages.authorEmploymentId),
        ),
      )
      .where(
        and(
          eq(channelMessages.organizationId, actor.organizationId),
          eq(channelMessages.channelId, row.id),
        ),
      )
      .orderBy(desc(channelMessages.createdAt))
      .limit(1)

    out.push({
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      audience: row.audience as ChannelAudience,
      messageCount: Number(row.messageCount),
      lastMessageAt: last?.createdAt ?? null,
      lastAuthor: last?.author ?? null,
      lastBody: last?.body ?? null,
    })
  }
  return out
}

export async function countChannels(tx: Tx, actor: Actor): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(channels)
    .where(and(eq(channels.organizationId, actor.organizationId), isNull(channels.archivedAt)))
  return Number(row?.total ?? 0)
}

export async function createChannel(
  tx: Tx,
  actor: Actor,
  input: { name: string; purpose?: string | null; audience: ChannelAudience },
): Promise<string> {
  if (!canAtAnyLocation(actor, 'conversation.moderate')) {
    throw new ForbiddenError('You cannot create channels')
  }

  const name = input.name.trim()
  if (!name) throw new ValidationError({ name: ['Give the channel a name'] })
  if (name.length > 60) throw new ValidationError({ name: ['That name is too long'] })
  if (input.audience !== 'managers' && input.audience !== 'everyone') {
    throw new ValidationError({ audience: ['Choose who the channel is for'] })
  }

  // The ceiling is the product decision, so it is stated here in words a
  // person can read rather than as a silent database constraint.
  if ((await countChannels(tx, actor)) >= MAX_CUSTOM_CHANNELS) {
    throw new ValidationError({
      name: [
        `You already have ${MAX_CUSTOM_CHANNELS} channels. Archive one before adding another - two is the limit on purpose, so nothing gets missed.`,
      ],
    })
  }

  const [clash] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.organizationId, actor.organizationId), eq(channels.name, name)))
    .limit(1)
  if (clash) throw new ValidationError({ name: ['A channel already has that name'] })

  const id = newId()
  await tx.insert(channels).values({
    id,
    organizationId: actor.organizationId,
    name,
    purpose: input.purpose?.trim() || null,
    audience: input.audience,
    createdByEmploymentId: actor.employmentId,
  })
  return id
}

export async function archiveChannel(tx: Tx, actor: Actor, channelId: string): Promise<void> {
  if (!canAtAnyLocation(actor, 'conversation.moderate')) {
    throw new ForbiddenError('You cannot archive channels')
  }
  const result = await tx
    .update(channels)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(channels.organizationId, actor.organizationId),
        eq(channels.id, channelId),
        isNull(channels.archivedAt),
      ),
    )
  if ((result.rowCount ?? 0) === 0) throw new NotFoundError('Channel not found')
}

export interface ChannelMessage {
  id: string
  body: string
  createdAt: Date
  authorId: string
  authorName: string
  mine: boolean
}

export async function getChannel(tx: Tx, actor: Actor, channelId: string) {
  const [channel] = await tx
    .select({
      id: channels.id,
      name: channels.name,
      purpose: channels.purpose,
      audience: channels.audience,
    })
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, actor.organizationId),
        eq(channels.id, channelId),
        isNull(channels.archivedAt),
      ),
    )
    .limit(1)
  if (!channel) throw new NotFoundError('Channel not found')
  if (channel.audience === 'managers' && !isManager(actor)) {
    throw new ForbiddenError('That channel is for managers')
  }

  const rows = await tx
    .select({
      id: channelMessages.id,
      body: channelMessages.body,
      createdAt: channelMessages.createdAt,
      authorId: channelMessages.authorEmploymentId,
      authorName: employments.displayName,
    })
    .from(channelMessages)
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, channelMessages.organizationId),
        eq(employments.id, channelMessages.authorEmploymentId),
      ),
    )
    .where(
      and(
        eq(channelMessages.organizationId, actor.organizationId),
        eq(channelMessages.channelId, channelId),
      ),
    )
    .orderBy(asc(channelMessages.createdAt))

  return {
    ...channel,
    audience: channel.audience as ChannelAudience,
    messages: rows.map((row): ChannelMessage => ({
      ...row,
      mine: row.authorId === actor.employmentId,
    })),
  }
}

export async function postToChannel(
  tx: Tx,
  actor: Actor,
  channelId: string,
  body: string,
): Promise<void> {
  // getChannel already decides whether this person belongs in the room.
  await getChannel(tx, actor, channelId)
  await tx.insert(channelMessages).values({
    id: newId(),
    organizationId: actor.organizationId,
    channelId,
    authorEmploymentId: actor.employmentId,
    body: cleanBody(body),
  })
}

// --- direct messages -------------------------------------------------------

/** The pair, in the canonical order the table's check constraint requires. */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export interface ThreadSummary {
  id: string
  otherId: string
  otherName: string
  otherJobTitle: string | null
  lastMessageAt: Date | null
  lastBody: string | null
  unread: number
}

export async function listThreads(tx: Tx, actor: Actor): Promise<ThreadSummary[]> {
  const rows = await tx
    .select({
      id: directThreads.id,
      one: directThreads.participantOneId,
      two: directThreads.participantTwoId,
      lastMessageAt: directThreads.lastMessageAt,
    })
    .from(directThreads)
    .where(
      and(
        eq(directThreads.organizationId, actor.organizationId),
        or(
          eq(directThreads.participantOneId, actor.employmentId),
          eq(directThreads.participantTwoId, actor.employmentId),
        ),
      ),
    )
    .orderBy(desc(directThreads.lastMessageAt))

  const out: ThreadSummary[] = []
  for (const row of rows) {
    const otherId = row.one === actor.employmentId ? row.two : row.one
    const [other] = await tx
      .select({ name: employments.displayName, jobTitle: employments.jobTitle })
      .from(employments)
      .where(and(eq(employments.organizationId, actor.organizationId), eq(employments.id, otherId)))
      .limit(1)

    const [last] = await tx
      .select({ body: directMessages.body })
      .from(directMessages)
      .where(
        and(
          eq(directMessages.organizationId, actor.organizationId),
          eq(directMessages.threadId, row.id),
        ),
      )
      .orderBy(desc(directMessages.createdAt))
      .limit(1)

    const [unread] = await tx
      .select({ total: count() })
      .from(directMessages)
      .where(
        and(
          eq(directMessages.organizationId, actor.organizationId),
          eq(directMessages.threadId, row.id),
          ne(directMessages.authorEmploymentId, actor.employmentId),
          isNull(directMessages.readAt),
        ),
      )

    out.push({
      id: row.id,
      otherId,
      otherName: other?.name ?? 'Someone',
      otherJobTitle: other?.jobTitle ?? null,
      lastMessageAt: row.lastMessageAt,
      lastBody: last?.body ?? null,
      unread: Number(unread?.total ?? 0),
    })
  }
  return out
}

export async function unreadThreadCount(tx: Tx, actor: Actor): Promise<number> {
  const [row] = await tx
    .select({ total: count(sql`distinct ${directMessages.threadId}`) })
    .from(directMessages)
    .innerJoin(
      directThreads,
      and(
        eq(directThreads.organizationId, directMessages.organizationId),
        eq(directThreads.id, directMessages.threadId),
      ),
    )
    .where(
      and(
        eq(directMessages.organizationId, actor.organizationId),
        ne(directMessages.authorEmploymentId, actor.employmentId),
        isNull(directMessages.readAt),
        or(
          eq(directThreads.participantOneId, actor.employmentId),
          eq(directThreads.participantTwoId, actor.employmentId),
        ),
      ),
    )
  return Number(row?.total ?? 0)
}

/** Everyone this person is allowed to open a new conversation with. */
export async function messageablePeople(tx: Tx, actor: Actor) {
  const rows = await tx
    .select({
      id: employments.id,
      name: employments.displayName,
      jobTitle: employments.jobTitle,
      managerEmploymentId: employments.managerEmploymentId,
    })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.status, 'active'),
        isNull(employments.archivedAt),
        ne(employments.id, actor.employmentId),
      ),
    )
    .orderBy(asc(employments.displayName))

  if (canAtAnyLocation(actor, 'conversation.start')) {
    return rows.map(({ id, name, jobTitle }) => ({ id, name, jobTitle }))
  }

  // Without that capability, exactly one door: the manager they report to.
  const [me] = await tx
    .select({ managerEmploymentId: employments.managerEmploymentId })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, actor.employmentId),
      ),
    )
    .limit(1)

  return rows
    .filter(
      (row) => row.id === me?.managerEmploymentId || row.managerEmploymentId === actor.employmentId,
    )
    .map(({ id, name, jobTitle }) => ({ id, name, jobTitle }))
}

export async function openThread(tx: Tx, actor: Actor, otherId: string): Promise<string> {
  if (otherId === actor.employmentId) {
    throw new ValidationError({ employmentId: ['Choose somebody else to message'] })
  }

  const allowed = await messageablePeople(tx, actor)
  if (!allowed.some((person: { id: string }) => person.id === otherId)) {
    throw new ForbiddenError('You cannot start a conversation with that person')
  }

  const [one, two] = pair(actor.employmentId, otherId)
  const [existing] = await tx
    .select({ id: directThreads.id })
    .from(directThreads)
    .where(
      and(
        eq(directThreads.organizationId, actor.organizationId),
        eq(directThreads.participantOneId, one),
        eq(directThreads.participantTwoId, two),
      ),
    )
    .limit(1)
  if (existing) return existing.id

  const id = newId()
  await tx.insert(directThreads).values({
    id,
    organizationId: actor.organizationId,
    participantOneId: one,
    participantTwoId: two,
  })
  return id
}

async function loadThread(tx: Tx, actor: Actor, threadId: string) {
  const [thread] = await tx
    .select({
      id: directThreads.id,
      one: directThreads.participantOneId,
      two: directThreads.participantTwoId,
    })
    .from(directThreads)
    .where(
      and(eq(directThreads.organizationId, actor.organizationId), eq(directThreads.id, threadId)),
    )
    .limit(1)
  if (!thread) throw new NotFoundError('Conversation not found')
  if (thread.one !== actor.employmentId && thread.two !== actor.employmentId) {
    // Not a participant: indistinguishable from a conversation that is not there.
    throw new NotFoundError('Conversation not found')
  }
  return thread
}

export async function getThread(tx: Tx, actor: Actor, threadId: string) {
  const thread = await loadThread(tx, actor, threadId)
  const otherId = thread.one === actor.employmentId ? thread.two : thread.one

  const [other] = await tx
    .select({ name: employments.displayName, jobTitle: employments.jobTitle })
    .from(employments)
    .where(and(eq(employments.organizationId, actor.organizationId), eq(employments.id, otherId)))
    .limit(1)

  const messages = await tx
    .select({
      id: directMessages.id,
      body: directMessages.body,
      createdAt: directMessages.createdAt,
      authorId: directMessages.authorEmploymentId,
      readAt: directMessages.readAt,
    })
    .from(directMessages)
    .where(
      and(
        eq(directMessages.organizationId, actor.organizationId),
        eq(directMessages.threadId, threadId),
      ),
    )
    .orderBy(asc(directMessages.createdAt))

  return {
    id: thread.id,
    otherId,
    otherName: other?.name ?? 'Someone',
    otherJobTitle: other?.jobTitle ?? null,
    messages: messages.map((m) => ({ ...m, mine: m.authorId === actor.employmentId })),
  }
}

/** Opening a conversation is reading it. */
export async function markThreadRead(tx: Tx, actor: Actor, threadId: string): Promise<void> {
  await loadThread(tx, actor, threadId)
  await tx
    .update(directMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(directMessages.organizationId, actor.organizationId),
        eq(directMessages.threadId, threadId),
        ne(directMessages.authorEmploymentId, actor.employmentId),
        isNull(directMessages.readAt),
      ),
    )
}

export async function sendDirectMessage(
  tx: Tx,
  actor: Actor,
  threadId: string,
  body: string,
): Promise<void> {
  await loadThread(tx, actor, threadId)
  const now = new Date()
  await tx.insert(directMessages).values({
    id: newId(),
    organizationId: actor.organizationId,
    threadId,
    authorEmploymentId: actor.employmentId,
    body: cleanBody(body),
    createdAt: now,
  })
  await tx
    .update(directThreads)
    .set({ lastMessageAt: now })
    .where(
      and(eq(directThreads.organizationId, actor.organizationId), eq(directThreads.id, threadId)),
    )
}
