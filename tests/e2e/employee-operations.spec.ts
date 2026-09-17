import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The employee's shift workspace, on a desktop and on a phone.
 *
 * The two projects work on different people (Sam on desktop, Ava on the
 * phone), and every action is undone before the test ends, so the projects
 * never race on the same task and a second run finds what the first found.
 */

function person() {
  return test.info().project.name === 'mobile'
    ? { email: PEOPLE.harborNewServer.email }
    : { email: PEOPLE.harborEmployee.email }
}

async function openWorkspace(page: Page) {
  await signIn(page, person().email)
  await page.goto('/my/shift')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(viewport + 1)
}

const card = (page: Page, title: string) => page.getByRole('article', { name: title, exact: true })

test('the home screen leads to the shift in front of you', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, person().email)
  await page.goto('/my')
  const summary = page.getByTestId('shift-work-card')
  await expect(summary.getByText('On now')).toBeVisible()
  await summary.click()
  await expect(page).toHaveURL(/\/my\/shift\?shift=/)
  await expect(page.getByRole('heading', { name: /During your shift/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'From earlier shifts' })).toBeVisible()
  expectNoConsoleErrors(errors)
})

test('marking a task done, and undoing it', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await openWorkspace(page)
  const title = 'Roll silverware for tomorrow (100 sets)'
  await card(page, title).getByRole('button', { name: 'Mark done' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Done.')

  await page.getByRole('button', { name: /^Finished/ }).click()
  const finished = card(page, title)
  await expect(finished.getByText('Done', { exact: true })).toBeVisible()
  await expect(finished.getByText(/Done by you at/)).toBeVisible()
  await finished.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Undone')
  await expect(card(page, title).getByRole('button', { name: 'Mark done' })).toBeVisible()
  expectNoConsoleErrors(errors)
})

test('skipping asks why, and the reason is kept', async ({ page }) => {
  await openWorkspace(page)
  const title = 'Wipe down and sanitize menus'
  const task = card(page, title)
  await task.getByRole('button', { name: 'Can’t do it?' }).click()
  const reason = task.getByLabel('Why it’s being skipped')
  await task.getByRole('button', { name: 'Skip this task' }).click()
  // The browser refuses an empty reason before anything is sent.
  await expect(reason).toHaveJSProperty('validity.valueMissing', true)
  await reason.fill('Menus went out for reprinting this afternoon.')
  await task.getByRole('button', { name: 'Skip this task' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Skipped')

  await page.getByRole('button', { name: /^Finished/ }).click()
  const skipped = card(page, title)
  await expect(
    skipped.getByText('Reason: Menus went out for reprinting this afternoon.'),
  ).toBeVisible()
  await skipped.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Undone')
})

test('leaving a handoff for the next shift', async ({ page }) => {
  await openWorkspace(page)
  const title = `Ice machine slow to refill ${Math.random().toString(36).slice(2, 6)}`
  await page.getByRole('button', { name: 'Leave a handoff for the next shift' }).click()
  const form = page.locator('section[aria-labelledby="leave-handoff"]')
  // Just two things to fill in: the task, and who it is for.
  await expect(form.getByLabel('What is it about')).toHaveCount(0)
  await form.getByLabel('Task').fill(title)
  await expect(form.getByLabel('Assigned to')).toHaveValue('')
  await form.getByRole('button', { name: 'Leave handoff' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Handoff saved')
  await expect(page.getByRole('article', { name: `Handoff: ${title}` })).toBeVisible()
})

test('a handoff assigned to someone waits on their home until they have read it', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const assignee =
    test.info().project.name === 'mobile' ? PEOPLE.harborNewServer : PEOPLE.harborEmployee
  const title = `Restock the host stand menus ${Math.random().toString(36).slice(2, 6)}`

  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/operations/handoffs')
  await page.getByLabel('Task').fill(title)
  // Only people who work at this location are offered.
  const options = await page.getByLabel('Assigned to').locator('option').allTextContents()
  expect(options[0]).toBe('Whoever is on next')
  expect(options).toContain(assignee.name)
  expect(options).not.toContain(PEOPLE.salonOwner.name)
  await page.getByLabel('Assigned to').selectOption({ label: assignee.name })
  await page.getByRole('button', { name: 'Leave handoff' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Handoff saved')
  const managerCard = page.getByRole('article', { name: `Handoff: ${title}` })
  await expect(managerCard.getByText(`For ${assignee.name}`)).toBeVisible()

  await page.context().clearCookies()
  await signIn(page, assignee.email)
  await page.goto('/my')
  const handed = page.getByTestId('handed-to-you')
  const mine = handed.getByRole('article', { name: `Handoff: ${title}` })
  await expect(mine).toBeVisible()
  await expect(mine.getByText('For you')).toBeVisible()
  await expectNoSidewaysScroll(page)

  // It leads the handoffs on their shift too.
  await page.goto('/my/shift')
  await expect(page.getByRole('article', { name: `Handoff: ${title}` })).toBeVisible()

  await page.goto('/my')
  await mine.getByRole('button', { name: 'I’ve read this' }).click()
  await expect(page.getByRole('article', { name: `Handoff: ${title}` })).toHaveCount(0)
})

test('someone else’s shift is not found', async ({ page }) => {
  await signIn(page, person().email)
  const response = await page.goto('/my/shift?shift=00000000-0000-4000-8000-000000000000')
  expect(response?.status()).toBe(404)
})
