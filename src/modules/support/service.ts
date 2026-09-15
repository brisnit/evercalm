import { and, asc, count, desc, eq, gt } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { Tx } from '@/server/db'
import { supportCaseMessages, supportCases } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { authorize } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_SEVERITIES,
  type SupportCategory,
  type SupportSeverity,
  type SupportStatus,
} from './schema'

/*
 * SUPPORT CASES, FROM THE CUSTOMER'S SIDE.
 *
 * Owners and HR administrators (support.manage) open cases for their
 * organization and follow EverCalm's replies. Everything here is tenant-scoped
 * under RLS, and reads only `support_cases` and `support_case_messages`.
 * EverCalm's internal notes live in a table this role cannot read at all, so
 * there is no query here that could return one by mistake.
 *
 * Attachments are out of scope until file storage is configured. Cases are
 * never deleted; messages are append-only.
 */

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  question: 'A question',
  problem: 'Something is not working',
  billing: 'Billing',
  account: 'Account and access',
  data_request: 'Data export or deletion',
  feedback: 'Feedback or a request',
}

export const SEVERITY_LABELS: Record<SupportSeverity, { label: string; hint: string }> = {
  low: { label: 'Low', hint: 'Whenever you get to it' },
  normal: { label: 'Normal', hint: 'Affects some work, there is a workaround' },
  high: { label: 'High', hint: 'Stops a team from working' },
  urgent: { label: 'Urgent', hint: 'Nobody can work, or data looks wrong' },
}

export const STATUS_LABELS: Record<
  SupportStatus,
  { label: string; tone: 'info' | 'violet' | 'warning' | 'success' }
