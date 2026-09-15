'use client'

import { createContext, useContext } from 'react'
import type { ActionState } from '@/modules/people/actions'
import { ActionNotice, useActionNotice } from './action-notice'

/*
 * ONE CONFIRMATION FOR A WHOLE WORKING PAGE.
 *
 * On a shift workspace or an operational board, almost every action moves the
 * thing it acted on: a task marked done leaves "Needs attention", a verified
 * task leaves "Needs you now". A message rendered beside the button would
 * vanish with it. Forms inside this provider hand their success up here, and
 * the notice stays at the top of the page, focused, until dismissed.
 */

const ShowNotice = createContext<(state: ActionState) => void>(() => {})

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const { notice, show, dismiss } = useActionNotice()
  return (
    <ShowNotice.Provider value={show}>
      {notice ? (
        <div className="sticky top-2 z-20 mb-4">
          <ActionNotice notice={notice} onDismiss={dismiss} className="shadow-lift" />
        </div>
      ) : null}
      {children}
    </ShowNotice.Provider>
  )
}

export function useShowNotice(): (state: ActionState) => void {
  return useContext(ShowNotice)
}
