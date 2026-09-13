import { expect, test } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

const DIR = 'docs/screenshots'

test.describe('@screenshots', () => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Set CAPTURE_SCREENSHOTS=1 to capture')

  test('mobile employee', async ({ page }) => {
    await signIn(page, PEOPLE.harborNewServer.email)
    await page.screenshot({ path: `${DIR}/mobile-01-employee-home.png`, fullPage: true })

    await page.getByRole('link', { name: 'Open your onboarding' }).click()
    await expect(page).toHaveURL(/\/my\/onboarding$/)
    await expect(page.getByRole('heading', { name: 'Your onboarding' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-02-onboarding.png`, fullPage: true })
  })

  test('mobile salon stylist waiting on a later slice', async ({ page }) => {
    await signIn(page, PEOPLE.salonNewStylist.email)
    await page.getByRole('link', { name: 'Open your onboarding' }).click()
    await expect(page).toHaveURL(/\/my\/onboarding$/)
    await expect(page.getByRole('heading', { name: 'Your onboarding' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-03-blocked-steps.png`, fullPage: true })
  })

  test('mobile administration', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    await page.screenshot({ path: `${DIR}/mobile-04-admin-dashboard.png`, fullPage: true })

    await page.goto('/app/people')
    await page.screenshot({ path: `${DIR}/mobile-05-admin-directory.png`, fullPage: true })
  })

  test('mobile administration of the new screens', async ({ page }) => {
    // These are desktop-first surfaces, but an owner will open them on a phone,
    // so they are captured at phone width to catch overflow and clipping.
    await signIn(page, PEOPLE.harborHr.email)

    await page.goto('/app/onboarding')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-06-onboarding-board.png`, fullPage: true })

    await page.goto('/app/onboarding/templates')
    await expect(page.getByRole('heading', { name: 'Checklists' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-07-template-list.png`, fullPage: true })

    await page.getByRole('link', { name: 'New Server Onboarding' }).click()
    await expect(page.getByRole('heading', { name: 'New Server Onboarding' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-08-template-builder.png`, fullPage: true })

    await page.goto('/app/people/import')
    await expect(page.getByRole('heading', { name: 'Import from a spreadsheet' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-09-import-upload.png`, fullPage: true })
  })

  test('mobile employee communication', async ({ page }) => {
    await signIn(page, PEOPLE.harborNewServer.email)
    await page.screenshot({ path: `${DIR}/mobile-10-home-needs-you.png`, fullPage: true })

    await page.goto('/my/inbox')
    await expect(page.getByRole('heading', { name: 'Your inbox' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-11-inbox.png`, fullPage: true })

    await page
      .getByRole('link', { name: /Allergen handling/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: 'Confirm you have read this' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-12-message.png`, fullPage: true })

    await page.goto('/my/inbox?filter=acknowledge')
    await page.screenshot({ path: `${DIR}/mobile-13-inbox-needs-you.png`, fullPage: true })

    await page.goto('/my/notifications')
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-14-preferences.png`, fullPage: true })
  })

  test('mobile manager communication', async ({ page }) => {
    await signIn(page, PEOPLE.harborHr.email)
    await page.goto('/app/comms')
    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-15-announcements.png`, fullPage: true })

    await page
      .getByRole('link', { name: /Allergen handling/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/mobile-16-receipts.png`, fullPage: true })

    await page.goto('/app/comms/new')
    await page.screenshot({ path: `${DIR}/mobile-17-composer.png`, fullPage: true })
  })
})
