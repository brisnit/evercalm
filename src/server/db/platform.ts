import { desc, sql, type SQL } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { appDb } from './client'
import type { Db } from './types'
import { platformStaff, workerRuns } from './platform-schema'

/*
 * THE EVERCALM TEAM'S DATABASE ACCESS - NARROW BY CONSTRUCTION.
 *
 * Every function here calls one SECURITY DEFINER function from migration 0019
 * and passes the signed-in staff member's user id. The database checks that id
 * is active staff before returning anything, so these wrappers are not the
 * gate - they are the only door. None of them set a tenant context, read an
 * employee, an inbox or an HR field, or can be pointed at arbitrary SQL.
 *
 * "Not staff" and "no such case" both surface as NotFoundError.
 */

function mapError(error: unknown): never {
  const code =
    (error as { code?: string; cause?: { code?: string } }).code ??
    (error as { cause?: { code?: string } }).cause?.code
  if (code === '42501' || code === 'P0002') throw new NotFoundError('Not found')
  if (code === '22023')
    throw new ValidationError({}, 'That could not be saved. Check what you entered.')
  throw error
}

/** Tests pass their own handle; the application always uses the runtime pool. */
async function rows<T extends Record<string, unknown>>(query: SQL, db?: Db): Promise<T[]> {
  try {
    const result = await (db ?? appDb()).execute<T>(query)
    return result.rows as T[]
  } catch (error) {
    mapError(error)
  }
}

const date = (v: unknown) => (v ? new Date(v as string) : null)

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export interface StaffOrganization {
  organizationId: string
  name: string
  slug: string
  industry: string
  orgStatus: string
  createdAt: Date
  locations: number
  activeEmployees: number
  plan: string | null
  subscriptionStatus: string | null
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  pastDueSince: Date | null
  hasPaymentMethod: boolean
  billingContactName: string
  billingContactEmail: string
  openCases: number
  failedNotifications7d: number
  publishFailures30d: number
  lastActivityAt: Date | null
  /** 'mock' | 'manual', or null without a subscription. */
  billingProvider: string | null
}

export async function staffOrganizations(
  staffUserId: string,
  organizationId: string | null = null,
  db?: Db,
): Promise<StaffOrganization[]> {
  const result = await rows<Record<string, unknown>>(
    sql`select * from evercalm_staff_organizations(${staffUserId}, ${organizationId}::uuid)`,
    db,
  )
  return result.map((r) => ({
    organizationId: r.organization_id as string,
    name: r.name as string,
    slug: r.slug as string,
    industry: r.industry as string,
    orgStatus: r.org_status as string,
    createdAt: new Date(r.created_at as string),
    locations: r.locations as number,
    activeEmployees: r.active_employees as number,
    plan: (r.plan as string | null) ?? null,
    subscriptionStatus: (r.subscription_status as string | null) ?? null,
    trialEndsAt: date(r.trial_ends_at),
    currentPeriodEnd: date(r.current_period_end),
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
    pastDueSince: date(r.past_due_since),
    hasPaymentMethod: Boolean(r.has_payment_method),
    billingContactName: (r.billing_contact_name as string | null) ?? '',
    billingContactEmail: (r.billing_contact_email as string | null) ?? '',
    openCases: r.open_cases as number,
    failedNotifications7d: r.failed_notifications_7d as number,
    publishFailures30d: r.publish_failures_30d as number,
    lastActivityAt: date(r.last_activity_at),
    billingProvider: (r.billing_provider as string | null) ?? null,
  }))
}

export interface DeliveryFailureGroup {
  channel: string
  category: string
  failureReason: string
  failures: number
  lastFailedAt: Date | null
}

export async function staffDeliveryFailures(
  staffUserId: string,
  organizationId: string,
  db?: Db,
): Promise<DeliveryFailureGroup[]> {
  const result = await rows<Record<string, unknown>>(
    sql`select * from evercalm_staff_delivery_failures(${staffUserId}, ${organizationId}::uuid)`,
    db,
  )
  return result.map((r) => ({
    channel: r.channel as string,
    category: r.category as string,
    failureReason: r.failure_reason as string,
    failures: r.failures as number,
    lastFailedAt: date(r.last_failed_at),
  }))
}

export interface WorkerError {
  finishedAt: Date
  organizationId: string | null
  step: string
  message: string
}

