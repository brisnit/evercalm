import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * WCAG 2.2 AA scanning on every Slice 1 screen.
 *
 * Runs at desktop and phone width. Any violation fails the build.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
}

const PUBLIC_PAGES = ['/', '/pricing', '/contact', '/security', '/signin', '/design']

for (const path of PUBLIC_PAGES) {
  test(`public page ${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path)
    const results = await scan(page)
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual(
      [],
    )
  })
}

test('administration screens have no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  for (const path of ['/app', '/app/settings', '/app/settings/audit']) {
    await page.goto(path)
    const results = await scan(page)
    expect(
      results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`),
      `Violations on ${path}`,
    ).toEqual([])
  }
})

test('the employee surface has no accessibility violations', async ({ page }) => {
  // signIn already lands an employee on /my; navigating again races the
  // client router's own redirect.
  await signIn(page, PEOPLE.harborEmployee.email)
  await expect(page).toHaveURL(/\/my$/)
  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the permission-denied screen has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/settings/audit')
  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})
