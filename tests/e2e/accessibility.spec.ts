import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * WCAG 2.2 AA scanning on every screen.
 *
 * Runs at desktop and phone width. Any violation fails the build.
 *
 * Screens that only exist part-way through a flow - the template builder, each
 * step of the import wizard - are driven to that state and scanned there,
 * because scanning only the entry point would miss exactly the states where
 * the markup gets complicated.
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
  for (const path of [
    '/app',
    '/app/setup',
    '/app/people',
    '/app/people/invite',
    '/app/people/invitations',
    '/app/onboarding',
    '/app/onboarding/templates',
    '/app/people/import',
    '/app/comms',
    '/app/comms/new',
    '/app/settings',
    '/app/settings/structure',
    '/app/settings/values',
    '/app/settings/audit',
  ]) {
    await page.goto(path)
    const results = await scan(page)
    expect(
      results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`),
      `Violations on ${path}`,
    ).toEqual([])
  }
})

test('scheduling screens have no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  for (const path of [
    '/app/schedule',
    '/app/schedule/requests',
    '/app/schedule/availability',
    '/app/schedule/templates',
  ]) {
    await page.goto(path)
    const results = await scan(page)
    expect(
      results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`),
      `Violations on ${path}`,
    ).toEqual([])
  }

  // A shift's own page, where the candidate list and conflicts are.
  await page.goto('/app/schedule')
  await page.locator('a[href^="/app/schedule/shifts/"]').first().click()
  await expect(page.getByRole('heading', { name: 'Who is on it' })).toBeVisible()
  const detail = await scan(page)
  expect(detail.violations.map((v) => `shift -> ${v.id}: ${v.help}`)).toEqual([])
})

test('the employee schedule has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  for (const path of ['/my/schedule', '/my/time-off', '/my/availability']) {
    await page.goto(path)
    const results = await scan(page)
    expect(
      results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`),
      `Violations on ${path}`,
    ).toEqual([])
  }
  const shift = page.locator('a[href^="/my/schedule/shifts/"]').first()
  await page.goto('/my/schedule')
  if ((await shift.count()) > 0) {
    await shift.click()
    await expect(page.getByText('Paid time')).toBeVisible()
    const detail = await scan(page)
    expect(detail.violations.map((v) => `my shift -> ${v.id}: ${v.help}`)).toEqual([])
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

test('the employee onboarding screen has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.getByRole('link', { name: 'Open your onboarding' }).click()
  await expect(page).toHaveURL(/\/my\/onboarding$/)
  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('an employee profile with management panels has no accessibility violations', async ({
  page,
}) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/people')
  await page.getByRole('link', { name: /Ava Lindqvist/ }).click()
  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the invitation acceptance screen has no accessibility violations', async ({ page }) => {
  await page.context().clearCookies()
  await page.goto(`/invite/${'z'.repeat(43)}`)
  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the permission-denied screen has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/settings/audit')
  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the onboarding template builder has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')

  // A fresh draft, because the seeded templates are published and therefore
  // read-only - which would scan the simpler of the two states.
  const name = `Accessible ${Date.now().toString().slice(-6)}`
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()

  // The builder's most complex state has the add-step form open, so open it
  // and scan the editable form rather than the collapsed shell.
  await page
    .getByText(/^Add a step to/)
    .first()
    .click()
  await expect(page.getByRole('textbox', { name: /^Step\b/ })).toBeVisible()

  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the onboarding template preview has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')
  await page.getByRole('link', { name: 'New Server Onboarding' }).click()
  await page.getByRole('link', { name: /^Preview/ }).click()
  await expect(page.getByRole('heading', { name: 'What a new hire sees' })).toBeVisible()

  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the import preview and its error report have no accessibility violations', async ({
  page,
}) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/people/import')

  // A file with one good row and two bad ones, so the scan covers the review
  // table, the row-level messages, and the confirmation controls together.
  await page.setInputFiles('#import-file', {
    name: 'people.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'Full name,Email,Job title',
        'Wren Adeyemi,wren.adeyemi@example.test,Server',
        'B,not-an-email,Server',
        'Duplicate,wren.adeyemi@example.test,Server',
      ].join('\n'),
      'utf8',
    ),
  })
  await page.getByRole('button', { name: 'Read the file' }).click()
  await expect(page.getByRole('heading', { name: '3. Review every row' })).toBeVisible()

  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the employee inbox has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/inbox')
  await expect(page.getByRole('heading', { name: 'Your inbox' })).toBeVisible()

  const list = await scan(page)
  expect(list.violations.map((v) => `inbox -> ${v.id}: ${v.help}`)).toEqual([])

  // The detail view is where the interesting markup is. Any message will do -
  // this must not depend on one that an earlier project already confirmed.
  // Scoped to the page's content: the header navigation is a list of links too.
  await page.getByRole('main').getByRole('listitem').first().getByRole('link').first().click()
  await expect(page).toHaveURL(/\/my\/inbox\/[0-9a-f-]{36}$/)
  const detail = await scan(page)
  expect(detail.violations.map((v) => `message -> ${v.id}: ${v.help}`)).toEqual([])
})

test('notification preferences have no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/notifications')
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()

  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the announcement composer has no accessibility violations with its pickers open', async ({
  page,
}) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/comms/new')

  // Open a disclosure so the scan covers the expanded state, not the shell.
  await page.getByRole('button', { name: /^Locations/ }).click()
  await expect(page.getByRole('button', { name: /^Riverside/ })).toBeVisible()

  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the receipt report has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/comms')
  await page
    .getByRole('link', { name: /Allergen handling/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()

  const results = await scan(page)
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('training administration has no accessibility violations', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/training')
  const course = await page
    .getByRole('link', { name: 'Allergen awareness for service' })
    .getAttribute('href')
  const draft = await page
    .getByRole('link', { name: 'Wine service fundamentals' })
    .getAttribute('href')
  await page.goto(draft!)
  const lesson = await page
    .getByRole('link', { name: /^Edit / })
    .first()
    .getAttribute('href')
  for (const path of [
    '/app/training',
    '/app/training/courses/new',
    course!,
    `${course}/people`,
    `${course}/preview`,
    draft!,
    lesson!,
    '/app/training/progress',
    '/app/training/sign-offs',
  ]) {
    await page.goto(path)
    const results = await scan(page)
    expect(
      results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`),
      `Violations on ${path}`,
    ).toEqual([])
  }
})

