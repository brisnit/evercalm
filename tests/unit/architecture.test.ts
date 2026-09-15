import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as tenantSchema from '@/server/db/schema'
import * as fullSchema from '@/server/db/full-schema'

/**
 * ARCHITECTURAL BOUNDARY TESTS.
 *
 * These duplicate what eslint enforces, on purpose. The lint rule can be
 * loosened, disabled inline, or lost to a config refactor - that has already
 * happened once in this codebase, when a later flat-config block silently
 * replaced the identity restrictions. These tests fail CI independently of
 * any lint configuration.
 */

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(ROOT, 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Directories permitted to reach global identity. */
const IDENTITY_ALLOWED = [path.join(SRC, 'server', 'auth'), path.join(SRC, 'server', 'db')]

/** Schema files may reference identity STRUCTURALLY, to declare the FK. */
function isModuleSchemaFile(file: string): boolean {
  return /src\/modules\/[^/]+\/schema\.ts$/.test(file)
}

function isIdentityAllowed(file: string): boolean {
  return IDENTITY_ALLOWED.some((dir) => file.startsWith(dir + path.sep))
}

const IDENTITY_IMPORT =
  /from\s+['"](?:@\/server\/db\/(?:identity-schema|full-schema|global)|@\/modules\/identity\/schema)['"]/
const RAW_DB_IMPORT = /from\s+['"](?:@\/server\/db\/client|pg)['"]/

describe('global identity boundary', () => {
  const files = sourceFiles(SRC)

  it('finds a meaningful number of source files to check', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('lets no business code import global identity tables or the unscoped handle', () => {
    const violations = files
      .filter((file) => !isIdentityAllowed(file))
      .filter((file) => !isModuleSchemaFile(file))
      .filter((file) => IDENTITY_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file))

    expect(
      violations,
      `These files reach global identity directly. Resolve people through employments instead:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  it('lets only module schema files reference identity, and only for the foreign key', () => {
    const schemaFiles = files.filter(isModuleSchemaFile)
    for (const file of schemaFiles) {
      const source = readFileSync(file, 'utf8')
      if (!IDENTITY_IMPORT.test(source)) continue
      // The only sanctioned structural use is employments.user_id.
      expect(
        path.basename(path.dirname(file)),
        `${path.relative(ROOT, file)} references identity but is not the people module`,
      ).toBe('people')
      expect(source).toContain('user_id')
    }
  })

  it('keeps the raw driver inside the database layer', () => {
    const violations = files
      .filter((file) => !file.startsWith(path.join(SRC, 'server', 'db') + path.sep))
      .filter((file) => RAW_DB_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file))

    expect(violations).toEqual([])
  })
})

describe('the tenant schema barrel', () => {
  it('does NOT re-export global identity tables', () => {
    // The barrel business modules import must not make `users` reachable at
    // all - otherwise the import boundary is decorative.
    const exported = Object.keys(tenantSchema)
    for (const identityTable of ['users', 'sessions', 'accounts', 'verifications']) {
      expect(
        exported,
        `@/server/db/schema must not expose "${identityTable}" to business modules`,
      ).not.toContain(identityTable)
    }
  })

  it('does export the tenant tables business modules need', () => {
    const exported = Object.keys(tenantSchema)
    for (const table of [
      'organizations',
      'locations',
      'employments',
      'roleGrants',
      'auditEvents',
    ]) {
      expect(exported).toContain(table)
    }
  })

  it('keeps identity tables available to the database layer through the full schema', () => {
    // Migrations, seeding and the RLS coverage test still need every table.
    const exported = Object.keys(fullSchema)
    for (const identityTable of ['users', 'sessions', 'accounts', 'verifications']) {
      expect(exported).toContain(identityTable)
    }
  })
})

describe('the HTTP surface', () => {
  it('exposes only the route handlers we intend', () => {
    const apiDir = path.join(SRC, 'app', 'api')
    const routes = sourceFiles(apiDir)
      .filter((f) => path.basename(f) === 'route.ts')
      .map((f) => path.relative(apiDir, path.dirname(f)))
      .sort()

    // Any new endpoint is a deliberate decision that updates this list, so a
    // people- or user-listing API cannot appear unnoticed.
    expect(routes).toEqual(['auth/[...all]', 'billing/webhook', 'health', 'ready'])
  })

  it('has no route handler that selects from the global user table', () => {
    const handlers = sourceFiles(path.join(SRC, 'app')).filter(
      (f) => path.basename(f) === 'route.ts',
    )
    for (const handler of handlers) {
      const source = readFileSync(handler, 'utf8')
      expect(source, `${path.relative(ROOT, handler)} reaches global identity`).not.toMatch(
        IDENTITY_IMPORT,
      )
    }
  })
})
