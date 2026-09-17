import { execFileSync } from 'node:child_process'
import { assertE2eDatabase, E2E_DATABASE_NAME } from '@/server/db/e2e-guard'

/**
 * Reset the database before every browser run.
 *
 * Browser tests mutate real state - they mark onboarding steps done, publish
 * template versions, accept invitations - so a suite run against an
 * accumulating database drifts: assertions that passed yesterday fail today
 * because the rows they depended on were consumed by the previous run.
 *
 * This lived in the `test:e2e` npm script, which meant the guarantee was lost
 * the moment anyone ran `playwright test` directly, or ran a single spec from
 * an editor. Doing it in globalSetup makes determinism a property of the suite
 * rather than of the command someone happened to type.
 *
 * Set E2E_SKIP_REFRESH=true to iterate on a spec against state you have set up
 * by hand.
 *
 * Nothing runs until the guard has confirmed the database is the browser
 * suite's own: this suite once reseeded a developer's database because the
 * connection string came from the shell and nothing checked it.
 */
export default async function globalSetup(): Promise<void> {
  await assertBrowserTestDatabase()
  await assertServerWillNotThrottle()

  if (process.env.E2E_SKIP_REFRESH === 'true') {
    console.log('[e2e] E2E_SKIP_REFRESH=true - leaving the database as it is.')
    return
  }

  // Inherited stdio so a seeding failure is visible rather than swallowed into
  // a wall of confusing assertion errors.
  execFileSync('npm', ['run', '--silent', 'db:refresh'], { stdio: 'inherit' })
}

/**
 * Refuse any database but the browser suite's own, by name and by marker,
 * whether or not this run intends to reseed: the suite mutates state on every
 * test, not only in its setup.
 */
async function assertBrowserTestDatabase(): Promise<void> {
  for (const [variable, url] of [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['MIGRATION_DATABASE_URL', process.env.MIGRATION_DATABASE_URL],
  ] as const) {
    try {
      await assertE2eDatabase(`run the browser suite with ${variable}`, url)
    } catch (error) {
      console.error(`\n[e2e] ${(error as Error).message}\n`)
      throw error
    }
  }
  console.log(`[e2e] Database checked: ${E2E_DATABASE_NAME}, marked for browser tests.`)
}

/**
 * Refuse a server that will rate-limit our sign-ins.
 *
 * `reuseExistingServer` means a dev server somebody already had running gets
 * used, and that one was almost certainly started WITHOUT
 * E2E_RELAX_RATE_LIMIT. Sign-in is limited to five attempts a minute, which is
 * correct for real people and far below what this suite does - so the run
 * fails as a dozen unrelated assertion errors with "that email and password
 * did not match" buried inside. Failing here, with the reason, costs one
 * request and saves the hunt.
 */
async function assertServerWillNotThrottle(): Promise<void> {
  const url = `http://localhost:${process.env.E2E_PORT ?? 3000}/api/health`
  let body: { auth?: { rateLimitsRelaxed?: boolean } }
  try {
    const response = await fetch(url)
    body = (await response.json()) as typeof body
  } catch {
    // No server yet: Playwright is about to start its own, correctly.
    return
  }

  if (body.auth?.rateLimitsRelaxed !== true) {
    throw new Error(
      [
        'A dev server is already running on port 3000 WITHOUT relaxed sign-in rate limits,',
        'and Playwright reuses it. The suite signs in far more often than a person does, so',
        'sign-ins would start failing part-way through the run.',
        '',
        'Stop it and let Playwright start its own (npm run test:e2e), or restart it with:',
        '  E2E_RELAX_RATE_LIMIT=true npm run dev',
      ].join('\n'),
    )
  }
}
