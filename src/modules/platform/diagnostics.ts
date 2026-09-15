import { cookies } from 'next/headers'

/*
 * DIAGNOSTICS ACCESS WINDOW.
 *
 * Opening an organization's diagnostics is an explicit, audited action that
 * lasts DIAGNOSTICS_MINUTES in that browser. The cookie only says "the audit
 * row was written recently"; every staff function still checks the staff role
 * inside the database.
 */

export const DIAGNOSTICS_MINUTES = 15

export function diagnosticsCookieName(organizationId: string): string {
  return `ec_diag_${organizationId.replace(/-/g, '')}`
}

export async function diagnosticsOpenUntil(organizationId: string): Promise<Date | null> {
  const value = (await cookies()).get(diagnosticsCookieName(organizationId))?.value
  const until = value ? Number(value) : 0
  return until > Date.now() ? new Date(until) : null
}
