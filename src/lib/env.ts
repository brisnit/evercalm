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

/** A sender that is not the development placeholder and has a plausible address. */
function isRealSender(from: string): boolean {
  const address = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from.trim()
  return (
    /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(address) &&
    !/\.(invalid|example|test|localhost)$/i.test(address)
  )
}

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url().default('http://localhost:3000'),

    DATABASE_URL: postgresUrl,
    /**
     * Only on trusted machines and protected workflows that run migrations or
     * provisioning. Never set it on the web host.
     */
    MIGRATION_DATABASE_URL: postgresUrl.optional(),
    TEST_DATABASE_URL: postgresUrl.optional(),
    /**
     * Connections per server instance. Defaults to 3 on Vercel, where many
     * instances share one database, and 10 elsewhere.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).optional(),

    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

    /**
     * console   development only: logged, never sent. Refused in production.
     * resend    real delivery; needs RESEND_API_KEY and a verified EMAIL_FROM.
     * disabled  an explicit choice to send no email at all: email
     *           notifications are not created, invitations are handed over by
     *           an operator, and password-reset email is unavailable.
     */
    EMAIL_PROVIDER: z.enum(['console', 'resend', 'disabled']).default('console'),
    EMAIL_FROM: z.string().min(1).default('EverCalm <no-reply@example.invalid>'),
    RESEND_API_KEY: z.string().optional(),

    /**
     * mock    development only: simulated provider events, refused in production
     * manual  a pilot with no payment provider: billing is arranged directly
     *         with EverCalm, nothing is charged, and only EverCalm support
     *         changes a subscription's status. See docs/runbooks/billing-provider.md.
     */
    BILLING_PROVIDER: z.enum(['mock', 'manual']).default('mock'),
    /** Enables the mock provider's signed webhook outside production. */
    MOCK_BILLING_WEBHOOK_SECRET: z
      .string()
      .min(32, 'MOCK_BILLING_WEBHOOK_SECRET must be at least 32 characters')
      .optional(),

    /**
     * Vercel Cron sends it as "Authorization: Bearer <CRON_SECRET>". Without it
     * the scheduled worker endpoint answers 404 to everyone.
     */
    CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters').optional(),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    /**
     * Set only on the stakeholder-demo deployment. Labels every page
     * "Stakeholder Demo" and switches off destructive and externally
     * consequential actions. Unset everywhere else, including customer
     * production.
     */
    EVERCALM_ENVIRONMENT: z.enum(['stakeholder-demo']).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_PROVIDER === 'resend' && !isRealSender(v.EMAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message:
          'EMAIL_FROM must be a verified sender such as "EverCalm <notifications@your-domain>", not the placeholder',
      })
    }
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
          'BILLING_PROVIDER "mock" simulates a payment provider and cannot serve production traffic. Use "manual" for a pilot billed directly by EverCalm.',
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
