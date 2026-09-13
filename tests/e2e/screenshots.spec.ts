import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * Screenshot capture for review.
 *
 * Not an assertion suite - run explicitly with
 *   npx playwright test screenshots --project=desktop
 * to refresh the images in docs/screenshots/.
 *
 * Tagged so it does not run as part of the normal browser suite.
 */

const DIR = 'docs/screenshots'

/** The card panel that contains a given heading. */
function card(page: Page, heading: string) {
  return page
    .getByRole('heading', { name: heading })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]')
}

test.describe('@screenshots', () => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Set CAPTURE_SCREENSHOTS=1 to capture')

  test('desktop administration', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page, PEOPLE.harborOwner.email)

    await page.screenshot({ path: `${DIR}/desktop-01-dashboard.png`, fullPage: true })

    await page.goto('/app/people')
    await page.screenshot({ path: `${DIR}/desktop-02-directory.png`, fullPage: true })

    await page.goto('/app/onboarding')
    await page.screenshot({ path: `${DIR}/desktop-03-onboarding-board.png`, fullPage: true })

    await page.goto('/app/people')
    await page.getByRole('link', { name: /Ava Lindqvist/ }).click()
    await page.screenshot({ path: `${DIR}/desktop-04-employee-profile.png`, fullPage: true })

    await page.goto('/app/people/invite')
    await page.screenshot({ path: `${DIR}/desktop-05-invite.png`, fullPage: true })

    await page.goto('/app/setup')
    await page.screenshot({ path: `${DIR}/desktop-06-setup.png`, fullPage: true })

    await page.goto('/app/settings/structure')
    await page.screenshot({ path: `${DIR}/desktop-07-structure-restaurant.png`, fullPage: true })
  })

  test('desktop salon tenant', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page, PEOPLE.salonOwner.email)

    await page.goto('/app/settings/structure')
    await page.screenshot({ path: `${DIR}/desktop-08-structure-salon.png`, fullPage: true })

    await page.goto('/app')
    await page.screenshot({ path: `${DIR}/desktop-09-salon-dashboard.png`, fullPage: true })

    await page.goto('/app/settings/values')
    await page.screenshot({ path: `${DIR}/desktop-10-salon-values.png`, fullPage: true })
  })

  test('desktop onboarding templates', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page, PEOPLE.harborHr.email)

    await page.goto('/app/onboarding/templates')
    await expect(page.getByRole('heading', { name: 'Checklists' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-11-template-list.png`, fullPage: true })

    // A published template: read-only, with the new-draft path offered.
    await page.getByRole('link', { name: 'New Server Onboarding' }).click()
    await expect(page.getByRole('heading', { name: 'New Server Onboarding' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-12-template-published.png`, fullPage: true })

    await page.getByRole('link', { name: /^Preview/ }).click()
    await expect(page.getByRole('heading', { name: 'What a new hire sees' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-13-template-preview.png`, fullPage: true })

    // A draft: the editable builder, with the add-step form open.
    await page.goto('/app/onboarding/templates')
    const name = `Bar Onboarding ${Date.now().toString().slice(-4)}`
    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Create draft' }).click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
    await page
      .getByText(/^Add a step to/)
      .first()
      .click()
    await expect(page.getByRole('textbox', { name: /^Step\b/ })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-14-template-builder.png`, fullPage: true })
  })

  test('desktop onboarding assignment', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page, PEOPLE.harborOwner.email)

    // Somebody with no checklist yet, so the assignment control is visible.
    await page.goto('/app/people')
    await page.getByRole('link', { name: /Sam Whitfield/ }).click()
    await expect(page.getByRole('heading', { name: /Sam Whitfield/ })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-15-assignment.png`, fullPage: true })
  })

  test('desktop csv import', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    // The SALON tenant, so the screenshots show salon vocabulary rather than
    // restaurant defaults.
    await signIn(page, PEOPLE.salonOwner.email)

    await page.goto('/app/people/import')
    await expect(page.getByRole('heading', { name: 'Import from a spreadsheet' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-16-import-upload.png`, fullPage: true })

    const stamp = Date.now().toString().slice(-6)
    await page.setInputFiles('#import-file', {
      name: 'new-stylists.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Full name,Email,Job title,Salon,Role,Start date',
          `Wren Adeyemi ${stamp},wren.${stamp}@example.test,Stylist,Pearl District,Stylist,2026-10-01`,
          `Nadia Okonjo ${stamp},nadia.${stamp}@example.test,Colour Specialist,Pearl District,Colour Specialist,2026-10-05`,
          `Missing Email ${stamp},,Stylist,Pearl District,Stylist,`,
          `Bad Address ${stamp},not-an-email,Stylist,Pearl District,Stylist,whenever`,
          `Duplicate ${stamp},wren.${stamp}@example.test,Stylist,Unknown Salon,Stylist,`,
        ].join('\n'),
        'utf8',
      ),
    })
    await page.getByRole('button', { name: 'Read the file' }).click()

    await expect(page.getByRole('heading', { name: '2. Match your columns' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-17-import-review.png`, fullPage: true })

    // The mapping and the error table on their own, so each can be read at
    // full size rather than only as part of a very tall page.
    // The enclosing Card, found by walking up to the nearest card surface, so
    // the crop is the whole panel rather than the heading's own wrapper.
    await card(page, '2. Match your columns').screenshot({
      path: `${DIR}/desktop-18-import-mapping.png`,
    })
    await card(page, '3. Review every row').screenshot({
      path: `${DIR}/desktop-19-import-errors.png`,
    })

    await page.getByRole('button', { name: /^Import 2 people$/ }).click()
    await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-20-import-complete.png`, fullPage: true })
  })

  test('desktop communication', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page, PEOPLE.harborHr.email)

    await page.goto('/app/comms')
    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-21-announcements.png`, fullPage: true })

    await page.goto('/app/comms/new')
    await page.getByLabel('Title').fill('Winter uniform order closes Friday')
    await page
      .getByLabel('Message')
      .fill(
        'Sizes are due to the office by Friday.\n\n- Tell your GM your size\n- One jacket per person\n- Replacements are chargeable',
      )
    await page.getByRole('button', { name: /^Locations/ }).click()
    await page.getByRole('button', { name: /^Riverside/ }).click()
    await expect(page.getByText(/^Riverside$/).first()).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-22-composer.png`, fullPage: true })

    await page.goto('/app/comms')
    await page
      .getByRole('link', { name: /Allergen handling/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-23-receipts.png`, fullPage: true })

    await card(page, 'Who has read it').screenshot({
      path: `${DIR}/desktop-24-receipts-detail.png`,
    })
  })

  test('desktop publish confirmation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page, PEOPLE.harborHr.email)

    await page.goto('/app/comms/new')
    await page.getByLabel('Title').fill('Deep clean on Sunday night')
    await page.getByLabel('Message').fill('The kitchen closes an hour early for the deep clean.')
    await page.getByLabel('Ask people to confirm they read it').check()
    await page.getByRole('button', { name: /^Everyone/ }).click()
    await page.getByRole('button', { name: 'Everyone in the organization' }).click()
    await page.getByRole('button', { name: 'Save as draft' }).click()
    await expect(page.getByRole('heading', { name: 'Deep clean on Sunday night' })).toBeVisible()

    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByRole('heading', { name: 'Publish this announcement?' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-25-publish-confirm.png`, fullPage: true })
  })

  test('desktop salon communication', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page, PEOPLE.salonOwner.email)

    await page.goto('/app/comms')
    await page.screenshot({ path: `${DIR}/desktop-26-salon-announcements.png`, fullPage: true })

    await page
      .getByRole('link', { name: /Licence renewal/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/desktop-27-salon-receipts.png`, fullPage: true })
  })
})
