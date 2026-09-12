import { execFileSync } from 'node:child_process'

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
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_REFRESH === 'true') {
    console.log('[e2e] E2E_SKIP_REFRESH=true - leaving the database as it is.')
    return
  }

  // Inherited stdio so a seeding failure is visible rather than swallowed into
  // a wall of confusing assertion errors.
  execFileSync('npm', ['run', '--silent', 'db:refresh'], { stdio: 'inherit' })
}
