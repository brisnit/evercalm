import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, signOut, trackConsoleErrors } from './helpers'

/**
 * The isolation proof, driven through the real browser rather than SQL:
 * each owner signs in and sees only their own organization.
 */
test.describe('cross-tenant isolation in the browser', () => {
  test('the restaurant owner sees only Harbor & Vine', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, PEOPLE.harborOwner.email)

    await expect(page.getByRole('banner')).toContainText('Harbor & Vine')
    await expect(page.getByRole('banner')).not.toContainText('Lumen')

    await page.goto('/app/settings')
    const settings = page.getByRole('main')
    await expect(settings).toContainText('Riverside')
    await expect(settings).toContainText('Downtown')
    await expect(settings).not.toContainText('Pearl District')
    await expect(settings).not.toContainText('Boise Bench')

    expectNoConsoleErrors(errors)
  })

  test('the salon owner sees only Lumen Salon & Spa', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, PEOPLE.salonOwner.email)

    await expect(page.getByRole('banner')).toContainText('Lumen Salon')
    await expect(page.getByRole('banner')).not.toContainText('Harbor')

    await page.goto('/app/settings')
    const settings = page.getByRole('main')
    await expect(settings).toContainText('Pearl District')
    await expect(settings).toContainText('Boise Bench')
    await expect(settings).not.toContainText('Riverside')
    await expect(settings).not.toContainText('Downtown')

    expectNoConsoleErrors(errors)
  })

  test('an employee record in another organization answers 404', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/people')
    const href = await page
      .getByRole('main')
      .locator('a[href^="/app/people/"]')
      .evaluateAll((links) =>
        links
          .map((a) => a.getAttribute('href') ?? '')
          .find((h) => /^\/app\/people\/[0-9a-f-]{36}$/.test(h)),
      )
    expect(href, 'a Harbor & Vine profile link').toBeTruthy()

    await signOut(page)
    await signIn(page, PEOPLE.salonOwner.email)
    const response = await page.goto(href!)
    expect(response?.status()).toBe(404)
  })

  test('the audit log of one tenant never mentions the other', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    // The whole available history, not just the latest page of it.
    await page.goto('/app/settings/audit?all=1')
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()

    const table = page.getByRole('table')
    await expect(table).toContainText('Riverside')
    await expect(table).not.toContainText('Pearl District')
    await expect(table).not.toContainText('Lumen')

    await signOut(page)
    await signIn(page, PEOPLE.salonOwner.email)
    await page.goto('/app/settings/audit?all=1')
    const salonTable = page.getByRole('table')
    await expect(salonTable).toContainText('Pearl District')
    await expect(salonTable).not.toContainText('Riverside')
  })
})
