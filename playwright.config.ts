import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests.
 *
 * Runs against `next dev`. The production server deliberately refuses to boot
 * with EMAIL_PROVIDER=console (see src/lib/env.ts), which is the guard working
 * as intended - the production BUILD is verified separately by `npm run build`.
 *
 * Employee-facing journeys also run at phone width, because /my is a
 * mobile-first surface and desktop-only coverage would miss its real use.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Reseeds the database, so a run is deterministic however it was started -
  // `npm run test:e2e`, a bare `playwright test`, or a single spec from an editor.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Screenshot capture is opt-in via CAPTURE_SCREENSHOTS and excluded here so
  // the normal suite stays assertion-only.
  testIgnore: process.env.CAPTURE_SCREENSHOTS ? [] : [/screenshots.*\.spec\.ts/],

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 14'] },
      testMatch:
        /.*(employee|employee-onboarding|employee-inbox|employee-schedule|employee-training|employee-onboarding-training|employee-operations|employee-account|owner-launch|platform|marketing|accessibility|screenshots-mobile)\.spec\.ts/,
    },
  ],

  webServer: {
    // Sign-in is rate limited to 5 attempts per minute, which is correct for
    // real users and far below what a browser suite does. Relaxing is only
    // possible outside production (see src/server/auth/rate-limits.ts) and
    // the strict production values are asserted by a unit test.
    // `npm run dev` starts the background worker too; a one-second tick keeps
    // the scheduled-publishing journey fast without changing what it proves.
    command: 'E2E_RELAX_RATE_LIMIT=true WORKER_INTERVAL_MS=1000 npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
