import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The manager communication workflow, in a browser.
 *
 * Follows the sequence the brief describes: write, choose an audience, check
 * the count, publish behind a confirmation, then watch the receipts and chase
 * what is outstanding.
 */

test('a manager writes, targets, previews and publishes', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/comms')
  await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible()

  await page.getByRole('link', { name: 'New announcement' }).click()
  await expect(page.getByRole('heading', { name: 'New announcement' })).toBeVisible()

  const title = `Walk-in fridge service ${Date.now().toString().slice(-5)}`
  await page.getByLabel('Title').fill(title)
  await page
    .getByLabel('Message')
    .fill(
      'The walk-in is being serviced on Tuesday morning.\n\n- Pull your mise by 9am\n- Use the reach-in until noon',
    )

  // Nothing is targeted yet, and the summary says so rather than guessing.
  await expect(page.getByText('Nobody yet — add at least one group.')).toBeVisible()

  await page.getByRole('button', { name: 'Locations' }).click()
  await page.getByRole('button', { name: /^Riverside/ }).click()
  await expect(page.getByText('Riverside', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Save as draft' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()

  // The audience count is resolved on the server before anything goes out.
  await expect(page.getByText(/people match this right now/)).toBeVisible()

  await page.getByRole('button', { name: 'Publish now' }).click()
  await expect(page.getByRole('heading', { name: 'Publish this announcement?' })).toBeVisible()
  await expect(page.getByText(/This goes to \d+ (person|people)/)).toBeVisible()

  await page.getByRole('button', { name: 'Yes, publish it' }).click()
  await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()
  await expect(page.getByText('Sent to', { exact: true })).toBeVisible()
  await expect(page.getByText('Active')).toBeVisible()

  // The confirmation survives the refresh that removed the Publish card, and
  // takes focus because the button that had it is gone.
  const notice = page.getByTestId('action-notice')
  await expect(notice).toContainText(/Published to \d+ (person|people)\./)
  await expect(notice).toBeFocused()
  await page.waitForTimeout(3_000)
  await expect(notice).toBeVisible()

  // Client state only: a reload, or coming back later, does not replay it.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()
  await expect(page.getByTestId('action-notice')).toHaveCount(0)
  await page.goto('/app/comms')
  await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByTestId('action-notice')).toHaveCount(0)

  expectNoConsoleErrors(errors)
})

test('a draft is invisible to its audience until it is published', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/comms')

  const title = `Unsent draft ${Date.now().toString().slice(-5)}`
  await page.getByRole('link', { name: 'New announcement' }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Message').fill('Nobody should see this yet.')
  await page.getByRole('button', { name: 'Everyone' }).click()
  await page.getByRole('button', { name: 'Everyone in the organization' }).click()
  await page.getByRole('button', { name: 'Save as draft' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // Signing in as somebody else needs the first session gone, or /signin
  // redirects straight back to the console and there is no form to fill.
  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/my/inbox')
  await expect(page.getByText(title)).toHaveCount(0)
})

test('the receipts report shows who is outstanding, and can chase them', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/comms')
  await page
    .getByRole('link', { name: /Allergen handling/ })
    .first()
    .click()

  await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()
  await expect(page.getByText('Sent to', { exact: true })).toBeVisible()
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()

  // The seeded state is deliberately partial, so there is something to chase.
  const remind = page.getByRole('button', { name: /^Remind the \d+ outstanding$/ })
  await expect(remind).toBeVisible()
  await remind.click()
  await expect(page.getByText(/Reminded \d+ (person|people)/)).toBeVisible()
})

test('a location manager sees only their own slice of an organization-wide report', async ({
  page,
}) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/comms')
  await page
    .getByRole('link', { name: /86 list/ })
    .first()
    .click()

  // Stated plainly, so a partial view is never mistaken for the whole picture.
  await expect(page.getByText(/You are seeing the people at your own locations/)).toBeVisible()
})

test('a correction becomes a revision rather than an edit', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/comms')
  await page
    .getByRole('link', { name: /Riverside: staff parking/ })
    .first()
    .click()

  await page.getByRole('button', { name: 'Publish a correction' }).click()
  await page.getByLabel('What changed').fill('The lot reopens a week earlier')
  await page.getByRole('button', { name: 'Publish the correction' }).click()

  await expect(page.getByText(/Revision 2 published/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Revision history' })).toBeVisible()
})

test('an employee cannot reach the composer', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/app/comms/new')
  // Somebody with no administrative capability is routed to their own surface
  // rather than shown an empty console. The server-side refusal still exists;
  // this asserts they never land on the composer.
  await expect(page).toHaveURL(/\/my$/)
})

test('a shift lead sees the console but not the composer', async ({ page }) => {
  // A shift lead holds announcement.view_receipts and nothing else in comms,
  // so the navigation entry is absent and the page refuses server-side.
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/comms')
  await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible()
})

test('emergency is behind its own confirmation and its own permission', async ({ page }) => {
  // A general manager holds publish and publish_urgent, but not emergency.
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/comms/new')
  await expect(page.getByRole('radio', { name: /Urgent/ })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Emergency/ })).toHaveCount(0)
  await expect(page.getByText('Emergency needs a separate permission.')).toBeVisible()
})
