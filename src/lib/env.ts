import { z } from 'zod'

/**
 * Environment validation.
 *
 * This module throws at import time when configuration is missing or
 * malformed, so a misconfigured deployment fails to boot rather than
 * failing later in front of a user.
 */

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
    message: 'must be a postgres:// connection string',
  })

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url().default('http://localhost:3000'),

    DATABASE_URL: postgresUrl,
    MIGRATION_DATABASE_URL: postgresUrl.optional(),
    TEST_DATABASE_URL: postgresUrl.optional(),

    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    EMAIL_FROM: z.string().min(1).default('EverCalm <no-reply@example.invalid>'),
    RESEND_API_KEY: z.string().optional(),

    /** Only the development-safe mock exists. See docs/runbooks/billing-provider.md. */
    BILLING_PROVIDER: z.enum(['mock']).default('mock'),
    /** Enables the mock provider's signed webhook outside production. */
    MOCK_BILLING_WEBHOOK_SECRET: z
      .string()
      .min(32, 'MOCK_BILLING_WEBHOOK_SECRET must be at least 32 characters')
      .optional(),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_PROVIDER === 'resend' && !v.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER is "resend"',
      })
    }
    // A placeholder sender must never SERVE production traffic.
    //
    // Scoped to running servers, not builds: `next build` sets NODE_ENV to
    // production while collecting page data, and a build machine has no
    // business holding production email credentials. The guard still fires
    // the moment a production server boots.
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
    if (v.NODE_ENV === 'production' && v.BILLING_PROVIDER === 'mock' && !isBuildPhase) {
      ctx.addIssue({
        code: 'custom',
        path: ['BILLING_PROVIDER'],
        message:
          'BILLING_PROVIDER "mock" charges nothing and cannot serve production traffic. Configure a real provider first.',
      })
    }
    if (v.NODE_ENV === 'production' && v.EMAIL_PROVIDER === 'console' && !isBuildPhase) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message:
          'EMAIL_PROVIDER "console" is a development-only mode and cannot serve production traffic',
      })
    }
  })

export type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | undefined

export function getEnv(): ServerEnv {
  if (cached) return cached

  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment configuration.\n${detail}\n\nSee .env.example for the expected values.`,
    )
  }
  cached = parsed.data
  return cached
}

/** Test-only: clear the memoised environment. */
export function resetEnvCache(): void {
  cached = undefined
}
