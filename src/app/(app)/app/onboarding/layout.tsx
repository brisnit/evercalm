import { requireActorContext } from '@/server/auth/session'
import { canAtAnyLocation } from '@/server/authz/can'
import { SectionNav } from '@/ui/patterns/section-nav'

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireActorContext()

  const items = [{ href: '/app/onboarding', label: 'Progress' }]
  if (canAtAnyLocation(actor, 'onboarding.manage')) {
    items.push({ href: '/app/onboarding/templates', label: 'Checklists' })
  }

  return (
    <>
      {items.length > 1 ? <SectionNav items={items} /> : null}
      {children}
    </>
  )
}
