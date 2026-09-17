import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * The employee's scheduling screens, on a desktop and on a phone.
 *
 * Runs in both Playwright projects, so each assertion here holds at phone
 * width too. Written to be repeatable: the second project finds the state the
 * first one left and still passes.
 */

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(viewport + 1)
}

test('the schedule screens are readable and do not scroll sideways', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)

  await page.goto('/my')
  await expect(page.getByRole('heading', { name: 'Your schedule' })).toBeVisible()

  await page.goto('/my/schedule')
  await expect(page.getByRole('heading', { name: 'Your schedule', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open shifts', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Schedule' })).toBeVisible()
  await expectNoSidewaysScroll(page)

  const shift = page.locator('a[href^="/my/schedule/shifts/"]').first()
  if ((await shift.count()) > 0) {
    await shift.click()
    await expect(page.getByText('Paid time')).toBeVisible()
    await expectNoSidewaysScroll(page)
  }

  await page.goto('/my/time-off')
  await expect(page.getByRole('heading', { name: 'Ask for time off' })).toBeVisible()
  await expectNoSidewaysScroll(page)
  // Regression: "Last day" ran past the edge of its card on a phone.
  const form = page.locator('form').filter({ has: page.getByLabel('First day') })
  const formBox = (await form.boundingBox())!
  for (const label of ['First day', 'Last day']) {
    const box = (await page.getByLabel(label).boundingBox())!
    expect(box.x, `${label} starts inside the form`).toBeGreaterThanOrEqual(formBox.x - 0.5)
    expect(box.x + box.width, `${label} ends inside the form`).toBeLessThanOrEqual(
      formBox.x + formBox.width + 0.5,
    )
  }

  await page.goto('/my/availability')
  await expect(page.getByRole('heading', { name: 'Every week' })).toBeVisible()
  await expectNoSidewaysScroll(page)
})

test('weekly availability is saved and shown again', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/my/availability')

  // Regression: a window starting at midnight is shown as midnight, so saving
  // the form cannot quietly move it to a default time.
  await expect(page.getByLabel('Wednesday availability')).toHaveValue('unavailable')
  await expect(page.locator('#d3-start')).toHaveValue('00:00')
  await expect(page.locator('#d3-end')).toHaveValue('12:00')

  await page.getByLabel('Friday availability').selectOption('unavailable')
  await page.getByRole('button', { name: 'Save weekly availability' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Availability saved.')

  await page.reload()
  await expect(page.getByLabel('Friday availability')).toHaveValue('unavailable')
})

test('someone else’s shift is not found', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  const response = await page.goto('/my/schedule/shifts/00000000-0000-4000-8000-000000000000')
  expect(response?.status()).toBe(404)
})
