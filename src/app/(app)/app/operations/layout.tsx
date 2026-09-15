import { requireActorContext } from '@/server/auth/session'
import { SectionNav } from '@/ui/patterns/section-nav'
import { visibleOperationsNav } from '../navigation'

export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireActorContext()
  const nav = visibleOperationsNav(actor)
  return (
    <>
      {nav.length > 1 ? (
        <div className="mb-6">
          <SectionNav items={nav.map((n) => ({ href: n.href, label: n.label }))} />
        </div>
      ) : null}
      {children}
    </>
  )
}
