/**
 * TENANT SCHEMA.
 *
 * The schema surface available to business modules. Every table here is
 * tenant-owned, carries an organization_id (or is the tenant root), and is
 * protected by a Row-Level Security policy.
 *
 * Global identity tables are deliberately NOT re-exported here. They live in
 * ./identity-schema, whose import is restricted to the authentication adapter.
 * See docs/architecture.md, "The global identity boundary".
 */
export * from '@/modules/org/schema'
export * from '@/modules/people/schema'
export * from '@/modules/structure/schema'
export * from '@/modules/access/schema'
export * from '@/modules/invitations/schema'
export * from '@/modules/onboarding/schema'
export * from '@/modules/events/schema'
export * from '@/modules/comms/schema'
export * from '@/modules/notifications/schema'
export * from '@/modules/audit/schema'
