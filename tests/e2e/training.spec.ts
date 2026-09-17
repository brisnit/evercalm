import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * Training, as managers use it: build a course, preview it, publish it,
 * assign it, and see the result after the employee has finished - plus the
 * permission boundaries around it. Desktop only; the employee's own journey
 * runs at phone width in employee-training.spec.ts.
 */

async function fill(page: Page, selector: string, value: string) {
  const field = page.locator(selector)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await field.fill(value)
    try {
      await expect(field).toHaveValue(value, { timeout: 1_000 })
      return
    } catch {
      // Hydration replaced the value; type it again.
    }
  }
  throw new Error(`Could not fill ${selector}`)
}

async function switchTo(page: Page, email: string) {
  await page.context().clearCookies()
  await signIn(page, email)
}

test('a course goes from draft to a finished employee and back to the manager', async ({
  page,
}) => {
  test.setTimeout(150_000)
  const title = `Closing the dish pit ${Date.now().toString(36)}`

  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/training/courses/new')
  await page.waitForLoadState('networkidle')
  await fill(page, '#course-title', title)
  await page.getByRole('button', { name: 'Create course' }).click()
  await page.waitForURL(/\/app\/training\/courses\/[0-9a-f-]{36}$/)
  const courseUrl = page.url()
  await expect(page.getByRole('heading', { name: 'Draft of version 1' })).toBeVisible()

  // A reading lesson.
  await page.waitForLoadState('networkidle')
  await fill(page, '#lesson-title', 'Why the pit closes last')
  await page.locator('#lesson-kind').selectOption('reading')
  await page.getByRole('button', { name: 'Add lesson' }).click()
  await page.waitForURL(/\/lessons\/[0-9a-f-]{36}$/)
  await page.waitForLoadState('networkidle')
  await fill(
    page,
    '#edit-body',
    'Every pan from close comes through the pit, so it closes after the line.',
  )
  await page.getByRole('button', { name: 'Save lesson' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Lesson saved.')

  // A knowledge check with one question.
  await page.goto(courseUrl)
  await page.waitForLoadState('networkidle')
  await fill(page, '#lesson-title', 'Knowledge check')
  await page.locator('#lesson-kind').selectOption('quiz')
  await page.getByRole('button', { name: 'Add lesson' }).click()
  await page.waitForURL(/\/lessons\/[0-9a-f-]{36}$/)
  await page.waitForLoadState('networkidle')
  await fill(
    page,
    '#new-question-prompt',
    'What final rinse temperature sanitizes in a high-temperature machine?',
  )
  await page.getByLabel('Answer 1', { exact: true }).fill('120°F')
  await page.getByLabel('Answer 2', { exact: true }).fill('180°F')
  await page.getByLabel('Answer 2 is correct').check()
  await page.getByRole('button', { name: 'Add question' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Question added.')
  await expect(page.getByRole('heading', { name: 'Questions (1)' })).toBeVisible()

  // Preview, then publish.
  await page.goto(`${courseUrl}/preview`)
  await expect(page.getByRole('heading', { name: 'Why the pit closes last' })).toBeVisible()
  await expect(page.getByText('Correct', { exact: true })).toBeVisible()
  await page.goto(courseUrl)
  await page.getByRole('button', { name: 'Publish version 1' }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Version 1 is published.')
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible()

  // Assign it to Sam at Riverside.
  await page.goto(`${courseUrl}/people`)
  await page.waitForLoadState('networkidle')
  await page.locator('#assign-location').selectOption({ label: 'Riverside' })
  await page.waitForURL(/location=/)
  await page.waitForLoadState('networkidle')
  await page.getByRole('checkbox', { name: /Sam Whitfield/ }).check()
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  await expect(page.getByTestId('action-notice')).toContainText('Assigned version 1 to 1 person.')

  // Sam does it.
  await switchTo(page, PEOPLE.harborEmployee.email)
  await page.goto('/my/training')
  await expect(page.getByRole('heading', { name: 'Why the pit closes last' })).toBeVisible()
  await page.getByRole('link', { name: /^Start/ }).click()
  await page.getByRole('button', { name: 'Mark as done' }).click()
  await expect(page.getByTestId('lesson-moment')).toContainText(
    'Halfway there: 1 of 2 lessons done. Next: Knowledge check.',
  )
  await page.getByTestId('lesson-moment').getByRole('link', { name: 'Next lesson' }).click()
  await page.waitForLoadState('networkidle')
  await page.getByLabel('120°F').check()
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByText(/Not yet: 0 of 1 correct/)).toBeVisible()
  await page.getByLabel('180°F').check()
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByTestId('lesson-moment')).toContainText(`You finished ${title}.`)
  await page.getByRole('link', { name: 'See your finished course' }).click()
  await expect(page.getByText('Course complete')).toBeVisible()

  // Dana sees the result.
  await switchTo(page, PEOPLE.harborOwner.email)
  await page.goto(`${courseUrl}/people`)
  const row = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Sam Whitfield' })
  await expect(row.getByText('Completed', { exact: true })).toBeVisible()
  await expect(row.getByText(/Best knowledge check 100%/)).toBeVisible()
})

test('content, scope and sign-off permissions hold in the browser', async ({ page }) => {
  // A location manager cannot author, and does not see drafts.
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/training')
  const draftHref = await page
    .getByRole('link', { name: 'Wine service fundamentals' })
    .getAttribute('href')

  await switchTo(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/training')
  await expect(page.getByRole('link', { name: 'New course' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Wine service fundamentals' })).toHaveCount(0)
  expect((await page.goto(draftHref!))?.status()).toBe(404)
  await page.goto('/app/training/courses/new')
  await expect(page.getByRole('heading', { name: 'You do not have access to this' })).toBeVisible()

  // An employee has no training administration, and nobody else's training.
  await switchTo(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/training')
  const avaCourse = await page.locator('a[href^="/my/training/"]').first().getAttribute('href')
  await switchTo(page, PEOPLE.harborEmployee.email)
  await page.goto('/app/training')
  await expect(page).toHaveURL(/\/my$/)
  expect((await page.goto(avaCourse!))?.status()).toBe(404)
})

test('a manager signs off a practical at their own location only', async ({ page }) => {
  await signIn(page, PEOPLE.salonGmBench.email)
  await page.goto('/app/training/sign-offs')
  await expect(page.getByText('Priyanka Shah')).toHaveCount(0)

  await switchTo(page, PEOPLE.salonGmPearl.email)
  await page.goto('/app/training/sign-offs')
  const card = page.getByRole('article').filter({ hasText: 'Priyanka Shah' })
  await expect(
    card.getByRole('heading', { name: 'Consultation observed by an educator' }),
  ).toBeVisible()
  await page.waitForLoadState('networkidle')

  // Sending back still needs a note, and sits behind its own disclosure.
  await card.getByRole('button', { name: 'Not ready? Send it back to practise' }).click()
  await card.getByRole('button', { name: 'Send back to practise' }).click()
  await expect(card.getByRole('alert')).toContainText('Add a note saying what to practise.')

  // The criteria are there to review, not to tick: one deliberate approval.
  await expect(card.getByRole('heading', { name: 'What to look for' })).toBeVisible()
  await expect(card.getByRole('checkbox')).toHaveCount(0)
  await card.getByRole('button', { name: 'Approve sign-off' }).click()
  await expect(page.getByTestId('action-notice')).toContainText(
    'Signed off for Priyanka Shah. That completes their course.',
  )
  // Other requests may be waiting too; Priyanka's is decided and gone.
  await expect(page.getByRole('article').filter({ hasText: 'Priyanka Shah' })).toHaveCount(0)
})
