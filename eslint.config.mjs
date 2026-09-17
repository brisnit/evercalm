import tseslint from 'typescript-eslint'
import nextPlugin from '@next/eslint-plugin-next'

/**
 * ARCHITECTURAL BOUNDARIES.
 *
 * `no-restricted-imports` is REPLACED, not merged, by a later matching config
 * block. Each scope below therefore declares the COMPLETE set of restrictions
 * that apply to it, and the scopes are mutually exclusive via files/ignores.
 * Composing them from shared constants is what keeps that honest - an earlier
 * version silently lost the identity rules to a later block.
 */

/** The raw pool and driver: only the database layer may touch them. */
const RAW_DATABASE = {
  patterns: [
    {
      group: ['**/server/db/client', '@/server/db/client', '**/server/db/pool'],
      message:
        'Do not import the raw database client. Use withTenant() from @/server/db so RLS is always applied.',
    },
  ],
  paths: [
    {
      name: 'pg',
      message:
        'Do not use the pg driver directly outside src/server/db. Use the tenant-scoped handle from @/server/db.',
    },
  ],
}

/**
 * Global identity tables (`user`, `session`, `account`, `verification`).
 *
 * They carry no organization_id and no tenant RLS policy, because
 * authentication must resolve before an organization context exists - adding
 * RLS there would break the sign-in, verification and password-reset
 * lifecycle. Since the database cannot isolate them, the architecture does.
 *
 * Business code resolves people through `employments`, which IS tenant-owned
 * and RLS-protected. This is what stops one organization enumerating global
 * users, and stops a directory feature revealing that somebody also works for
 * another company.
 */
const GLOBAL_IDENTITY = {
  patterns: [
    {
      group: [
        '@/server/db/identity-schema',
        '**/server/db/identity-schema',
        '@/server/db/full-schema',
        '**/server/db/full-schema',
        '@/modules/identity/schema',
        '**/modules/identity/schema',
        '@/server/db/platform-schema',
        '**/server/db/platform-schema',
      ],
      message:
        'Global identity tables are off-limits to business code. Resolve people through `employments` (tenant-owned, RLS-protected) via @/server/db/schema. See docs/architecture.md.',
    },
    {
      group: ['@/server/db/global', '**/server/db/global'],
      message:
        'withGlobal()/globalDb() bypass tenant scoping and are reserved for the authentication adapter. Use withTenant() from @/server/db.',
    },
  ],
}

/** Modules talk through services, not by reaching into each other's tables. */
const MODULE_SCHEMA = {
  patterns: [
    {
      group: ['@/modules/*/schema', '../*/schema', '../../*/schema'],
      message:
        "Import another module's schema only via src/server/db/schema.ts. Modules talk through services.",
    },
  ],
}

function restrict(...groups) {
  return [
    'error',
    {
      patterns: groups.flatMap((g) => g.patterns ?? []),
      paths: groups.flatMap((g) => g.paths ?? []),
    },
  ]
}

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-e2e/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'drizzle/**',
      '.pgdata/**',
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // --- Scope 1: the database layer itself. No import restrictions. ---------
  // src/server/db/** is intentionally absent from every block below.

  // --- Scope 2: the sanctioned authentication adapter ----------------------
  // May reach global identity; may not reach the raw driver.
  {
    files: ['src/server/auth/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(RAW_DATABASE) },
  },

  // --- Scope 3: module schema files ----------------------------------------
  // May reference identity and sibling tables STRUCTURALLY, to declare the
  // employments.user_id foreign key and the composite (organization_id, id)
  // tenant keys. Those are table definitions, not queries.
  {
    files: ['src/modules/*/schema.ts'],
    rules: { 'no-restricted-imports': restrict(RAW_DATABASE) },
  },

  // --- Scope 4: all other application code ---------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/db/**', 'src/server/auth/**', 'src/modules/*/schema.ts'],
    rules: {
      'no-restricted-imports': restrict(RAW_DATABASE, GLOBAL_IDENTITY, MODULE_SCHEMA),
    },
  },

  // Config files and scripts run outside the app runtime.
  {
    files: ['*.config.{ts,mts,mjs}', 'scripts/**/*.ts', 'src/server/db/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Config files sit outside the TypeScript project, so type-aware rules
  // cannot run against them. Must come AFTER the blocks that enable those
  // rules: in flat config, later entries win.
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Tests assert on raw SQL behaviour on purpose.
  {
    files: ['tests/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
)
