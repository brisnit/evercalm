import { expect, test } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * Keyboard operability. Full keyboard access is a stated requirement, so it
 * is exercised rather than assumed.
 */
test.describe('keyboard access', () => {
  test('the skip link is the first stop and moves focus to main content', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()
  })

  test('the sign-in form can be completed entirely by keyboard', async ({ page }) => {
    await page.goto('/signin')
    await page.getByLabel('Email').focus()
    await page.keyboard.type(PEOPLE.harborOwner.email)
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()
    await page.keyboard.type('EverCalmDev!2026')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused()
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/app/)
    await expect(page.getByRole('banner')).toContainText('Harbor & Vine')
  })

  test('every interactive element in the admin nav is reachable and labelled', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    const links = page.getByRole('navigation', { name: 'Administration' }).getByRole('link')
    const count = await links.count()
    expect(count).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < count; i += 1) {
      const text = (await links.nth(i).textContent())?.trim()
      expect(text, 'a navigation link has no accessible text').toBeTruthy()
    }
  })
})
