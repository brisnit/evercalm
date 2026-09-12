import { expect, type Locator, type Page } from '@playwright/test'

/** Matches src/server/db/seed/data.ts. */
export const SEED_PASSWORD = 'EverCalmDev!2026'

export const PEOPLE = {
  harborOwner: { email: 'dana@harborvine.test', name: 'Dana Okafor' },
  harborHr: { email: 'priya@harborvine.test', name: 'Priya Raman' },
  harborGmRiverside: { email: 'marcus@harborvine.test', name: 'Marcus Bell' },
  harborEmployee: { email: 'sam@harborvine.test', name: 'Sam Whitfield' },
  salonOwner: { email: 'ana@lumensalon.test', name: 'Ana Beltrán' },
} as const

/**
 * Fill a controlled React input and make sure the value survives.
 *
 * Playwright can type into the server-rendered markup before React has
 * hydrated, at which point hydration resets the controlled input to its
 * initial empty state and the typed value silently disappears. Asserting the
 * value and retrying is what makes sign-in reliable on slower engines.
 */
async function fillStable(locator: Locator, value: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await locator.fill(value)
    try {
      await expect(locator).toHaveValue(value, { timeout: 1_000 })
      return
    } catch {
      // Hydration replaced the value; type it again.
    }
  }
  throw new Error(`Could not get "${value}" to stick in the field after 5 attempts`)
}

/**
 * Block until React has actually hydrated the given element.
 *
 * React attaches internal `__reactFiber$…` / `__reactProps$…` properties to a
 * DOM node when it hydrates it, which is a genuine readiness signal rather
 * than a guess at a timing. Without this, Playwright can type into the
 * server-rendered markup and have hydration wipe the value a moment later -
 * producing a sign-in attempt with an empty email and a confusing
 * "credentials did not match" failure.
 */
async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const element = document.querySelector(sel)
      if (!element) return false
      return Object.keys(element).some(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$'),
      )
    },
    selector,
    { timeout: 20_000 },
  )
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin')
  await waitForHydration(page, '#email')
  await fillStable(page.getByLabel('Email'), email)
  await fillStable(page.getByLabel('Password'), SEED_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Surface a real sign-in failure as a clear message instead of a timeout.
  // Targets the form's own error element by test id: role="alert" alone also
  // matches the Next.js dev overlay's always-present empty alert region.
  const landed = page.waitForURL(/\/(app|my)/).then(() => 'ok' as const)
  const rejected = page
    .getByTestId('signin-error')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => 'error' as const)
    .catch(() => 'never' as const)

  const outcome = await Promise.race([landed, rejected])
  if (outcome === 'error') {
    const message = await page.getByTestId('signin-error').textContent()
    throw new Error(`Sign-in failed for ${email}: ${message?.trim() ?? 'unknown error'}`)
  }
  await landed
}

export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies()
}

/**
 * Fails the test on any console error or page exception.
 *
 * "The critical browser journey works without console errors" is part of the
 * definition of done, so it is asserted rather than eyeballed.
 */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

export function expectNoConsoleErrors(errors: string[]): void {
  // React dev-mode hydration noise from the Next overlay is not app code.
  const relevant = errors.filter((e) => !/Download the React DevTools/i.test(e))
  expect(relevant, `Console errors:\n${relevant.join('\n')}`).toEqual([])
}
