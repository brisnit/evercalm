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

    const locations = page.getByTestId('location-list')
    await expect(locations).toContainText('Riverside')
    await expect(locations).toContainText('Downtown')
    await expect(locations).not.toContainText('Pearl District')
    await expect(locations).not.toContainText('Boise Bench')

    expectNoConsoleErrors(errors)
  })

  test('the salon owner sees only Lumen Salon & Spa', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, PEOPLE.salonOwner.email)

    await expect(page.getByRole('banner')).toContainText('Lumen Salon')
    await expect(page.getByRole('banner')).not.toContainText('Harbor')

    const locations = page.getByTestId('location-list')
    await expect(locations).toContainText('Pearl District')
    await expect(locations).toContainText('Boise Bench')
    await expect(locations).not.toContainText('Riverside')
    await expect(locations).not.toContainText('Downtown')

    expectNoConsoleErrors(errors)
  })

  test('the audit log of one tenant never mentions the other', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/settings/audit')
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()

    const table = page.getByRole('table')
    await expect(table).toContainText('Riverside')
    await expect(table).not.toContainText('Pearl District')
    await expect(table).not.toContainText('Lumen')

    await signOut(page)
    await signIn(page, PEOPLE.salonOwner.email)
    await page.goto('/app/settings/audit')
    const salonTable = page.getByRole('table')
    await expect(salonTable).toContainText('Pearl District')
    await expect(salonTable).not.toContainText('Riverside')
  })
})
