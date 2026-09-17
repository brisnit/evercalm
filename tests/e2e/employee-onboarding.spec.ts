import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The employee onboarding experience, at phone width.
 *
 * The product promise for a new hire is "you always know what comes next", so
 * the next action is asserted to be the first thing on the screen.
 */

test('a new hire lands on their next action', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborNewServer.email)

  await expect(page).toHaveURL(/\/my$/)
  const next = page.getByTestId('onboarding-card')
  await expect(next.getByRole('heading', { name: 'Do this next' })).toBeVisible()
  await expect(next).toHaveAttribute('href', '/my/onboarding')

  expectNoConsoleErrors(errors)
})

test('they can open the checklist and mark a step done', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.getByTestId('onboarding-card').click()

  await expect(page).toHaveURL(/\/my\/onboarding$/)
  await expect(page.getByRole('heading', { name: 'Your onboarding' })).toBeVisible()

  const doneButtons = page.getByRole('button', { name: 'Mark done' })
  const before = await doneButtons.count()
  expect(before).toBeGreaterThan(0)

  const doneBadgesBefore = await page.getByText('Done', { exact: true }).count()

  await doneButtons.first().click()

  // The completed step loses its controls and gains a Done badge. Assert the
  // outcome, not the transient confirmation message.
  await expect(page.getByText('Done', { exact: true })).toHaveCount(doneBadgesBefore + 1)
  await expect(doneButtons).toHaveCount(before - 1)
})

test('a training step shows its course and completes with it, not by hand', async ({ page }) => {
  await signIn(page, PEOPLE.salonNewStylist.email)
  // Navigate by link rather than page.goto: a direct goto races the
  // client-side router that sign-in just started.
  await page.getByTestId('onboarding-card').click()
  await expect(page).toHaveURL(/\/my\/onboarding$/)

  const step = page
    .getByRole('listitem')
    .filter({ hasText: 'Patch testing and colour consultation' })
    .first()
  await expect(step.getByText('Completes with the course')).toBeVisible()
  await expect(step.getByRole('link', { name: 'Continue the course' })).toBeVisible()
  await expect(step.getByRole('button', { name: 'Mark done' })).toHaveCount(0)
})

test('an employee cannot complete their own manager-verified step', async ({ page }) => {
  await signIn(page, PEOPLE.salonNewStylist.email)
  await page.getByTestId('onboarding-card').click()
  await expect(page).toHaveURL(/\/my\/onboarding$/)

  await expect(page.getByText(/Ask your manager to confirm this/).first()).toBeVisible()
})

test('the onboarding screen does not scroll sideways on a phone', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.getByTestId('onboarding-card').click()
  await expect(page).toHaveURL(/\/my\/onboarding$/)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls sideways at this width').toBeLessThanOrEqual(1)
})