export async function staffWorkerErrors(
  staffUserId: string,
  organizationId: string | null,
  db?: Db,
): Promise<WorkerError[]> {
  const result = await rows<Record<string, unknown>>(
    sql`select * from evercalm_staff_worker_errors(${staffUserId}, ${organizationId}::uuid)`,
    db,
  )
  return result.map((r) => ({
    finishedAt: new Date(r.finished_at as string),
    organizationId: (r.organization_id as string | null) ?? null,
    step: r.step as string,
    message: r.message as string,
  }))
}

export async function staffAuditSummary(
  staffUserId: string,
  organizationId: string,
  days = 30,
  db?: Db,
) {
  const result = await rows<Record<string, unknown>>(
    sql`select * from evercalm_staff_audit_summary(${staffUserId}, ${organizationId}::uuid, ${days}::integer)`,
    db,
  )
  return result.map((r) => ({
    action: r.action as string,
    actorType: r.actor_type as string,
    events: r.events as number,
    lastAt: date(r.last_at),
  }))
}

export async function staffBillingEvents(staffUserId: string, organizationId: string, db?: Db) {
  const result = await rows<Record<string, unknown>>(
    sql`select * from evercalm_staff_billing_events(${staffUserId}, ${organizationId}::uuid)`,
    db,
  )
  return result.map((r) => ({
    type: r.type as string,
    source: r.source as string,
    fromStatus: (r.from_status as string | null) ?? null,
    toStatus: (r.to_status as string | null) ?? null,
    summary: r.summary as string,
    occurredAt: new Date(r.occurred_at as string),
  }))
}

/** Records in the organization's audit log that EverCalm looked. */
export async function staffRecordAccess(
  staffUserId: string,
  organizationId: string,
  what: string,
  db?: Db,
): Promise<void> {
  await rows(
    sql`select evercalm_staff_record_access(${staffUserId}, ${organizationId}::uuid, ${what})`,
    db,
  )
}

export async function staffRetryDeliveries(
  staffUserId: string,
  organizationId: string,
  reason: string,
  db?: Db,
): Promise<number> {
  const [row] = await rows<{ count: number }>(
    sql`select evercalm_staff_retry_deliveries(${staffUserId}, ${organizationId}::uuid, ${reason}) as count`,
    db,
  )
  return row?.count ?? 0
}

// ---------------------------------------------------------------------------
// Support cases
// ---------------------------------------------------------------------------

export interface StaffCase {
  id: string
  organizationId: string
  organizationName: string
  reference: string
  category: string
  severity: string
  status: string
  subject: string
  description: string
  createdByLabel: string
  assignedStaffUserId: string | null
  assignedStaffLabel: string
  resolvedAt: Date | null
  reopenedCount: number
  createdAt: Date
  updatedAt: Date
  lastCustomerActivityAt: Date
  lastEvercalmActivityAt: Date | null
}

export async function staffCases(
  staffUserId: string,
  filter: { organizationId?: string | null; caseId?: string | null; openOnly?: boolean },
  db?: Db,
): Promise<StaffCase[]> {
  const result = await rows<Record<string, unknown>>(
    sql`select * from evercalm_staff_cases(${staffUserId}, ${filter.organizationId ?? null}::uuid, ${filter.caseId ?? null}::uuid, ${filter.openOnly ?? false})`,
    db,
  )
  return result.map((r) => ({
    id: r.id as string,
    organizationId: r.organization_id as string,
    organizationName: r.organization_name as string,
    reference: r.reference as string,
    category: r.category as string,
    severity: r.severity as string,
    status: r.status as string,
    subject: r.subject as string,
    description: r.description as string,
    createdByLabel: r.created_by_label as string,
    assignedStaffUserId: (r.assigned_staff_user_id as string | null) ?? null,
    assignedStaffLabel: r.assigned_staff_label as string,
    resolvedAt: date(r.resolved_at),
    reopenedCount: r.reopened_count as number,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    lastCustomerActivityAt: new Date(r.last_customer_activity_at as string),
    lastEvercalmActivityAt: date(r.last_evercalm_activity_at),
  }))
}

export interface StaffThreadEntry {
  id: string
  kind: 'customer' | 'evercalm' | 'internal'
  authorLabel: string
  body: string
  statusFrom: string | null
  statusTo: string | null
  createdAt: Date
}

