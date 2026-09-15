import { Suspense } from 'react'
import { NavigationProgress } from '@/ui/patterns/navigation-progress'
import { EmployeeNav } from './_components/employee-nav'

/**
 * Every employee page: the page itself, with room at the bottom on a phone for
 * the navigation bar that stays in reach of a thumb.
 */
export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas min-h-screen pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      {children}
      <EmployeeNav variant="bar" />
    </div>
  )
}
