import { expect, test } from '@playwright/test'
import { expectNoConsoleErrors, trackConsoleErrors } from './helpers'

/**
 * The public site.
 *
 * The key assertion is the second one: every link in the header and footer
 * must reach something real. "No button suggests functionality that does not
 * exist" is part of the definition of done, and the navigation is now the
 * homepage's own table of contents, so an anchor has to resolve to a section
 * that is actually on the page - a `#platform` that matches nothing is the
 * same broken promise as a 404.
 */
test('the home page renders and offers real calls to action', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Everyone walks')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What’s next.')
  await expect(page.getByRole('link', { name: 'Start free' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Book a 20-minute walkthrough' })).toBeVisible()

  expectNoConsoleErrors(errors)
})

test('every navigation link reaches a page that exists', async ({ page }) => {
  await page.goto('/')

  // Read from the DOM rather than from what is visible: the header links
  // collapse behind a breakpoint on a phone, and they still have to be real.
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>('header a[href], footer a[href]'))
      .map((a) => a.getAttribute('href'))
      .filter((h): h is string => !!h)
      .filter((h, i, all) => all.indexOf(h) === i),
  )
  expect(hrefs.length).toBeGreaterThanOrEqual(8)

  const anchors = hrefs.filter((h) => h.includes('#'))
  const pages = hrefs.filter((h) => !h.includes('#'))
  expect(anchors.length, 'the section navigation should be present').toBeGreaterThan(0)

  for (const href of anchors) {
    const id = href.slice(href.indexOf('#') + 1)
    await expect(page.locator(`#${id}`), `${href} points at no section`).toHaveCount(1)
  }

  for (const href of pages) {
    const response = await page.goto(href)
    expect(response?.status(), `${href} did not return 200`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

test('the industry templates can be switched', async ({ page }) => {
  await page.goto('/#industries')

  const restaurants = page.getByRole('tab', { name: 'Restaurants' })
  const salons = page.getByRole('tab', { name: 'Salons & spas' })

  await expect(restaurants).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Restaurants & bars' })).toBeVisible()

  await salons.click()
  await expect(salons).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Salons & spas' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Restaurants & bars' })).toBeHidden()
})

test('the security page states what is NOT in place', async ({ page }) => {
  await page.goto('/security')
  await expect(page.getByRole('heading', { name: 'Not yet in place' })).toBeVisible()
  await expect(page.getByText('SOC 2')).toBeVisible()
})
