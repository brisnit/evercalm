/**
 * Environment for the integration worker.
 *
 * Runs inside the test process before any test file, so code that reads the
 * environment at call time (the email provider, the auth configuration) has
 * something valid to read. These are deliberately obvious throwaway values.
 *
 * The DATABASE_URL values here are NOT what the tests connect with - the
 * harness creates its own pools against the ephemeral cluster. They exist so
 * that importing a module which validates the environment does not explode.
 */
// NODE_ENV is typed read-only, so assign through the record.
const env = process.env as Record<string, string | undefined>

env.NODE_ENV ??= 'test'
env.APP_URL ??= 'http://localhost:3000'
// secret-scan-allow: throwaway values for an ephemeral test process
env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/test'
// secret-scan-allow: throwaway values for an ephemeral test process
env.MIGRATION_DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/test'
env.BETTER_AUTH_SECRET ??= 'test_only_secret_not_used_outside_the_test_process'
env.EMAIL_PROVIDER ??= 'console'
env.EMAIL_FROM ??= 'EverCalm Test <no-reply@example.invalid>'
env.LOG_LEVEL ??= 'error'
