import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import { getEnv } from '@/lib/env'
import { globalDb } from '@/server/db/global'
import { authRateLimitRules, shouldRelaxRateLimits } from './rate-limits'
import { accounts, sessions, users, verifications } from '@/server/db/identity-schema'

/**
 * IDENTITY AND SESSIONS.
 *
 * Better Auth owns identity only: users, sessions, credentials, verification.
 * Organizations, employments, roles, and permissions are EverCalm's own domain
 * model - its organization plugin is deliberately unused, because a person
 * holding different roles at different locations is richer than its member
 * model, and because this keeps the provider swappable.
 *
 * Password hashing is argon2id (OWASP's current recommendation), replacing the
 * library default.
 */

// OWASP Password Storage Cheat Sheet, argon2id: >=19 MiB, >=2 iterations,
// parallelism 1.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

function buildAuth() {
  const env = getEnv()

  return betterAuth({
    appName: 'EverCalm',
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,

    database: drizzleAdapter(globalDb(), {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      autoSignIn: false,
      password: {
        hash: (password: string) => argon2Hash(password, ARGON2_OPTIONS),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          argon2Verify(hash, password),
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 14, // 14 day absolute lifetime
      updateAge: 60 * 60 * 24, // slide at most once a day
      freshAge: 60 * 15, // re-auth window for sensitive actions
    },

    advanced: {
      cookiePrefix: 'evercalm',
      useSecureCookies: env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      customRules: authRateLimitRules(
        shouldRelaxRateLimits(env.NODE_ENV, process.env.E2E_RELAX_RATE_LIMIT),
      ),
    },

    telemetry: { enabled: false },
  })
}

let cached: ReturnType<typeof buildAuth> | undefined

export function auth(): ReturnType<typeof buildAuth> {
  cached ??= buildAuth()
  return cached
}

export function resetAuth(): void {
  cached = undefined
}
