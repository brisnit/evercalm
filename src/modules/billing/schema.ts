import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organizations } from '@/modules/org/schema'

/*
 * BILLING.
 *
 * One subscription per organization, and an immutable history of everything
 * that happened to it. The runtime role cannot delete a subscription or
 * change a billing event. Mirrored by drizzle/0019_launch_readiness.sql.
 *
 * Provider references are opaque strings from the billing provider; no card
 * or bank detail is ever stored here.
 */

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull(),
    billingInterval: text('billing_interval').notNull().default('month'),
    status: text('status').notNull(),
    trialStartsAt: timestamp('trial_starts_at', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    quantityBasis: text('quantity_basis').notNull().default('active_employees'),
    quantity: integer('quantity').notNull().default(0),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    pastDueSince: timestamp('past_due_since', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    hasPaymentMethod: boolean('has_payment_method').notNull().default(false),
    billingContactName: text('billing_contact_name').notNull().default(''),
    billingContactEmail: text('billing_contact_email').notNull().default(''),
    provider: text('provider').notNull().default('mock'),
    providerCustomerRef: text('provider_customer_ref'),
    providerSubscriptionRef: text('provider_subscription_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('subscriptions_org_unique').on(t.organizationId),
    unique('subscriptions_org_id_unique').on(t.organizationId, t.id),
    check('subscriptions_plan_check', sql`${t.plan} in ('pilot','essentials','multi_location')`),
    check('subscriptions_interval_check', sql`${t.billingInterval} in ('month')`),
    check(
      'subscriptions_status_check',
      sql`${t.status} in ('trialing','active','past_due','canceled','suspended')`,
    ),
    check('subscriptions_basis_check', sql`${t.quantityBasis} in ('active_employees','locations')`),
    check('subscriptions_quantity_check', sql`${t.quantity} >= 0`),
    check(
      'subscriptions_trial_check',
      sql`${t.status} <> 'trialing' or ${t.trialEndsAt} is not null`,
    ),
    check(
      'subscriptions_past_due_check',
      sql`${t.status} <> 'past_due' or ${t.pastDueSince} is not null`,
    ),
    check('subscriptions_provider_check', sql`${t.provider} in ('mock')`),
    uniqueIndex('subscriptions_provider_ref_unique')
      .on(t.provider, t.providerSubscriptionRef)
      .where(sql`provider_subscription_ref is not null`),
  ],
)

export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').notNull(),
    type: text('type').notNull(),
    source: text('source').notNull(),
    /** Unique per organization: a replayed provider event is recorded once. */
    idempotencyKey: text('idempotency_key').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    summary: text('summary').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    actorLabel: text('actor_label').notNull().default(''),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('billing_events_idempotency_unique').on(t.organizationId, t.idempotencyKey),
    check(
      'billing_events_source_check',
      sql`${t.source} in ('owner','provider','system','evercalm')`,
    ),
    foreignKey({
      columns: [t.organizationId, t.subscriptionId],
      foreignColumns: [subscriptions.organizationId, subscriptions.id],
      name: 'billing_events_subscription_tenant_fk',
    }).onDelete('cascade'),
    index('billing_events_org_idx').on(t.organizationId, t.occurredAt),
  ],
)
