'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

/**
 * The three things that arrive for an employee: notices, channels, messages.
 *
 * One row, always in the same order, so "where do I look" has one answer. A
 * count appears only when something is waiting, because a permanent zero is
 * noise.
 */
export function InboxTabs({ channels, unread }: { channels: number; unread: number }) {
  const pathname = usePathname()
  const tabs = [
    { href: '/my/inbox', label: 'Notices', count: 0, exact: true },
    { href: '/my/inbox/channels', label: 'Channels', count: 0, hide: channels === 0 },
    { href: '/my/inbox/messages', label: 'Messages', count: unread },
  ].filter((tab) => !tab.hide)

  return (
    <nav aria-label="Inbox" className="border-line mt-5 flex gap-1 border-b">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm',
              active
                ? 'border-action text-ink font-semibold'
                : 'text-muted hover:text-ink border-transparent',
            )}
          >
            {tab.label}
            {tab.count > 0 ? (
              <span className="bg-action rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
                {tab.count}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
