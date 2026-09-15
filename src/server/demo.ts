import { getEnv } from '@/lib/env'

/*
 * THE STAKEHOLDER DEMO.
 *
 * A separate deployment of fictional organizations for people to explore. It
 * is identified by EVERCALM_ENVIRONMENT=stakeholder-demo, which is set on that
 * Vercel project only. In it, anything that is destructive or reaches outside
 * the demo is refused on the server - adding or removing people's access,
 * accepting invitations, imports, billing changes, retries of deliveries - so a
 * visitor can explore every screen without leaving the demo in a state the
 * reset command has to explain. Everyday work (schedules, tasks,
 * announcements, training) stays usable, and the reset restores the data.
 */

export function isStakeholderDemo(): boolean {
  return getEnv().EVERCALM_ENVIRONMENT === 'stakeholder-demo'
}

export const DEMO_REFUSAL =
  'This is switched off in the Stakeholder Demo, so the demo stays the same for everyone exploring it.'

/** The error state a demo-restricted action returns, or null to carry on. */
export function demoRestriction(): { status: 'error'; message: string } | null {
  return isStakeholderDemo() ? { status: 'error', message: DEMO_REFUSAL } : null
}
