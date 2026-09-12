import { requireActorContext } from '@/server/auth/session'
import { visibleSettingsNav } from '../navigation'
import { SectionNav } from '@/ui/patterns/section-nav'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireActorContext()
  const nav = visibleSettingsNav(actor)

  return (
    <>
      <div className="mb-6">
        <SectionNav items={nav.map((n) => ({ href: n.href, label: n.label }))} />
      </div>
      {children}
    </>
  )
}
