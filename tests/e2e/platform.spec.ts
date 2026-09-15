import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, SEED_PASSWORD, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The EverCalm team's side: the organization directory, audited diagnostics,
 * and the support queue - and proof that a customer never sees what the team
 * writes internally.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const STAFF = { admin: 'morgan@evercalm.test', agent: 'jamie@evercalm.test' }

async function signInAsStaff(page: Page, email: string) {
  await page.goto('/signin')
  await page.waitForFunction(() => {
    const el = document.querySelector('#email')
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'))
  })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(SEED_PASSWORD)
  await expect(page.getByLabel('Email')).toHaveValue(email)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/platform/, { timeout: 30_000 })
  await page.getByRole('main').waitFor()
}

async function expectFitsAndAccessible(page: Page, path: string) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${path} scrolls sideways`).toBeLessThanOrEqual(viewport + 1)
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  expect(results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`)).toEqual([])
}

test('staff land on the team dashboard and cannot enter a customer workspace', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signInAsStaff(page, STAFF.agent)
  await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Organizations' })
      .getByRole('link', { name: 'Harbor & Vine' }),
  ).toBeVisible()
  await expectFitsAndAccessible(page, '/platform')

  await page.goto('/app')
  await expect(page).toHaveURL(/\/platform$/)
  await page.goto('/my')
  await expect(page).toHaveURL(/\/platform$/)
  expectNoConsoleErrors(errors)
})

test('diagnostics stay closed until opened, and opening is recorded', async ({ page }) => {
  await signInAsStaff(page, STAFF.admin)
  await page
    .getByRole('region', { name: 'Organizations' })
    .getByRole('link', { name: 'Harbor & Vine' })
    .click()
  await expect(page.getByRole('heading', { name: 'Harbor & Vine', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Delivery failures (30 days)' })).toHaveCount(0)
  await expectFitsAndAccessible(page, '/platform/organizations/[id]')

  await page.getByRole('button', { name: 'Open diagnostics' }).click()
  await expect(page.getByRole('heading', { name: 'Delivery failures (30 days)' })).toBeVisible()
  await expect(page.getByText(/Open until/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry recent failures' })).toBeVisible()
  await expectFitsAndAccessible(page, '/platform/organizations/[id] diagnostics')

  // The owner can see that EverCalm looked.
  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/settings/audit')
  await expect(
    page.getByText(/EverCalm support viewed delivery and background-work diagnostics/).first(),
  ).toBeVisible()
})

test('support replies reach the customer, and internal notes never do', async ({ page }) => {
  const note = `Internal: check provider logs ${Math.random().toString(36).slice(2, 6)}`
  const reply = `We found the cause ${Math.random().toString(36).slice(2, 6)}.`
  await signInAsStaff(page, STAFF.agent)
  await page.goto('/platform/support')
  await expectFitsAndAccessible(page, '/platform/support')
  await page.getByRole('link', { name: 'A server did not get the schedule email' }).click()
  await expect(page.getByText('Internal · never shown to the customer').first()).toBeVisible()
  await expectFitsAndAccessible(page, '/platform/support/[caseId]')

  await page.getByRole('textbox', { name: /^Note/ }).fill(note)
  await page.getByRole('button', { name: 'Save internal note' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Internal note saved')
  await page.getByRole('textbox', { name: /^Reply/ }).fill(reply)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Sent to the customer')
  const caseUrl = page.url()
  const caseId = caseUrl.split('/').at(-1)

  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto(`/app/support/${caseId}`)
  await expect(page.getByText(reply)).toBeVisible()
  await expect(page.getByText(note)).toHaveCount(0)
  await expect(page.getByText(/Two email deliveries for Harbor timed out/)).toHaveCount(0)
})

test('a support administrator sets a manual pilot’s status, with a reason', async ({ page }) => {
  await signInAsStaff(page, STAFF.admin)
  await page
    .getByRole('region', { name: 'Organizations' })
    .getByRole('link', { name: 'Lumen Salon' })
    .click()
  await expect(page.getByRole('heading', { name: 'Lumen Salon', level: 1 })).toBeVisible()
  await expect(page.getByText('Manual pilot')).toBeVisible()
  await expectFitsAndAccessible(page, '/platform/organizations/[id] manual pilot')

  const reason = `Pilot invoice overdue ${Math.random().toString(36).slice(2, 6)}`
  await page.getByLabel('Pilot subscription status').selectOption({ label: 'Payment overdue' })
  await page.getByLabel('Reason').fill(reason)
  await page.getByRole('button', { name: 'Set status' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('now past due')
  await page.reload()
  await expect(page.getByText(reason).first()).toBeVisible()

  await page.getByLabel('Pilot subscription status').selectOption({ label: 'Active' })
  await page.getByLabel('Reason').fill('Invoice paid')
  await page.getByRole('button', { name: 'Set status' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('now active')
})

test('a support agent cannot change a subscription, and a provider-managed one has no control', async ({
  page,
}) => {
  await signInAsStaff(page, STAFF.agent)
  await page
    .getByRole('region', { name: 'Organizations' })
    .getByRole('link', { name: 'Lumen Salon' })
    .click()
  await expect(page.getByRole('heading', { name: 'Lumen Salon', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set status' })).toHaveCount(0)

  await page.context().clearCookies()
  await signInAsStaff(page, STAFF.admin)
  await page
    .getByRole('region', { name: 'Organizations' })
    .getByRole('link', { name: 'Harbor & Vine' })
    .click()
  await expect(page.getByRole('heading', { name: 'Harbor & Vine', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set status' })).toHaveCount(0)
})
