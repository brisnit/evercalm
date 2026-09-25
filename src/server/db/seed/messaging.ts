import { newId } from '@/lib/ids'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../full-schema'

type SeedDb = NodePgDatabase<typeof schema>

/**
 * Channels and direct messages for the demo.
 *
 * Harbor & Vine uses both of its channels - one for the floor, one for the
 * managers - and has real conversations running between a manager and two of
 * their people. Lumen uses one, because a two-salon operator would. The text
 * is the text of a restaurant and a salon: nobody says "Lorem", and nobody
 * says "Test message 1".
 */

interface Ctx {
  organizationId: string
  slug: string
  employmentIds: Map<string, string>
}

interface SeedChannel {
  name: string
  purpose: string
  audience: 'managers' | 'everyone'
  createdBy: string
  messages: { from: string; body: string; hoursAgo: number }[]
}

interface SeedThread {
  a: string
  b: string
  messages: { from: string; body: string; hoursAgo: number; read?: boolean }[]
}

const HARBOR_CHANNELS: SeedChannel[] = [
  {
    name: 'Floor',
    purpose: 'Anything the room needs to know before doors.',
    audience: 'everyone',
    createdBy: 'owner',
    messages: [
      {
        from: 'gm-riverside',
        body: 'Two 8-tops on the book for Friday at 7. Jordan is running the section, so keep table 14 clear until 6:45.',
        hoursAgo: 52,
      },
      {
        from: 'bartender',
        body: 'We are out of the Amaro until the Tuesday delivery. Pushing the Paper Plane, and the substitution is on the rail card.',
        hoursAgo: 41,
      },
      {
        from: 'server',
        body: 'Thanks Camille — I had two tables ask for it last night.',
        hoursAgo: 39,
      },
      {
        from: 'lead-riverside',
        body: 'New linen order came in short by six aprons. Using the back stock for now; do not take the last two off the rack.',
        hoursAgo: 20,
      },
      {
        from: 'sous',
        body: 'Soup tonight is the roasted squash. It has cream in it, so it is not the vegan option — please say so before anyone asks.',
        hoursAgo: 5,
      },
    ],
  },
  {
    name: 'Managers',
    purpose: 'Between the people who close the building.',
    audience: 'managers',
    createdBy: 'owner',
    messages: [
      {
        from: 'owner',
        body: 'Labour ran 31.4% last week across both rooms. Downtown is carrying it; Riverside is a point and a half over. Not a crisis, but let us not add a shift on Tuesday.',
        hoursAgo: 60,
      },
      {
        from: 'gm-downtown',
        body: 'Understood. I have one host shift I can drop Tuesday without hurting the door.',
        hoursAgo: 58,
      },
      {
        from: 'gm-riverside',
        body: 'Dmitri is still waiting on his food handler card — county course is the 18th. I am keeping him off the line until it clears.',
        hoursAgo: 30,
      },
      {
        from: 'hr',
        body: 'Good. That is the right call, and I have noted it on his onboarding so nobody schedules around it by accident.',
        hoursAgo: 28,
      },
    ],
  },
]

const HARBOR_THREADS: SeedThread[] = [
  {
    a: 'gm-riverside',
    b: 'server',
    messages: [
      {
        from: 'gm-riverside',
        body: 'Sam — can you take Saturday night? Ava asked for it off and I would rather not move Jordan.',
        hoursAgo: 26,
        read: true,
      },
      {
        from: 'server',
        body: 'Yes, that works. I am off Sunday anyway so the double is fine.',
        hoursAgo: 25,
        read: true,
      },
      {
        from: 'gm-riverside',
        body: 'Appreciated. I have put you on the 4pm — same section as last week.',
        hoursAgo: 25,
        read: true,
      },
    ],
  },
  {
    a: 'gm-riverside',
    b: 'host',
    messages: [
      {
        from: 'host',
        body: 'Marcus, my bus route changed and the new one gets me in at 4:10 instead of 3:55. Is that a problem for the Tuesday open?',
        hoursAgo: 8,
      },
      {
        from: 'gm-riverside',
        body: 'Not a problem. Start you at 4:15 on Tuesdays and I will move the phone checks to Jordan.',
        hoursAgo: 7,
        read: true,
      },
      {
        from: 'host',
        body: 'Thank you — that takes a lot of stress off.',
        hoursAgo: 6,
      },
    ],
  },
]

const LUMEN_CHANNELS: SeedChannel[] = [
  {
    name: 'Both salons',
    purpose: 'Product, education and anything that crosses the two rooms.',
    audience: 'everyone',
    createdBy: 'owner',
    messages: [
      {
        from: 'owner',
        body: 'The new bond builder lands Thursday. Yuki is running a thirty-minute walkthrough at both salons before open — it counts toward your education hours.',
        hoursAgo: 44,
      },
      {
        from: 'trainer',
        body: 'Bring a mannequin head if your station has one. We will do two full applications rather than talk about it.',
        hoursAgo: 40,
      },
    ],
  },
]

export async function seedMessaging(db: SeedDb, ctx: Ctx, now = new Date()) {
  const channels = ctx.slug === 'harbor-vine' ? HARBOR_CHANNELS : LUMEN_CHANNELS
  const threads = ctx.slug === 'harbor-vine' ? HARBOR_THREADS : []
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000)

  let messageCount = 0

  for (const channel of channels) {
    const createdBy = ctx.employmentIds.get(channel.createdBy)
    if (!createdBy) continue
    const channelId = newId()
    await db.insert(schema.channels).values({
      id: channelId,
      organizationId: ctx.organizationId,
      name: channel.name,
      purpose: channel.purpose,
      audience: channel.audience,
      createdByEmploymentId: createdBy,
      createdAt: at(72),
    })

    for (const message of channel.messages) {
      const author = ctx.employmentIds.get(message.from)
      if (!author) continue
      await db.insert(schema.channelMessages).values({
        id: newId(),
        organizationId: ctx.organizationId,
        channelId,
        authorEmploymentId: author,
        body: message.body,
        createdAt: at(message.hoursAgo),
      })
      messageCount += 1
    }
  }

  for (const thread of threads) {
    const first = ctx.employmentIds.get(thread.a)
    const second = ctx.employmentIds.get(thread.b)
    if (!first || !second) continue
    // The table stores the pair in one canonical order.
    const [one, two] = first < second ? [first, second] : [second, first]
    const threadId = newId()
    const last = Math.min(...thread.messages.map((m) => m.hoursAgo))

    await db.insert(schema.directThreads).values({
      id: threadId,
      organizationId: ctx.organizationId,
      participantOneId: one,
      participantTwoId: two,
      createdAt: at(Math.max(...thread.messages.map((m) => m.hoursAgo))),
      lastMessageAt: at(last),
    })

    for (const message of thread.messages) {
      const author = ctx.employmentIds.get(message.from)
      if (!author) continue
      await db.insert(schema.directMessages).values({
        id: newId(),
        organizationId: ctx.organizationId,
        threadId,
        authorEmploymentId: author,
        body: message.body,
        createdAt: at(message.hoursAgo),
        readAt: message.read ? at(message.hoursAgo - 0.2) : null,
      })
      messageCount += 1
    }
  }

  return { channels: channels.length, threads: threads.length, messages: messageCount }
}
