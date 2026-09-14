import { expect, test, type Locator, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * Scheduling, manager to employee, in a browser.
 *
 * The journeys in the order the work happens: build a week from a template
 * and publish it; change it after publication and see that employees are told
 * only when the change is published; resolve a conflict that blocks
 * publishing; and the three requests that come back from the team - time off,
 * an open shift, and a swap - each decided by a manager and seen by the
 * employee.
 *
 * Serial, because each journey hands state to the next person in it. The
 * database is reseeded before every run (global-setup), and every journey works
 * in its own week so none depends on another's leftovers.
 */

test.describe.configure({ mode: 'serial' })

const LA = 'America/Los_Angeles'

/** The Monday `weeks` weeks from this one, as Los Angeles sees it. */
function weekStart(weeks: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: LA }).format(new Date())
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  const monday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - monday + 7 * weeks)
  return date.toISOString().slice(0, 10)
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** "Tue, Nov 3" - how the product labels a calendar date. */
function dateLabel(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${isoDate}T12:00:00Z`))
}

async function as(page: Page, email: string) {
  await page.context().clearCookies()
  await signIn(page, email)
}

const notice = (page: Page) => page.getByTestId('action-notice')

/**
 * Fill a field and make sure the value survives hydration. A value typed into
 * server-rendered markup before React attaches is reset when it does - the
 * same reason tests/e2e/helpers.ts retries sign-in fields.
 */
async function fillStable(locator: Locator, value: string) {
  await expect(async () => {
    await locator.fill(value)
    await expect(locator).toHaveValue(value, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

const MANAGER = PEOPLE.harborGmRiverside.email
const SAM = PEOPLE.harborEmployee.email
const CAMILLE = 'camille@harborvine.test'
const AVA = PEOPLE.harborNewServer.email

test('a manager builds a week from a template, publishes it, and the employee sees it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const week = weekStart(6)
  await as(page, MANAGER)
  await page.goto(`/app/schedule?week=${week}`)
  await expect(page.getByRole('heading', { name: `Week of ${dateLabel(week)}` })).toBeVisible()
  await expect(page.getByText('Nothing scheduled this week')).toBeVisible()

  // Add Wednesday's dinner shift from the template, for Sam.
  await page.getByLabel('Template').selectOption({ label: 'Dinner service (16:00–22:30)' })
  await page.locator('#add-date').selectOption(addDays(week, 2))
  const sam = await page
    .locator('#add-assignee')
    .locator('option', { hasText: 'Sam Whitfield' })
    .getAttribute('value')
  await page.locator('#add-assignee').selectOption(sam ?? '')
  await page.getByRole('button', { name: 'Add shift', exact: true }).click()
  await expect(page.getByText('Shift added.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Sam Whitfield/ })).toBeVisible()

  // Not visible to Sam while it is a draft.
  await as(page, SAM)
  await page.goto(`/my/schedule?week=${week}`)
  await expect(page.getByText('No shifts published for you')).toBeVisible()

  // Publish, with the confirmation naming who is told.
  await as(page, MANAGER)
  await page.goto(`/app/schedule?week=${week}`)
  await page.getByRole('button', { name: 'Publish this week' }).click()
  await expect(page.getByRole('heading', { name: 'Publish this week?' })).toBeVisible()
  await expect(page.getByText(/^Added: /)).toBeVisible()
  await page.getByRole('button', { name: 'Yes, publish' }).click()
  await expect(notice(page)).toContainText('Published.')
  await expect(page.getByText('Published', { exact: true })).toBeVisible()

  await as(page, SAM)
  await page.goto(`/my/schedule?week=${week}`)
  await expect(page.getByRole('link', { name: /4:00\sPM – 10:30\sPM/ })).toBeVisible()
})

test('a change after publication stays invisible until it is published', async ({ page }) => {
  test.setTimeout(120_000)
  const week = weekStart(6)
  await as(page, MANAGER)
  await page.goto(`/app/schedule?week=${week}`)
  await page.getByRole('link', { name: /Sam Whitfield/ }).click()
  await expect(page.getByRole('heading', { name: 'Who is on it' })).toBeVisible()
  // Let the page settle: a late re-render would put the field back to its saved value.
  await page.waitForLoadState('networkidle')
  await fillStable(page.getByLabel('Starts'), '17:00')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(notice(page)).toContainText('Shift updated.')
  // The page itself now reads the new time, so the edit really moved the shift.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/5:00\sPM/)

  await as(page, SAM)
  await page.goto(`/my/schedule?week=${week}`)
  await expect(page.getByRole('link', { name: /4:00\sPM – 10:30\sPM/ })).toBeVisible()

  await as(page, MANAGER)
  await page.goto(`/app/schedule?week=${week}`)
  await expect(page.getByText('Changes not published')).toBeVisible()
  await page.getByRole('button', { name: 'Publish changes' }).click()
  await expect(page.getByText(/Changed: .* is now .*5:00\sPM/)).toBeVisible()
  await page.getByRole('button', { name: 'Yes, publish' }).click()
  await expect(notice(page)).toContainText('Changes published.')

  await as(page, SAM)
  await page.goto(`/my/schedule?week=${week}`)
  await expect(page.getByRole('link', { name: /5:00\sPM – 10:30\sPM/ })).toBeVisible()
})

test('a blocking conflict stops publication until it is resolved', async ({ page }) => {
  test.setTimeout(120_000)
  // The seeded draft two weeks out has Camille on a shift during approved time off.
  await as(page, MANAGER)
  await page.goto(`/app/schedule?week=${weekStart(2)}`)
  await expect(page.getByText(/needs? fixing before\s+this can be published/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish this week' })).toHaveCount(0)

  await page
    .getByRole('link', { name: /5:00\sPM – 1:00\sAM/ })
    .filter({ hasText: 'Camille' })
    .first()
    .click()
  await expect(
    page.getByText('Camille Fontaine has approved time off during this shift.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Remove them from this shift' }).click()
  await expect(notice(page)).toContainText('Nobody is assigned now.')

  await page.getByRole('link', { name: /week of/ }).click()
  await expect(page.getByText(/needs? fixing before/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publish this week' })).toBeVisible()
})

test('time off: requested by the employee, decided by a manager, seen by the employee', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const day = addDays(weekStart(9), 3)
  await as(page, SAM)
  await page.goto('/my/time-off')
  await fillStable(page.getByLabel('First day'), day)
  await page.getByLabel('Reason').selectOption('vacation')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(notice(page)).toContainText('Request sent.')
  const mine = page.getByRole('listitem').filter({ hasText: dateLabel(day) })
  await expect(mine.getByText('Waiting for a decision')).toBeVisible()

  await as(page, MANAGER)
  await page.goto('/app/schedule/requests')
  const request = page
    .getByRole('listitem')
    .filter({ hasText: 'Sam Whitfield' })
    .filter({ hasText: dateLabel(day) })
  await fillStable(request.getByLabel('Note to them (optional)'), 'Enjoy it.')
  await request.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(notice(page)).toContainText('Time off approved.')

  await as(page, SAM)
  await page.goto('/my/time-off')
  const decided = page.getByRole('listitem').filter({ hasText: dateLabel(day) })
  await expect(decided.getByText('Approved', { exact: true })).toBeVisible()
  await expect(decided.getByText(/Enjoy it\./)).toBeVisible()
})

test('an open shift: an employee asks, a manager gives it, the employee has it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const week = weekStart(1)
  await as(page, AVA)
  await page.goto('/my/schedule')
  const open = page.locator('#open-shifts')
  await open.getByRole('button', { name: 'Ask for this shift' }).first().click()
  await expect(notice(page)).toContainText('Request sent.')

  await as(page, MANAGER)
  await page.goto('/app/schedule/requests')
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Ava Lindqvist' })
    .getByRole('button', { name: 'Give it to them' })
    .click()
  await expect(notice(page)).toContainText('The shift is theirs.')

  await as(page, AVA)
  await page.goto(`/my/schedule?week=${week}`)
  await expect(page.getByText('It’s yours')).toBeVisible()
})

test('a swap: asked by one employee, accepted by the colleague, approved by a manager', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const week = weekStart(1)
  await as(page, SAM)
  await page.goto(`/my/schedule?week=${week}`)
  await page
    .locator('a[href^="/my/schedule/shifts/"]')
    .filter({ hasText: /4:00\sPM/ })
    .first()
    .click()
  await page.getByLabel('Colleague').selectOption({ label: 'Camille Fontaine' })
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(notice(page)).toContainText('Request sent.')
  await expect(page.getByText('Waiting for Camille Fontaine to answer.')).toBeVisible()

  await as(page, CAMILLE)
  await page.goto('/my/schedule')
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible()
  await page
    .getByRole('button', { name: /I.ll take it/ })
    .first()
    .click()
  await expect(notice(page)).toContainText('You agreed.')

  await as(page, MANAGER)
  await page.goto('/app/schedule/requests')
  const swap = page
    .getByRole('listitem')
    .filter({ hasText: 'Camille Fontaine would take Sam Whitfield' })
  await swap.getByRole('button', { name: 'Approve swap' }).click()
  await expect(notice(page)).toContainText('Swap approved.')

  await as(page, CAMILLE)
  await page.goto(`/my/schedule?week=${week}`)
  await expect(page.getByRole('link', { name: /Server Station B/ }).first()).toBeVisible()
})

test('each manager reaches only their own location, and each tenant only its own', async ({
  page,
}) => {
  await as(page, MANAGER)
  await page.goto(`/app/schedule?week=${weekStart(1)}`)
  const riversideShift = await page
    .locator('a[href^="/app/schedule/shifts/"]')
    .first()
    .getAttribute('href')

  await as(page, 'tess@harborvine.test')
  const denied = await page.goto(riversideShift!)
  expect(denied?.status()).toBe(404)

  await as(page, 'kofi@lumensalon.test')
  const otherTenant = await page.goto(riversideShift!)
  expect(otherTenant?.status()).toBe(404)
})

test('the salon schedules in its own words', async ({ page }) => {
  await as(page, 'kofi@lumensalon.test')
  await page.goto(`/app/schedule?week=${weekStart(1)}`)
  await expect(page.getByRole('link', { name: /Colour Bar/ }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Chair 1/ }).first()).toBeVisible()
  await expect(page.getByText(/Server|Bar close|Grill/)).toHaveCount(0)
})

test('an employee without scheduling permission cannot reach the manager screens', async ({
  page,
}) => {
  await as(page, SAM)
  await page.goto('/app/schedule')
  await expect(page).toHaveURL(/\/my$/)
})