export async function staffCaseThread(
  staffUserId: string,
  caseId: string,
  db?: Db,
): Promise<StaffThreadEntry[]> {
  const result = await rows<Record<string, unknown>>(
    sql`select * from evercalm_staff_case_thread(${staffUserId}, ${caseId}::uuid)`,
    db,
  )
  return result.map((r) => ({
    id: r.id as string,
    kind: r.kind as StaffThreadEntry['kind'],
    authorLabel: r.author_label as string,
    body: r.body as string,
    statusFrom: (r.status_from as string | null) ?? null,
    statusTo: (r.status_to as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
  }))
}

export async function staffCaseUpdate(
  staffUserId: string,
  caseId: string,
  input: { body: string; status: string | null },
  db?: Db,
): Promise<string> {
  const [row] = await rows<{ status: string }>(
    sql`select evercalm_staff_case_update(${staffUserId}, ${caseId}::uuid, ${input.body}, ${input.status ?? ''}, ${newId()}::uuid) as status`,
    db,
  )
  return row!.status
}

export async function staffCaseNote(
  staffUserId: string,
  caseId: string,
  body: string,
  db?: Db,
): Promise<void> {
  await rows(
    sql`select evercalm_staff_case_note(${staffUserId}, ${caseId}::uuid, ${body}, ${newId()}::uuid)`,
    db,
  )
}

export async function staffCaseAssign(
  staffUserId: string,
  caseId: string,
  assigneeUserId: string | null,
  db?: Db,
): Promise<void> {
  await rows(
    sql`select evercalm_staff_case_assign(${staffUserId}, ${caseId}::uuid, ${assigneeUserId})`,
    db,
  )
}

/** Colleagues a case can be assigned to. Names and roles only. */
export async function staffColleagues(
  db?: Db,
): Promise<{ userId: string; displayName: string; role: string }[]> {
  return (db ?? appDb())
    .select({
      userId: platformStaff.userId,
      displayName: platformStaff.displayName,
      role: platformStaff.role,
    })
    .from(platformStaff)
    .where(sql`${platformStaff.active}`)
    .orderBy(platformStaff.displayName)
}

// ---------------------------------------------------------------------------
// Worker runs and readiness
// ---------------------------------------------------------------------------

export interface WorkerRunRecord {
  startedAt: Date
  finishedAt: Date
  organizations: number
  counters: Record<string, number>
  errors: { organizationId: string | null; step: string; message: string }[]
}

export async function recordWorkerRun(run: WorkerRunRecord, db?: Db): Promise<void> {
  await (db ?? appDb()).insert(workerRuns).values({
    id: newId(),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    organizations: run.organizations,
    counters: run.counters,
    errorCount: run.errors.length,
    errors: run.errors.slice(0, 100),
  })
}

export async function latestWorkerRun(
  db?: Db,
): Promise<{ finishedAt: Date; errorCount: number } | null> {
  const [row] = await (db ?? appDb())
    .select({ finishedAt: workerRuns.finishedAt, errorCount: workerRuns.errorCount })
    .from(workerRuns)
    .orderBy(desc(workerRuns.finishedAt))
    .limit(1)
  return row ?? null
}

export async function latestMigration(db?: Db): Promise<string | null> {
  const [row] = await rows<{ filename: string | null }>(
    sql`select evercalm_latest_migration() as filename`,
    db,
  )
  return row?.filename ?? null
}

/** Which organization a provider subscription belongs to, for webhooks. */
export async function organizationForProviderSubscription(
  provider: string,
  reference: string,
  db?: Db,
): Promise<string | null> {
  const [row] = await rows<{ organization_id: string | null }>(
    sql`select evercalm_org_for_provider_subscription(${provider}, ${reference}) as organization_id`,
    db,
  )
  return row?.organization_id ?? null
}

/**
 * Set a MANUAL pilot subscription's status. Support administrators only, with
 * a reason the customer sees in their billing history. Provider-managed
 * subscriptions are refused.
 */
export async function staffSetSubscriptionStatus(
  staffUserId: string,
  organizationId: string,
  status: string,
  reason: string,
  db?: Db,
): Promise<string> {
  const [row] = await rows<{ status: string }>(
    sql`select evercalm_staff_set_subscription_status(${staffUserId}, ${organizationId}::uuid, ${status}, ${reason}, ${newId()}::uuid) as status`,
    db,
  )
  return row!.status
}
