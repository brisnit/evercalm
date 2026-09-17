import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * A manager links a course to an onboarding checklist, starts someone's
 * onboarding, and the new hire is given that course. Desktop; the employee
 * working through linked training runs on a phone in
 * employee-onboarding-training.spec.ts.
 */

async function switchTo(page: Page, email: string) {
  await page.context().clearCookies()
  await signIn(page, email)
}

test('a checklist step links a published course, and starting onboarding assigns it', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')
  await page.waitForLoadState('networkidle')

  const name = `Host onboarding ${Date.now().toString().slice(-6)}`
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.waitForLoadState('networkidle')

  // A training step must name a published course; drafts are not offered.
  await page.getByText('Add a step to First week').click()
  await page.getByRole('textbox', { name: /^Step\b/ }).fill('Allergen awareness training')
  await page
    .getByRole('combobox', { name: /Step type/ })
    .first()
    .selectOption('training_assignment')
  const course = page.getByRole('combobox', { name: /^Course/ })
  await expect(course.getByRole('option', { name: /Wine service fundamentals/ })).toHaveCount(0)
  await course.selectOption({ label: 'Allergen awareness for service (version 2)' })
  await page.getByRole('button', { name: 'Add step' }).click()
  await expect(page.getByText('Course: Allergen awareness for service').first()).toBeVisible()

  // Aim it at hosts Downtown, then publish.
  await page.getByRole('checkbox', { name: 'Host', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Downtown', exact: true }).check()
  await page.getByRole('button', { name: 'Save targeting' }).click()
  await expect(page.getByText(/Targeting saved|saved/i).first()).toBeVisible()
  await page.getByRole('button', { name: /^Publish v1$/ }).click()
  await expect(page.getByText('Published v1').first()).toBeVisible()

  // Start Theo's onboarding. He already has version 1 of the course, not yet
  // started, so onboarding links to that assignment instead of adding another.
  await page.goto('/app/people')
  await page
    .getByRole('link', { name: /Theo Nakashima/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Start onboarding' }).click()
  await expect(page.getByText('Allergen awareness for service, version 1').first()).toBeVisible()

  await switchTo(page, 'theo@harborvine.test')
  await page.goto('/my/onboarding')
  const step = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'Allergen awareness training' })
  await expect(step.getByText('Completes with the course')).toBeVisible()
  await expect(step.getByText('version 1')).toBeVisible()
  await expect(step.getByRole('link', { name: 'Start the course' })).toBeVisible()
  await expect(step.getByRole('button', { name: 'Mark done' })).toHaveCount(0)

  // One next action on the home screen, not the same lesson twice.
  await page.goto('/my')
  await expect(page.getByTestId('onboarding-card')).toHaveAttribute('href', '/my/onboarding')
  await expect(page.getByTestId('training-card')).toContainText('Your next course is in onboarding')
  await expect(page.locator('a[href*="/lessons/"]')).toHaveCount(0)
})
