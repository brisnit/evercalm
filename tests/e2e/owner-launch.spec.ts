import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The customer owner's side of Slice 7: reports and exports, billing, system
 * status and support - and the boundaries around each. Runs on desktop and
 * phone; every test leaves things as it found them or creates its own rows.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

async function expectFitsAndAccessible(page: Page, path: string) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${path} scrolls sideways`).toBeLessThanOrEqual(viewport + 1)
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  expect(results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`)).toEqual([])
}

test('an owner lands on their tools, with what needs attention one click away', async ({
  page,
}) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Good to see you, Dana', level: 1 })).toBeVisible()
  for (const tool of [
    'people',
    'onboarding',
    'schedule',
    'training',
    'operations',
    'communication',
    'settings',
  ]) {
    await expect(page.getByTestId(`tool-${tool}`)).toBeVisible()
  }
  // No wall of to-dos on Home: the list itself is on its own page.
  await expect(page.getByRole('heading', { name: 'Decisions waiting' })).toHaveCount(0)
  await expectFitsAndAccessible(page, '/app')

  // Reports are out of the navigation, and still open for someone allowed.
  await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0)
  expect((await page.goto('/app/reports'))?.status()).toBe(200)

  await page.goto('/app')
  await page.getByTestId('attention-summary').click()
  await expect(page).toHaveURL(/\/app\/attention$/)
  await expect(page.getByRole('heading', { name: 'Needs attention', level: 1 })).toBeVisible()
  await expectFitsAndAccessible(page, '/app/attention')

  await page.goto('/app/people')
  await expect(page.getByTestId('add-new-hire')).toBeVisible()
  await page.goto('/app/onboarding')
  await page.getByTestId('add-new-hire').click()
  await expect(page).toHaveURL(/\/app\/people\/invite$/)
  expectNoConsoleErrors(errors)
})

test('a location manager sees only the tools they can open', async ({ page }) => {
  await signIn(page, PEOPLE.salonGmPearl.email)
  await page.goto('/app')
  const nav = page.getByRole('navigation', { name: 'Administration' })
  const navLabels = (await nav.locator('a').allTextContents()).map((t) => t.trim())
  const tools = {
    people: 'People',
    onboarding: 'Onboarding',
    schedule: 'Schedule',
    training: 'Training',
    operations: 'Operations',
    communication: 'Communication',
    settings: 'Settings',
  }
  // A card appears exactly when its section is in this person's navigation.
  for (const [key, label] of Object.entries(tools)) {
    await expect(page.getByTestId(`tool-${key}`), label).toHaveCount(
      navLabels.includes(label) ? 1 : 0,
    )
  }
})

test('signing out of administration, then into another account', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app')
  await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/signin$/)
  for (const path of ['/app', '/app/people']) {
    await page.goto(path)
    await expect(page, path).toHaveURL(/\/signin$/)
  }
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/my')
  await expect(page.getByRole('heading', { name: 'Hello, Sam' })).toBeVisible()
})

test('too many sign-in attempts are not reported as a wrong password', async ({ page }) => {
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Too many requests. Please try again later.' }),
    }),
  )
  await page.goto('/signin')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(PEOPLE.harborOwner.email)
  await page.getByLabel('Password').fill('not-the-point-here')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('signin-error')).toContainText('Too many sign-in attempts')
  await expect(page.getByTestId('signin-error')).not.toContainText('did not match')
})

test('an owner reads reports, follows a figure, and downloads a safe CSV', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/reports')
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible()
  await expectFitsAndAccessible(page, '/app/reports')

  await page.getByRole('link', { name: 'Open report' }).nth(3).click()
  await expect(page.getByRole('heading', { name: 'Shift operations', level: 1 })).toBeVisible()
  await expectFitsAndAccessible(page, '/app/reports/operations')

  await page.getByLabel('Location').selectOption({ label: 'Riverside' })
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page).toHaveURL(/location=/)

  const table = page.locator('section', { has: page.locator('#templates') })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    table.getByRole('link', { name: /Download CSV/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^evercalm-operations-templates-.*\.csv$/)
  const csv = await readFile(await download.path(), 'utf8')
  expect(csv.split('\r\n')[0]).toContain('Template,Tasks,Done,Skipped,Blocked')
  expect(csv).not.toMatch(UUID)
  expectNoConsoleErrors(errors)
})

