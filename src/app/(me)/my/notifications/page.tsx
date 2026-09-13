import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listCategories } from '@/modules/comms/service'
import { getSettings, listPreferences } from '@/modules/notifications/service'
import { Card, CardHeader, Logo } from '@/ui/primitives'
import { PreferencesForm } from './preferences-form'

export const metadata: Metadata = { title: 'Notifications' }
export const dynamic = 'force-dynamic'

/**
 * Notification preferences.
 *
 * Two honest things this screen has to say, and does:
 *
 *   1. Some categories cannot be switched off. Safety, HR and emergency
 *      messages reach you regardless. The switch is shown as locked with the
 *      reason next to it, rather than being hidden or - worse - shown as
 *      working and then ignored.
 *   2. Quiet hours delay, they do not cancel. A message held overnight arrives
 *      in the morning; it is not dropped.
 *
 * SMS and push are listed because the preference model already covers them,
 * and they are marked as not yet available rather than offered as working
 * controls.
 */
export default async function NotificationPreferencesPage() {
  const { actor } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => ({
    categories: await listCategories(tx, actor.organizationId),
    settings: await getSettings(tx, actor, actor.employmentId),
    preferences: await listPreferences(tx, actor, actor.employmentId),
  }))

  return (
    <div className="bg-raise flex min-h-screen flex-col">
      <header className="border-line border-b bg-white px-5 py-3">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <Link href="/my" aria-label="Your work">
            <Logo size="h-8" eager />
          </Link>
          <Link href="/my" className="text-muted text-sm underline-offset-4 hover:underline">
            Back
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight">
          Notifications
        </h1>
        <p className="text-muted mt-1.5 text-sm">
          Choose what reaches you, and when. Safety, HR and emergency messages cannot be switched
          off, and only urgent or emergency ones interrupt quiet hours.
        </p>

        <Card className="mt-6">
          <CardHeader
            title="What you hear about"
            description="In-app notifications appear in your inbox. Email is in development mode and nothing leaves this machine yet."
          />
          <div className="p-5">
            <PreferencesForm
              categories={data.categories.map((c) => ({
                key: c.key,
                name: c.name,
                description: c.description,
                locked: c.overridesPreferences,
              }))}
              preferences={Object.fromEntries(data.preferences)}
              settings={{
                quietHoursEnabled: data.settings.quietHoursEnabled,
                quietStart: data.settings.quietStart,
                quietEnd: data.settings.quietEnd,
                timezone: data.settings.timezone,
                effectiveTimezone: data.settings.effectiveTimezone,
              }}
            />
          </div>
        </Card>
      </main>
    </div>
  )
}
