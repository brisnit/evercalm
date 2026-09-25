import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listEmployments } from '@/modules/people/service'
import { listProgress } from '@/modules/onboarding/service'
import { attentionItems } from '@/modules/reports/attention'
import { canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/ui/primitives'
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
  const tools = launcherTools(actor, {
    people: data.people.length > 0 ? `${active} active` : null,
    onboarding:
      onboarding > 0 ? `${onboarding} ${onboarding === 1 ? 'person' : 'people'} onboarding` : null,
  })
  const summary = attentionSummary(data.attention)
  const firstName = actor.displayName.split(' ')[0] ?? actor.displayName

  return (
    <>
      <PageHeader
        title="Good to see you,"
        accent={firstName}
        description={activeOrganization.organizationName}
      />

      <div className="py-7 sm:py-9">
        <Link
          href="/app/attention"
          data-testid="attention-summary"
          className={cn(
            'group shadow-low mb-6 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-[1.1rem] border bg-white px-5 py-5 transition-[border-color,box-shadow] sm:px-6',
            'hover:shadow-raise focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
            summary.total > 0 ? 'border-coral-200' : 'border-line',
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-4">
            <span
              className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-full',
                summary.total > 0 ? 'bg-coral-50 text-coral-700' : 'bg-success-soft text-success',
              )}
            >
              <ToolIcon name={summary.total > 0 ? 'alert' : 'checklist'} className="size-6" />
            </span>
            <span className="min-w-0">
              <span className="font-display text-ink block text-lg font-extrabold">
                Needs attention
              </span>
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
                  className="bg-sunk text-ink inline-flex items-baseline gap-1.5 rounded-full px-3.5 py-1.5 text-sm"
                >
                  <span className="font-display font-extrabold tabular-nums">{item.count}</span>
                  <span className="text-muted">{item.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <span className="text-action inline-flex items-center gap-1 text-sm font-semibold group-hover:gap-1.5">
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
          <ul className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
            {tools.map((tool) => (
              <li key={tool.key} className="min-w-0 [&>a]:h-full">
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
      </div>
    </>
  )
}
