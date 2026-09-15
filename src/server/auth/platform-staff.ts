import { cache } from 'react'
import { and, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { withGlobal } from '@/server/db/global'
import { platformStaff } from '@/server/db/platform-schema'
import { getSessionUser } from './session'

/*
 * EVERCALM STAFF.
 *
 * A separate kind of person from a customer's employee. Staff are listed in
 * `platform_staff` (a global table the runtime role can only read) and have
 * NO employment, so they cannot open /app or /my for any organization, and
 * no code path gives them a tenant context. What they can do is exactly the
 * SECURITY DEFINER functions in migration 0019, each of which checks again.
 *
 * Anyone else asking for /platform gets a 404: a customer learns nothing
 * about whether the dashboard exists.
 */

export const PLATFORM_ROLES = ['support_agent', 'support_admin'] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

export type PlatformPermission =
  'directory' | 'diagnostics' | 'support' | 'retry_deliveries' | 'set_subscription_status'

const PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  support_agent: ['directory', 'diagnostics', 'support'],
  support_admin: [
    'directory',
    'diagnostics',
    'support',
    'retry_deliveries',
    'set_subscription_status',
  ],
}

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  support_agent: 'Support agent',
  support_admin: 'Support administrator',
}

export interface PlatformStaff {
  userId: string
  displayName: string
  role: PlatformRole
}

export const getPlatformStaff = cache(async (userId: string): Promise<PlatformStaff | null> => {
  const [row] = await withGlobal((db) =>
    db
      .select({
        userId: platformStaff.userId,
        displayName: platformStaff.displayName,
        role: platformStaff.role,
      })
      .from(platformStaff)
      .where(and(eq(platformStaff.userId, userId), eq(platformStaff.active, true)))
      .limit(1),
  )
  if (!row || !(PLATFORM_ROLES as readonly string[]).includes(row.role)) return null
  return { userId: row.userId, displayName: row.displayName, role: row.role as PlatformRole }
})

export function staffMay(staff: PlatformStaff, permission: PlatformPermission): boolean {
  return PERMISSIONS[staff.role].includes(permission)
}

/** For /platform pages and actions. Not staff: 404. Not signed in: sign in. */
export async function requirePlatformStaff(
  permission: PlatformPermission = 'directory',
): Promise<PlatformStaff> {
  const user = await getSessionUser()
  if (!user) redirect('/signin')
  const staff = await getPlatformStaff(user.id)
  if (!staff || !staffMay(staff, permission)) notFound()
  return staff
}
