import { RouteNotFound } from '@/ui/patterns/route-states'

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-5 py-7">
      <RouteNotFound home={{ href: '/my', label: 'Back to your work' }} />
    </div>
  )
}
