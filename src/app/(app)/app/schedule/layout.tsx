import { requireActorContext } from '@/server/auth/session'
import { SectionNav } from '@/ui/patterns/section-nav'
import { visibleScheduleNav } from '../navigation'

export default async function ScheduleLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireActorContext()
  const nav = visibleScheduleNav(actor)

  return (
    <>
      {nav.length > 1 ? (
        <SectionNav items={nav.map((n) => ({ href: n.href, label: n.label }))} />
      ) : null}
      {children}
    </>
  )
}
