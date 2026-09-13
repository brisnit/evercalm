import { expect, test } from '@playwright/test'
import {
  PEOPLE,
  draftAnnouncementTo,
  expectNoConsoleErrors,
  signIn,
  trackConsoleErrors,
} from './helpers'
import {
  announcementIdByTitle,
  closeDb,
  deliveryState,
  makeScheduleDue,
  wallClockFromNow,
  workerIsRunning,
} from './db'

/**
 * Scheduled publishing, end to end, with the real background worker.
 *
 * A manager schedules through the interface. The test then moves only the
 * clock - it never calls publish - and waits for the worker that `npm run dev`
 * started to find the announcement, publish it, create the recipient once,
 * and deliver the notifications.
 */

test.afterAll(closeDb)

test('a scheduled announcement goes out on its own, and the author is told clearly', async ({
  page,
}) => {
  test.setTimeout(90_000)
  expect(
    workerIsRunning(),
    'The background worker is not running. Start the app with `npm run dev`, which runs it, or run `npm run worker` alongside.',
  ).toBe(true)

  const errors = trackConsoleErrors(page)
  const title = `Scheduled rota change ${Date.now().toString().slice(-6)}`

  await draftAnnouncementTo(page, {
    authorEmail: PEOPLE.harborHr.email,
    recipientName: PEOPLE.harborEmployee.name,
    title,
    requiresAcknowledgement: true,
  })

  // --- schedule it, in the organization's own timezone -------------------
  const sendAt = await wallClockFromNow('harbor-vine', 24 * 60)
  await expect(page.getByText(/^In America\/.+ time\./)).toBeVisible()
  await page.getByLabel('Send at').fill(sendAt)
  await page.getByRole('button', { name: 'Schedule it' }).click()

  const notice = page.getByTestId('action-notice')
  await expect(notice).toContainText(/Scheduled for .+\. It will go out automatically\./)
  await expect(page.getByText('Scheduled', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/^Goes out .+, automatically\.$/)).toBeVisible()

  // The confirmation stays after the schedule form it came from has gone.
  await page.waitForTimeout(3_000)
  await expect(notice).toBeVisible()
  await notice.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByTestId('action-notice')).toHaveCount(0)

  // Nothing has gone anywhere yet.
  const id = await announcementIdByTitle(title)
  expect(await deliveryState(id)).toEqual({ recipients: 0, notifications: [] })

  // --- the time arrives; nobody presses anything -------------------------
  await makeScheduleDue(id)

  await expect(async () => {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 30_000 })
  // A reload after publication is a later visit: no stale confirmation.
  await expect(page.getByTestId('action-notice')).toHaveCount(0)

  await expect(async () => {
    expect(await deliveryState(id)).toEqual({
      recipients: 1,
      notifications: [
        { channel: 'email', status: 'sent' },
        { channel: 'in_app', status: 'sent' },
      ],
    })
  }).toPass({ timeout: 30_000 })

  // Still exactly once after the worker has ticked several more times.
  await page.waitForTimeout(3_000)
  expect((await deliveryState(id)).recipients).toBe(1)
  expect((await deliveryState(id)).notifications).toHaveLength(2)

  expectNoConsoleErrors(errors)

  // --- and it is in the employee's inbox, waiting for confirmation --------
  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/my/inbox?filter=acknowledge')
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible()
})
