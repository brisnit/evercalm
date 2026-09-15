/**
 * GLOBAL IDENTITY TABLES - RESTRICTED.
 *
 * These four tables are NOT tenant-owned. They have no organization_id and no
 * tenant RLS policy, because authentication has to resolve before any
 * organization context exists - putting RLS here would break the sign-in,
 * verification, and password-reset lifecycle.
 *
 * Because the database cannot isolate them, the ARCHITECTURE must. Importing
 * this module is restricted by eslint to:
 *
 *   src/server/auth/**   the sanctioned authentication adapter
 *   src/server/db/**     schema aggregation, migrations, and seeding
 *
 * A tenant business module that needs people must go through `employments`,
 * which IS tenant-owned and RLS-protected. The global `user` table is an
 * identity record, never an employee directory: one row can belong to several
 * customers at once, so treating it as a directory would leak the fact that a
 * person also works for another organization.
 *
 * Enforced by:
 *   - eslint `no-restricted-imports` (fails CI)
 *   - tests/unit/architecture.test.ts (fails CI independently of lint config)
 */
export { users, sessions, accounts, verifications, rateLimits } from '@/modules/identity/schema'
