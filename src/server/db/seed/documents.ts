import { newId } from '@/lib/ids'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../full-schema'
import { simplePdf } from './pdf'

type SeedDb = NodePgDatabase<typeof schema>

/**
 * The documents a real operator is asked for.
 *
 * Every one of these opens: the seed writes an actual PDF or text file, so
 * clicking a row in the hub does what clicking a row should do. The contents
 * are a page of the real thing, not lorem.
 */

interface SeedDocument {
  title: string
  description: string
  category: 'policy' | 'safety' | 'training' | 'operations' | 'legal' | 'other'
  visibility: 'everyone' | 'managers'
  location?: string
  fileName: string
  lines: string[]
  text?: string
}

const HARBOR: SeedDocument[] = [
  {
    title: 'Employee handbook',
    description: 'How we work, what we expect, and what you can expect from us.',
    category: 'policy',
    visibility: 'everyone',
    fileName: 'harbor-vine-handbook.pdf',
    lines: [
      'Harbor & Vine · Employee Handbook · 2026 edition',
      '',
      'Who we are. Two rooms, one kitchen philosophy, and a crew that stays.',
      'Hours and scheduling. Schedules are published a week ahead in EverCalm.',
      'Availability. Keep yours current; we schedule from what you tell us.',
      'Time off. Request it in the app. Approved time off is never scheduled over.',
      'Breaks. Thirty minutes on a shift over five hours, staggered by role.',
      'Uniform. Clean black, closed shoes, apron provided.',
      'Calling out. Call the manager on duty. Do not text the group chat.',
      'Tips. Pooled by hours worked, distributed weekly.',
      'Raising a problem. Your manager first; Priya Raman if that is not right.',
    ],
  },
  {
    title: 'Allergen matrix',
    description: 'Every dish on the current menu against the fourteen declarable allergens.',
    category: 'safety',
    visibility: 'everyone',
    fileName: 'allergen-matrix.pdf',
    lines: [
      'Current as of the winter menu change.',
      '',
      'Roasted squash soup — dairy (cream). Not the vegan option.',
      'Little gem salad — egg (dressing), mustard.',
      'Pappardelle — gluten, egg, dairy.',
      'Hearth bread — gluten, sesame.',
      'Salt-baked celeriac — celery. Vegan as served.',
      'Duck leg — none declarable. Fryer is shared with gluten items.',
      '',
      'If a guest asks about a dish that is not on this sheet, ask the chef.',
      'Never answer from memory. Never answer from this sheet if the menu changed today.',
    ],
  },
  {
    title: 'Closing checklist — Riverside',
    description: 'What has to be true before the last person leaves.',
    category: 'operations',
    visibility: 'everyone',
    location: 'riverside',
    fileName: 'closing-riverside.pdf',
    lines: [
      'Front of house',
      'Tables reset, candles out, chairs down.',
      'Rail wiped, last rack run, mats up to dry.',
      'Drawer counted with a second person, sheet signed.',
      '',
      'Kitchen',
      'Line broken down, pans cooling in shallow trays, labelled with the time.',
      'Walk-in temperature recorded on the sheet by the door.',
      'Gas off at the wall. Hood off. Fryer covered.',
      '',
      'Building',
      'Back door checked, alarm set, last person out texts the manager on duty.',
    ],
  },
  {
    title: 'Food handler card requirements',
    description: 'What Sacramento County requires, and how to get yours.',
    category: 'legal',
    visibility: 'everyone',
    fileName: 'food-handler-card.pdf',
    lines: [
      'Every person who handles food needs a California Food Handler Card',
      'within 30 days of hire, renewed every three years.',
      '',
      'The county course takes about ninety minutes and costs under twenty dollars.',
      'We reimburse it on your next cheque — send the receipt to Priya.',
      '',
      'Upload the card to your profile in EverCalm as soon as you have it.',
      'Until it is on file we cannot schedule you on the line.',
    ],
  },
  {
    title: 'Manager opening pack',
    description: 'Cash handling, comps, voids, and what to do when the POS is down.',
    category: 'operations',
    visibility: 'managers',
    fileName: 'manager-opening-pack.pdf',
    lines: [
      'Managers only. Do not leave this on the pass.',
      '',
      'Safe combination changes on the first of each quarter. Ask Dana in person.',
      'Comps over $50 need a second manager and a line on the incident log.',
      'Voids after a check is closed go through Dana, not the terminal.',
      '',
      'If the POS is down: paper tickets, hand-write the check, ring it in after.',
      'Do not turn guests away. The card reader has an offline mode — see page two.',
    ],
  },
]

const LUMEN: SeedDocument[] = [
  {
    title: 'Employee handbook',
    description: 'How the salon runs, and what you can expect from us.',
    category: 'policy',
    visibility: 'everyone',
    fileName: 'lumen-handbook.pdf',
    lines: [
      'Lumen Salon & Spa · Employee Handbook',
      '',
      'Booking and columns. Your column is yours; blocking it is a conversation.',
      'Product. Back bar is stocked weekly. Tell Riley before you run out, not after.',
      'Licences. Keep yours current in EverCalm; we cannot book you without it.',
      'Education. Two paid education days a year, plus in-salon sessions.',
    ],
  },
  {
    title: 'Colour service record',
    description: 'The form to complete for every colour service, kept for two years.',
    category: 'legal',
    visibility: 'everyone',
    fileName: 'colour-record.txt',
    lines: [],
    text: `COLOUR SERVICE RECORD

Client name: ______________________________  Date: ______________

Patch test done (date): ____________  Result: ____________________

Previous colour history (including home colour):
_____________________________________________________________

Formula:
  Base ______________  Developer ____________  Time __________
  Toner _____________  Developer ____________  Time __________

Result and notes for next time:
_____________________________________________________________

Stylist: ______________________  Client signature: ______________
`,
  },
]

export async function seedDocuments(
  db: SeedDb,
  ctx: {
    organizationId: string
    slug: string
    locationIds: Map<string, string>
    employmentIds: Map<string, string>
  },
) {
  const plan = ctx.slug === 'harbor-vine' ? HARBOR : LUMEN
  const uploader = ctx.employmentIds.get('hr') ?? ctx.employmentIds.get('owner') ?? null
  let added = 0

  for (const entry of plan) {
    const bytes = entry.text ? Buffer.from(entry.text, 'utf8') : simplePdf(entry.title, entry.lines)

    await db.insert(schema.documents).values({
      id: newId(),
      organizationId: ctx.organizationId,
      locationId: entry.location ? (ctx.locationIds.get(entry.location) ?? null) : null,
      title: entry.title,
      description: entry.description,
      category: entry.category,
      visibility: entry.visibility,
      fileName: entry.fileName,
      contentType: entry.text ? 'text/plain' : 'application/pdf',
      byteSize: bytes.byteLength,
      content: bytes,
      uploadedByEmploymentId: uploader,
    })
    added += 1
  }

  return { documents: added }
}
