import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The employee surface. Also runs at iPhone width, because /my is mobile-first
 * and desktop-only coverage would miss how it is actually used.
 */
test('an employee lands on their own surface with their own location', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborEmployee.email)

  await expect(page).toHaveURL(/\/my$/)
  await expect(page.getByRole('heading', { name: /Hello, Sam/ })).toBeVisible()
  await expect(page.getByText('Riverside')).toBeVisible()
  await expect(page.getByText('Downtown')).toHaveCount(0)

  // No administration link for someone with no administrative capability.
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0)
  expectNoConsoleErrors(errors)
})

test('the employee surface does not scroll horizontally on a phone', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls sideways at this width').toBeLessThanOrEqual(1)
})

test('a manager can move between administration and their own work', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await expect(page).toHaveURL(/\/app$/)
  await page.getByRole('link', { name: 'My work' }).click()
  await expect(page).toHaveURL(/\/my$/)
  await expect(page.getByRole('link', { name: 'Administration' })).toBeVisible()
})
