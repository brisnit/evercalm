import { RouteNotFound } from '@/ui/patterns/route-states'

export default function NotFound() {
  return <RouteNotFound home={{ href: '/app', label: 'Back to overview' }} />
}
