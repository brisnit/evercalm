import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * Shift operations from the manager's side: the board, handoffs and
 * templates, and the boundaries around each.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('a manager verifies waiting work from the board', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/operations')
  await expect(page.getByRole('heading', { name: /^Today/, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Needs you now' })).toBeVisible()
  await expect(page.getByText('Out of check presenters', { exact: false }).first()).toBeVisible()

  const verify = page.getByRole('button', { name: 'Verify “Uniform check”' })
  await verify.click()
  await expect(page.getByTestId('action-notice')).toContainText('Verified.')
  await expect(verify).toHaveCount(0)
  expectNoConsoleErrors(errors)
})

test('a manager resolves a handoff, and it keeps its history', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/operations/handoffs')
  const handoff = page.getByRole('article', { name: 'Handoff: Dish machine rinse arm is leaking' })
  await handoff.getByRole('button', { name: 'Resolve' }).click()
  await handoff.getByLabel('What was done').fill('Technician replaced the seal.')
  await handoff.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Handoff resolved.')
  await expect(handoff).toHaveCount(0)

  await page.getByRole('link', { name: 'Resolved' }).click()
  const resolved = page.getByRole('article', { name: 'Handoff: Dish machine rinse arm is leaking' })
  await expect(
    resolved.getByText(/Resolved by Marcus Bell.*Technician replaced the seal\./),
  ).toBeVisible()
})

test('an owner builds and publishes a template', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborOwner.email)
  const name = `Patio opening ${Math.random().toString(36).slice(2, 6)}`
  await page.goto('/app/operations/templates/new')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Kind of work').selectOption({ label: 'Opening duties' })
  await page.getByLabel('Riverside').check()
  await page.getByRole('button', { name: 'Create template' }).click()
  await expect(page).toHaveURL(/\/app\/operations\/templates\/[0-9a-f-]{36}$/)

  await page.getByLabel('New section').fill('Before doors open')
  await page.getByRole('button', { name: 'Add section' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Section added.')

  await page.getByRole('button', { name: 'Add a task to Before doors open' }).click()
  await page
    .getByRole('textbox', { name: /^Task/ })
    .fill('Wipe down patio tables and put out heaters')
  await page.getByRole('button', { name: 'Add task' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Task added.')
  await expect(page.getByText('Wipe down patio tables and put out heaters').first()).toBeVisible()

  // The builder mid-draft is where the markup is most complicated.
  const draft = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  expect(draft.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])

  await page.getByRole('button', { name: 'Publish version 1' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Version 1 published.')
  await expect(page.getByRole('button', { name: 'Start a new draft' })).toBeVisible()
  expectNoConsoleErrors(errors)
})

test('the salon’s handoffs speak about clients, not guests', async ({ page }) => {
  await signIn(page, PEOPLE.salonGmPearl.email)
  await page.goto('/app/operations/handoffs')
  await expect(
    page
      .getByRole('article', { name: 'Handoff: Client unhappy with her fringe length' })
      .getByText('Client issue'),
  ).toBeVisible()
})

test('another location or another business is not found', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/operations')
  const riverside = await page
    .getByLabel('Location')
    .locator('option', { hasText: 'Riverside' })
    .getAttribute('value')
  await page.goto('/app/operations/templates')
  const template = await page.getByRole('link', { name: 'Server side work' }).getAttribute('href')

  await page.context().clearCookies()
  await signIn(page, 'tess@harborvine.test')
  expect((await page.goto(template!))?.status()).toBe(404)
  expect((await page.goto(`/app/operations?location=${riverside}`))?.status()).toBe(404)
  expect((await page.goto(`/app/operations/handoffs?location=${riverside}`))?.status()).toBe(404)
  expect((await page.goto('/app/operations?location=not-a-location'))?.status()).toBe(404)

  await page.context().clearCookies()
  await signIn(page, PEOPLE.salonOwner.email)
  expect((await page.goto(template!))?.status()).toBe(404)
})