> = {
  open: { label: 'Waiting for EverCalm', tone: 'info' },
  in_progress: { label: 'EverCalm is working on it', tone: 'violet' },
  waiting_on_customer: { label: 'Waiting for you', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
}

const MAX_NEW_CASES_PER_HOUR = 5

export interface CaseSummary {
  id: string
  reference: string
  category: SupportCategory
  severity: SupportSeverity
  status: SupportStatus
  subject: string
  createdByLabel: string
  createdAt: Date
  updatedAt: Date
}

export interface CaseDetail extends CaseSummary {
  description: string
  resolvedAt: Date | null
  messages: {
    id: string
    authorType: 'customer' | 'evercalm'
    authorLabel: string
    body: string
    statusFrom: SupportStatus | null
    statusTo: SupportStatus | null
    createdAt: Date
  }[]
}

const toSummary = (r: typeof supportCases.$inferSelect): CaseSummary => ({
  id: r.id,
  reference: r.reference,
  category: r.category as SupportCategory,
  severity: r.severity as SupportSeverity,
  status: r.status as SupportStatus,
  subject: r.subject,
  createdByLabel: r.createdByLabel,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

export async function listCases(tx: Tx, actor: Actor): Promise<CaseSummary[]> {
  authorize(actor, 'support.manage')
  const rows = await tx
    .select()
    .from(supportCases)
    .where(eq(supportCases.organizationId, actor.organizationId))
    .orderBy(asc(supportCases.status), desc(supportCases.updatedAt))
  const order: Record<string, number> = {
    waiting_on_customer: 0,
    open: 1,
    in_progress: 2,
    resolved: 3,
  }
  return rows
    .map(toSummary)
    .sort(
      (a, b) =>
        (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
}

async function requireCase(tx: Tx, actor: Actor, caseId: string, lock = false) {
  authorize(actor, 'support.manage')
  const query = tx
    .select()
    .from(supportCases)
    .where(and(eq(supportCases.organizationId, actor.organizationId), eq(supportCases.id, caseId)))
    .limit(1)
  const [row] = lock ? await query.for('update') : await query
  if (!row) throw new NotFoundError('Case not found')
  return row
}

export async function getCase(tx: Tx, actor: Actor, caseId: string): Promise<CaseDetail> {
  const row = await requireCase(tx, actor, caseId)
  const messages = await tx
    .select()
    .from(supportCaseMessages)
    .where(
      and(
        eq(supportCaseMessages.organizationId, actor.organizationId),
        eq(supportCaseMessages.caseId, caseId),
      ),
    )
    .orderBy(asc(supportCaseMessages.createdAt))
  return {
    ...toSummary(row),
    description: row.description,
    resolvedAt: row.resolvedAt,
    messages: messages.map((m) => ({
      id: m.id,
      authorType: m.authorType as 'customer' | 'evercalm',
      authorLabel: m.authorLabel,
      body: m.body,
      statusFrom: (m.statusFrom as SupportStatus | null) ?? null,
      statusTo: (m.statusTo as SupportStatus | null) ?? null,
      createdAt: m.createdAt,
    })),
  }
}

function reference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  return `EC-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`
}

export interface NewCaseInput {
  category: string
  severity: string
  subject: string
  description: string
}

export async function createCase(
  tx: Tx,
  actor: Actor,
  input: NewCaseInput,
  now = new Date(),
): Promise<string> {
  authorize(actor, 'support.manage')
  const errors: Record<string, string[]> = {}
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(input.category))
    errors.category = ['Choose what this is about.']
  if (!(SUPPORT_SEVERITIES as readonly string[]).includes(input.severity))
    errors.severity = ['Choose how much this is affecting you.']
  const subject = input.subject.replace(/\s+/g, ' ').trim().slice(0, 140)
  const description = input.description.replace(/\r\n/g, '\n').trim().slice(0, 5000)
  if (!subject) errors.subject = ['Say in a few words what is happening.']
  if (description.length < 10)
    errors.description = ['Tell us what happened, what you expected, and who it affects.']
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const [recent] = await tx
    .select({ n: count() })
    .from(supportCases)
    .where(
      and(
        eq(supportCases.organizationId, actor.organizationId),
        eq(supportCases.createdByEmploymentId, actor.employmentId),
        gt(supportCases.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    )
  if ((recent?.n ?? 0) >= MAX_NEW_CASES_PER_HOUR) {
    throw new ValidationError(
      {},
      'You have opened several cases in the last hour. Add to an existing case, or try again later.',
    )
  }

  const id = newId()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await tx
      .insert(supportCases)
      .values({
        id,
        organizationId: actor.organizationId,
        reference: reference(),
        category: input.category,
        severity: input.severity,
        subject,
        description,
        createdByEmploymentId: actor.employmentId,
        createdByLabel: actor.displayName,
        lastCustomerActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ reference: supportCases.reference })
    if (inserted[0]) {
      await recordAuditEvent(tx, actor, {
        action: AUDIT_ACTIONS.SUPPORT_CASE_CREATED,
        summary: `Opened support case ${inserted[0].reference}: ${subject}`,
        subjectType: 'support_case',
        subjectId: id,
        metadata: { category: input.category, severity: input.severity },
      })
      return id
    }
  }
  throw new Error('Could not allocate a case reference')
}

/**
 * Add to a case. Replying to a resolved case reopens it, and replying to a
 * case waiting on the customer hands it back to EverCalm.
 */
export async function replyToCase(
  tx: Tx,
  actor: Actor,
  caseId: string,
  rawBody: string,
  now = new Date(),
): Promise<SupportStatus> {
  const row = await requireCase(tx, actor, caseId, true)
  const body = rawBody.replace(/\r\n/g, '\n').trim().slice(0, 5000)
  if (!body) throw new ValidationError({ body: ['Write your update.'] })
  const next: SupportStatus =
    row.status === 'resolved' || row.status === 'waiting_on_customer'
      ? 'open'
      : (row.status as SupportStatus)
  const changed = next !== row.status
  await tx.insert(supportCaseMessages).values({
    id: newId(),
    organizationId: actor.organizationId,
    caseId,
    authorType: 'customer',
    authorEmploymentId: actor.employmentId,
    authorLabel: actor.displayName,
    body,
    statusFrom: changed ? row.status : null,
    statusTo: changed ? next : null,
    createdAt: now,
  })
  await tx
    .update(supportCases)
    .set({
      status: next,
      resolvedAt: next === 'resolved' ? row.resolvedAt : null,
      reopenedCount: row.status === 'resolved' ? row.reopenedCount + 1 : row.reopenedCount,
      lastCustomerActivityAt: now,
      updatedAt: now,
    })
    .where(and(eq(supportCases.organizationId, actor.organizationId), eq(supportCases.id, caseId)))
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SUPPORT_CASE_CUSTOMER_REPLIED,
    summary:
      row.status === 'resolved'
        ? `Reopened support case ${row.reference} with an update`
        : `Added an update to support case ${row.reference}`,
    subjectType: 'support_case',
    subjectId: caseId,
  })
  return next
}
