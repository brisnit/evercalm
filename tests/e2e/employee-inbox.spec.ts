import { expect, test } from '@playwright/test'
import {
  PEOPLE,
  expectNoConsoleErrors,
  publishAnnouncementTo,
  signIn,
  trackConsoleErrors,
} from './helpers'

/**
 * The employee inbox.
 *
 * The promise being tested: what needs me is first, reading is not confirming,
 * and confirming takes a deliberate press.
 *
 * Tests that consume a one-shot state PUBLISH THEIR OWN announcement rather
 * than sharing a seeded one. This spec runs in both browser projects, and the
 * first run would otherwise acknowledge the seeded message and leave the
 * second with nothing outstanding - a failure that looks like a bug and is
 * really just run order.
 */

/** A title unique to this run, so a repeated run never collides. */
function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`
}

test('what needs confirming is surfaced on the home screen', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await publishAnnouncementTo(page, {
    authorEmail: PEOPLE.harborHr.email,
    recipientName: PEOPLE.harborEmployee.name,
    recipientEmail: PEOPLE.harborEmployee.email,
    title: uniqueTitle('Confirm on home'),
    requiresAcknowledgement: true,
  })

  await page.goto('/my')
  await expect(page.getByText('Needs you', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/message(s)? need(s)? your confirmation/).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Read and confirm', exact: true })).toBeVisible()

  expectNoConsoleErrors(errors)
})

test('the inbox puts acknowledgement first and labels urgency in words', async ({ page }) => {
  const title = await publishAnnouncementTo(page, {
    authorEmail: PEOPLE.harborHr.email,
    recipientName: PEOPLE.harborEmployee.name,
    recipientEmail: PEOPLE.harborEmployee.email,
    title: uniqueTitle('Walk-in temperature check'),
    priority: 'Urgent',
    requiresAcknowledgement: true,
  })

  await page.goto('/my/inbox')
  await expect(page.getByRole('heading', { name: 'Your inbox' })).toBeVisible()

  const first = page.getByRole('main').getByRole('listitem').first()
  await expect(first).toContainText(title)
  await expect(first.getByText('Needs your confirmation')).toBeVisible()
  // Urgency is a WORD, not only a colour. The mark also carries a repeated
  // "!" glyph, so the assertion is that the word appears, not that some
  // element's text is exactly it.
  await expect(first).toContainText('Urgent')
})

test('opening records a read WITHOUT recording a confirmation', async ({ page }) => {
  const title = await publishAnnouncementTo(page, {
    authorEmail: PEOPLE.harborHr.email,
    recipientName: PEOPLE.harborEmployee.name,
    recipientEmail: PEOPLE.harborEmployee.email,
    title: uniqueTitle('Read not confirm'),
    requiresAcknowledgement: true,
  })

  await page.goto('/my/inbox')
  await page.getByRole('link', { name: new RegExp(title) }).click()
  await expect(page).toHaveURL(/\/my\/inbox\/[0-9a-f-]{36}$/)

  // Read, but the confirmation is still being asked for.
  await expect(page.getByRole('heading', { name: 'Confirm you have read this' })).toBeVisible()

  // Leaving and coming back must not have confirmed anything.
  await page.goto('/my/inbox?filter=acknowledge')
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible()
})

test('confirming takes one deliberate press and is then recorded', async ({ page }) => {
  const title = await publishAnnouncementTo(page, {
    authorEmail: PEOPLE.harborHr.email,
    recipientName: PEOPLE.harborEmployee.name,
    recipientEmail: PEOPLE.harborEmployee.email,
    title: uniqueTitle('Confirm me'),
    requiresAcknowledgement: true,
  })

  await page.goto('/my/inbox')
  await page.getByRole('link', { name: new RegExp(title) }).click()
  await page.getByRole('button', { name: 'I have read this' }).click()

  // Both: a thank-you that stays on screen, above the recorded state that
  // replaced the button.
  const notice = page.getByTestId('action-notice')
  await expect(notice).toContainText('Thank you — your confirmation is recorded.')
  await expect(page.getByRole('heading', { name: 'You confirmed this' })).toBeVisible()
  await expect(page.getByText(/^Recorded/)).toBeVisible()
  await page.waitForTimeout(3_000)
  await expect(notice).toBeVisible()

  await notice.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByTestId('action-notice')).toHaveCount(0)

  // Coming back shows the record, not the thank-you.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'You confirmed this' })).toBeVisible()
  await expect(page.getByTestId('action-notice')).toHaveCount(0)

  await page.goto('/my/inbox?filter=acknowledge')
  await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0)
})

test('the filters narrow without hiding anything permanently', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/inbox')
  const total = await page.getByRole('main').getByRole('listitem').count()
  expect(total).toBeGreaterThan(0)

  const filters = page.getByRole('navigation', { name: 'Filter' })
  await filters.getByRole('link', { name: /^Unread/ }).click()
  expect(await page.getByRole('main').getByRole('listitem').count()).toBeLessThanOrEqual(total)

  await filters.getByRole('link', { name: 'All' }).click()
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(total)
})

test('search finds a message by its words', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/inbox')

  await page.getByLabel('Search your messages').fill('allergen')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('link', { name: /Allergen handling/ }).first()).toBeVisible()

  await page.getByLabel('Search your messages').fill('zzzznothing')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('Nothing matched that search')).toBeVisible()
})

test('a message that is not yours is not found, not refused', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  // A well-formed id nobody owns and a malformed one answer the same way,
  // which is what keeps "not yours" indistinguishable from "does not exist".
  const wellFormed = await page.goto('/my/inbox/01a09999-0000-4000-8000-000000000000')
  expect(wellFormed?.status()).toBe(404)

  const malformed = await page.goto('/my/inbox/not-an-id')
  expect(malformed?.status()).toBe(404)
})

test('notification preferences are honest about what can be switched off', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/notifications')

  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()

  // Safety cannot be muted, and says so rather than offering a dead switch.
  const safety = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Safety' })
  await expect(safety.getByText('Cannot be switched off', { exact: true })).toBeVisible()

  // Only channels that can be delivered are offered: no dead SMS or push switches.
  await expect(page.getByLabel('SMS')).toHaveCount(0)
  await expect(page.getByText('(not yet)')).toHaveCount(0)

  await page.getByLabel('Hold notifications during quiet hours').check()
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
})

test('the inbox does not scroll sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/inbox')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})
