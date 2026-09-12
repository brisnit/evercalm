import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * Onboarding checklist authoring.
 *
 * The assertions that matter are the safety ones: a draft is visibly not
 * assignable, a published version cannot be edited in place, and archiving
 * states its impact before it happens.
 */

test('the checklist list distinguishes published from draft', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')

  await expect(page.getByRole('heading', { name: 'Checklists' })).toBeVisible()
  await expect(page.getByText('New Server Onboarding')).toBeVisible()
  await expect(page.getByText('Published').first()).toBeVisible()
  expectNoConsoleErrors(errors)
})

test('a new checklist is created as a draft that cannot be assigned', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')

  const name = `Browser Checklist ${Date.now().toString().slice(-6)}`
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create draft' }).click()

  await expect(page).toHaveURL(/\/app\/onboarding\/templates\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText('Draft — cannot be assigned').first()).toBeVisible()
  await expect(
    page.getByText('Nobody can be assigned this checklist until you publish it.'),
  ).toBeVisible()
})

test('a step can be added and the draft published', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')

  const name = `Publishable ${Date.now().toString().slice(-6)}`
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()

  // Publishing with no steps must be refused.
  await page.getByRole('button', { name: /^Publish v1$/ }).click()
  await expect(page.getByText('Add at least one step before publishing.')).toBeVisible()

  // The add-step form lives behind a disclosure. Its accessible name comes from
  // the Field label, which carries a required marker, so the field is addressed
  // by role and name rather than by an exact label string.
  await page.getByText('Add a step to First week').click()
  await page.getByRole('textbox', { name: /^Step\b/ }).fill('Read the safety notes')
  await page.getByRole('button', { name: 'Add step' }).click()
  await expect(page.getByText('Read the safety notes')).toBeVisible()

  await page.getByRole('button', { name: /^Publish v1$/ }).click()
  await expect(page.getByText(/New hires from now on get this version/)).toBeVisible()
  await expect(page.getByText('Published v1').first()).toBeVisible()
})

test('a published checklist is read-only until a new draft is started', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')
  await page.getByRole('link', { name: 'New Server Onboarding' }).click()

  await expect(page.getByText(/Published and in use. Start a new draft/)).toBeVisible()
  // No editing controls are offered against the published version.
  await expect(page.getByRole('button', { name: 'Add step' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Start a new draft' }).click()
  await expect(page.getByText(/Nothing live has changed/)).toBeVisible()
  await expect(page.getByText(/is not live/)).toBeVisible()
})

test('archiving states its impact before it happens', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')
  await page.getByRole('link', { name: 'Kitchen Onboarding' }).click()

  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('heading', { name: /Archive "Kitchen Onboarding"/ })).toBeVisible()
  await expect(
    page.getByText(/onboarding on this checklist right now|Completed history is kept/),
  ).toBeVisible()
  // Cancel leaves it alone.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Published v1').first()).toBeVisible()
})

test('the preview shows what a new hire would see', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.salonOwner.email)
  await page.goto('/app/onboarding/templates')
  await page.getByRole('link', { name: 'New Stylist Onboarding' }).click()
  await page.getByRole('link', { name: 'Preview as a new hire' }).click()

  await expect(page.getByRole('heading', { name: 'What a new hire sees' })).toBeVisible()
  // Salon language, and the platform-waiting steps are honest about why.
  await expect(page.getByText('Licence and paperwork')).toBeVisible()
  await expect(page.getByText('Waiting on EverCalm')).toBeVisible()
  expectNoConsoleErrors(errors)
})

test('a general manager cannot author checklists', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/onboarding/templates')
  await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible()
})
