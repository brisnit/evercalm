import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The employee's account control, on a desktop and on a phone.
 *
 * Every /my page shows who is signed in and offers Sign out; signing out ends
 * the session, so the next person can sign in on the same device.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const accountButton = (page: Page, name: string) =>
  page.getByRole('banner').getByRole('button', { name: `Account: ${name}` })

async function expectNoSidewaysScroll(page: Page, path: string) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${path} scrolls sideways`).toBeLessThanOrEqual(viewport + 1)
}

test('every employee screen shows who is signed in, without scrolling sideways', async ({
  page,
}) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborNewServer.email)
  const person = PEOPLE.harborNewServer.name

  await page.goto('/my/training')
  const training = await page.locator('a[href^="/my/training/"]').first().getAttribute('href')
  await page.goto('/my/inbox')
  const message = await page.locator('a[href^="/my/inbox/"]').first().getAttribute('href')
  await page.goto('/my/schedule')
  const shift = await page.locator('a[href^="/my/schedule/shifts/"]').first().getAttribute('href')

  const paths = [
    '/my',
    '/my/shift',
    '/my/schedule',
    '/my/time-off',
    '/my/availability',
    '/my/inbox',
    '/my/notifications',
    '/my/onboarding',
    '/my/training',
    ...[training, message, shift].filter((p): p is string => !!p),
  ]
  for (const path of paths) {
    await page.goto(path)
    const button = accountButton(page, person)
    await expect(button, path).toBeVisible()
    await expect(button, path).toHaveAttribute('aria-expanded', 'false')
    await expect(button, path).toContainText('Ava')
    await expectNoSidewaysScroll(page, path)
  }

  // Open, the panel must still fit the screen and pass an accessibility scan.
  await page.goto('/my')
  await accountButton(page, person).click()
  const panel = page.locator(`#${await accountButton(page, person).getAttribute('aria-controls')}`)
  await expect(panel).toBeVisible()
  await expect(panel.getByText(person)).toBeVisible()
  const box = await panel.boundingBox()
  const width = page.viewportSize()!.width
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  await expectNoSidewaysScroll(page, '/my (account open)')
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  expectNoConsoleErrors(errors)
})

const onPhone = () => test.info().project.name === 'mobile'

test('the account control works from the keyboard', async ({ page }) => {
  // iPhone Safari has no Tab key between links and buttons, so keyboard
  // traversal is proved on the desktop project; the phone project proves touch.
  test.skip(onPhone(), 'Keyboard traversal is covered by the desktop project.')
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/my/shift')
  const button = accountButton(page, PEOPLE.harborEmployee.name)

  // Reach it with Tab from the top of the page.
  await page.locator('body').focus()
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab')
    if (await button.evaluate((el) => el === document.activeElement)) break
  }
  await expect(button).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Notification settings' })).toBeFocused()
  await page.keyboard.press('Tab')
  const signOut = page.getByRole('button', { name: 'Sign out' })
  await expect(signOut).toBeFocused()

  // Escape closes it and returns focus to the control.
  await page.keyboard.press('Escape')
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(button).toBeFocused()
  await expect(signOut).toBeHidden()

  // Tabbing past the panel closes it.
  await page.keyboard.press(' ')
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(button).toHaveAttribute('aria-expanded', 'false')

  // Sign out from the keyboard.
  await button.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/signin$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.goto('/my')
  await expect(page).toHaveURL(/\/signin$/)
})

test('signing out ends the session so someone else can sign in', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/my')
  const button = accountButton(page, PEOPLE.harborEmployee.name)

  // Tapping outside closes the panel without doing anything.
  await button.click()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await page.getByRole('main').click({ position: { x: 4, y: 4 } })
  await expect(button).toHaveAttribute('aria-expanded', 'false')

  // A real tap on Sign out, which is how a phone reaches it.
  await button.click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/signin$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  // The session is gone: employee pages send you back to sign in.
  for (const path of ['/my', '/my/shift', '/my/inbox']) {
    await page.goto(path)
    await expect(page, path).toHaveURL(/\/signin$/)
  }

  // And another demo employee can sign in on the same device.
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my')
  await expect(accountButton(page, PEOPLE.harborNewServer.name)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hello, Ava' })).toBeVisible()
})
