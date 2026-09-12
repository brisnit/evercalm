import { expect, test } from '@playwright/test'
import { expectNoConsoleErrors, trackConsoleErrors } from './helpers'

/**
 * The public site. Slice 1 ships four real pages.
 *
 * The key assertion is the last one: every link in the navigation must reach
 * a page that actually exists. "No button suggests functionality that does
 * not exist" is part of the definition of done.
 */
test('the home page renders and offers real calls to action', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Run the shift')
  await expect(page.getByRole('link', { name: 'Book a demo' })).toBeVisible()
  expectNoConsoleErrors(errors)
})

test('every navigation link reaches a page that exists', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  const hrefs = await nav
    .getByRole('link')
    .evaluateAll((links) =>
      links
        .map((l) => (l as HTMLAnchorElement).getAttribute('href'))
        .filter((h): h is string => !!h),
    )
  expect(hrefs.length).toBeGreaterThanOrEqual(4)

  for (const href of hrefs) {
    const response = await page.goto(href)
    expect(response?.status(), `${href} did not return 200`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

test('the security page states what is NOT in place', async ({ page }) => {
  await page.goto('/security')
  await expect(page.getByRole('heading', { name: 'Not yet in place' })).toBeVisible()
  await expect(page.getByText('SOC 2')).toBeVisible()
})
