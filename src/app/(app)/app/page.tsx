import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listEmployments } from '@/modules/people/service'
import { listProgress } from '@/modules/onboarding/service'
import { attentionItems } from '@/modules/reports/attention'
import { canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { ToolCard } from '@/ui/patterns/tool-card'
import { ToolIcon } from '@/ui/patterns/tool-icon'
import { attentionSummary, launcherTools } from './launcher'

export const dynamic = 'force-dynamic'

/**
 * Administration home: a launcher.
 *
 * Owners and managers sign in to get somewhere, fast. So Home is a short
 * welcome, one small box saying how much needs a decision (the list itself is
 * one click away on Needs attention), and a card for each tool this person can
 * open. Nothing here is a feed.
 */

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ForbiddenError) return fallback
    throw error
  }
}

export default async function AppHomePage() {
  const { actor, activeOrganization } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => ({
    people: canAtAnyLocation(actor, 'people.view')
      ? await safely(() => listEmployments(tx, actor), [])
      : [],
    onboarding: canAtAnyLocation(actor, 'onboarding.view_progress')
      ? await safely(() => listProgress(tx, actor), [])
      : [],
    attention: await attentionItems(tx, actor),
  }))

  const active = data.people.filter((p) => p.status === 'active').length
  const onboarding = data.onboarding.filter((p) => p.state !== 'completed').length
  const tools = launcherTools(actor, data.attention, {
    people: data.people.length > 0 ? `${active} active` : null,
    onboarding:
      onboarding > 0 ? `${onboarding} ${onboarding === 1 ? 'person' : 'people'} onboarding` : null,
  })
  const summary = attentionSummary(data.attention)
  const firstName = actor.displayName.split(' ')[0] ?? actor.displayName

  return (
    <>
      <div className="mb-5 sm:mb-6">
        <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
          Good to see you, {firstName}
        </h1>
        <p className="text-muted mt-1">{activeOrganization.organizationName}</p>
      </div>

      <Link
        href="/app/attention"
        data-testid="attention-summary"
        className={cn(
          'group rounded-card mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 border bg-white px-4 py-3.5 sm:px-5',
          'transition-[border-color,box-shadow] hover:border-teal-300 hover:shadow-[0_6px_20px_-12px_rgba(30,45,61,0.35)]',
          'focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
          summary.total > 0 ? 'border-teal-200' : 'border-line',
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              summary.total > 0 ? 'bg-coral-50 text-coral-700' : 'bg-success-soft text-success',
            )}
          >
            <ToolIcon name={summary.total > 0 ? 'alert' : 'checklist'} className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="text-ink block font-semibold">Needs attention</span>
            <span className="text-muted block text-sm">
              {summary.total === 0
                ? 'Nothing needs a decision right now'
                : `${summary.kinds} ${summary.kinds === 1 ? 'kind of decision' : 'kinds of decisions'} waiting`}
            </span>
          </span>
        </span>
        {summary.top.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Waiting">
            {summary.top.map((item) => (
              <li
                key={item.key}
                className="bg-canvas text-ink inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 text-sm"
              >
                <span className="font-display font-extrabold tabular-nums">{item.count}</span>
                <span className="text-muted">{item.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <span className="text-accent-strong inline-flex items-center gap-1 text-sm font-semibold">
          {summary.total > 0 ? 'Review' : 'Open'}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="size-4 transition-transform group-hover:translate-x-0.5"
          >
            <path
              d="M6 3.5 10.5 8 6 12.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </Link>

      <section aria-labelledby="tools-heading">
        <h2 id="tools-heading" className="sr-only">
          Your tools
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {tools.map((tool) => (
            <li key={tool.key} className="min-w-0">
              <ToolCard
                href={tool.href}
                label={tool.label}
                icon={tool.icon}
                status={tool.status}
                tone={tool.tone}
                testId={`tool-${tool.key}`}
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