test('the employee training screens have no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.salonMassage.email)
  await page.goto('/my/training')
  const course = await page.locator('a[href^="/my/training/"]').first().getAttribute('href')
  await page.goto(course!)
  const lessons = await page
    .locator('a[href*="/lessons/"]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href')!))
  for (const path of ['/my/training', course!, ...lessons]) {
    await page.goto(path)
    const results = await scan(page)
    expect(
      results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`),
      `Violations on ${path}`,
    ).toEqual([])
  }
})

test('linked onboarding training has no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.salonOwner.email)
  await page.goto('/app/onboarding/templates')
  await page.getByRole('link', { name: 'New Stylist Onboarding' }).click()
  // The other project may already have started a draft; either way, edit it.
  const startDraft = page.getByRole('button', { name: 'Start a new draft' })
  await expect(
    startDraft.or(page.getByText('Add a step to', { exact: false }).first()),
  ).toBeVisible()
  if (await startDraft.isVisible()) await startDraft.click()
  await page.getByText('Add a step to', { exact: false }).first().click()
  await page
    .getByRole('combobox', { name: /Step type/ })
    .first()
    .selectOption('training_assignment')
  await expect(page.getByRole('combobox', { name: /^Course/ }).first()).toBeVisible()
  const builder = await scan(page)
  expect(builder.violations.map((v) => `builder -> ${v.id}: ${v.help}`)).toEqual([])

  await page.goto(`${page.url()}/preview`)
  const preview = await scan(page)
  expect(preview.violations.map((v) => `preview -> ${v.id}: ${v.help}`)).toEqual([])

  await page.context().clearCookies()
  await signIn(page, PEOPLE.salonNewStylist.email)
  await page.goto('/my/onboarding')
  const employee = await scan(page)
  expect(employee.violations.map((v) => `my onboarding -> ${v.id}: ${v.help}`)).toEqual([])
})

test('shift operations screens have no accessibility violations', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/operations/templates')
  const template = await page.getByRole('link', { name: 'Server side work' }).getAttribute('href')
  for (const path of [
    '/app/operations',
    '/app/operations/handoffs',
    '/app/operations/templates',
    template!,
  ]) {
    await page.goto(path)
    const results = await scan(page)
    expect(
      results.violations.map((v) => `${path} -> ${v.id}: ${v.help}`),
      `Violations on ${path}`,
    ).toEqual([])
  }

  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/my/shift')
  // Open the parts that start closed, so what they hold is scanned too.
  await page.getByRole('button', { name: /^Finished/ }).click()
  await page.getByRole('button', { name: 'Leave a handoff for the next shift' }).click()
  const results = await scan(page)
  expect(results.violations.map((v) => `/my/shift -> ${v.id}: ${v.help}`)).toEqual([])
})
