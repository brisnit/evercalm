import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * Nothing may scroll sideways at phone width.
 *
 * A page whose content is wider than the screen is broken on a phone: content
 * is cut off, and the whole layout drifts as the reader scrolls. It is also
 * invisible in unit tests and easy to reintroduce - one grid item that refuses
 * to shrink is enough - so it is asserted rather than reviewed.
 *
 * The check reports the widest offending element, because "the page is 88px
 * too wide" on its own is a long hunt.
 */
async function expectNoHorizontalOverflow(page: Page, path: string) {
  const report = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = el.getBoundingClientRect()
      // Deliberately off-screen things (the skip link) are not overflow.
      if (rect.width === 0 || rect.right < 0) continue
      if (rect.right > viewport + 1) {
        offenders.push(
          `<${el.tagName.toLowerCase()} class="${el.className}"> right=${Math.round(rect.right)}`,
        )
      }
    }
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      widest: offenders.slice(0, 3),
    }
  })

  expect(
    report.scrollWidth,
    `${path} scrolls sideways at ${report.viewport}px. Widest: ${report.widest.join(' | ')}`,
  ).toBeLessThanOrEqual(report.viewport + 1)
}

test.use({ viewport: { width: 390, height: 844 } })

test('administration screens fit a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  for (const path of [
    '/app',
    '/app/setup',
    '/app/people',
    '/app/people/invite',
    '/app/people/invitations',
    '/app/people/import',
    '/app/onboarding',
    '/app/onboarding/templates',
    '/app/settings',
    '/app/settings/structure',
    '/app/settings/values',
    '/app/settings/audit',
  ]) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }
})

test('the template builder fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')
  await page.getByRole('link', { name: 'New Server Onboarding' }).click()
  await expect(page.getByRole('heading', { name: 'New Server Onboarding' })).toBeVisible()
  await expectNoHorizontalOverflow(page, '/app/onboarding/templates/[id]')

  await page.getByRole('link', { name: /^Preview/ }).click()
  await expect(page.getByRole('heading', { name: 'What a new hire sees' })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'template preview')
})

test('an employee profile fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/people')
  await page.getByRole('link', { name: /Ava Lindqvist/ }).click()
  await expect(page.getByRole('heading', { name: /Ava Lindqvist/ })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'employee profile')
})

test('the employee surface fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await expectNoHorizontalOverflow(page, '/my')

  await page.getByRole('link', { name: 'Open your onboarding' }).click()
  await expect(page).toHaveURL(/\/my\/onboarding$/)
  await expectNoHorizontalOverflow(page, '/my/onboarding')
})

test('public pages fit a phone screen', async ({ page }) => {
  for (const path of ['/', '/pricing', '/contact', '/security', '/signin']) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }
})