test('a location manager reports on their own location only', async ({ page }) => {
  // The owner can see Downtown's id; the Riverside manager must not be able to use it.
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/reports/schedule')
  const downtown = await page
    .getByLabel('Location')
    .locator('option', { hasText: 'Downtown' })
    .getAttribute('value')
  expect(downtown).toBeTruthy()

  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/reports/schedule')
  const options = await page.getByLabel('Location').locator('option').allTextContents()
  expect(options).toEqual(['All of yours', 'Riverside'])

  expect((await page.goto(`/app/reports/schedule?location=${downtown}`))?.status()).toBe(404)
  const response = await page.request.get(
    `/app/reports/schedule/export?table=coverage&location=${downtown}`,
  )
  expect(response.status()).toBe(404)
})

test('an owner sees billing honestly, and the status follows provider events', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/settings/billing')
  await expect(page.getByText('Payments are not connected.')).toBeVisible()
  await expectFitsAndAccessible(page, '/app/settings/billing')

  const simulate = page.locator('section', { hasText: 'Development: simulate the provider' })
  await simulate.getByRole('button', { name: 'Payment failed' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Simulated')
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Payment is overdue' })).toBeVisible()

  await page
    .locator('section', { hasText: 'Development: simulate the provider' })
    .getByRole('button', { name: 'Payment succeeded' })
    .click()
  await expect(page.getByTestId('action-notice')).toContainText('Simulated')
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Payment is overdue' })).toHaveCount(0)
  await expect(page.getByText('Payment failed').first()).toBeVisible()
})

test('a pilot owner sees billing arranged with EverCalm, with nothing to self-serve', async ({
  page,
}) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.salonOwner.email)
  await page.goto('/app/settings/billing')
  await expect(
    page.getByText('Billing is arranged directly with EverCalm during the pilot.'),
  ).toBeVisible()
  await expect(page.getByText('Payments are not connected.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Switch to/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel subscription' })).toHaveCount(0)
  await expect(page.getByText('Development: simulate the provider')).toHaveCount(0)
  await expect(page.getByText('Pilot started').first()).toBeVisible()
  await expectFitsAndAccessible(page, '/app/settings/billing (manual pilot)')

  // The banner's link; the cancellation card has its own.
  await page.getByRole('link', { name: 'open a support case', exact: true }).first().click()
  await expect(page).toHaveURL(/\/app\/support\/new$/)
  expectNoConsoleErrors(errors)
})

test('an owner checks system status and opens a support case', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/settings/status')
  await expect(page.getByRole('heading', { name: 'Background work' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Notification delivery' })).toBeVisible()
  await expectFitsAndAccessible(page, '/app/settings/status')

  await page.goto('/app/support/new')
  await expectFitsAndAccessible(page, '/app/support/new')
  const subject = `Reminder arrived late ${Math.random().toString(36).slice(2, 6)}`
  await page.getByLabel('What is it about').selectOption({ label: 'Something is not working' })
  await page.getByLabel('In a few words').fill(subject)
  await page
    .getByLabel('What happened')
    .fill('The pre-shift reminder for Sam arrived after his shift had started.')
  await page.getByRole('button', { name: 'Open case' }).click()
  await expect(page.getByRole('heading', { name: subject })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'is open' })).toBeVisible()
  await expectFitsAndAccessible(page, '/app/support/[caseId]')

  await page.goto('/app/support')
  await expect(page.getByRole('link', { name: subject })).toBeVisible()
})

test('customers never reach the EverCalm team dashboard', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  expect((await page.goto('/platform'))?.status()).toBe(404)
  expect((await page.goto('/platform/support'))?.status()).toBe(404)
  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborEmployee.email)
  expect((await page.goto('/platform'))?.status()).toBe(404)
})
