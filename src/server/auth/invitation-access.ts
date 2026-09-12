import { withTenant } from '@/server/db'
import { withGlobal } from '@/server/db/global'
import { organizationNameForInvite, previewInvitation } from '@/modules/invitations/service'

/**
 * PRE-AUTHENTICATION INVITATION LOOKUP.
 *
 * Lives in the auth layer, not in the invitations module, because it runs
 * BEFORE any tenant context exists - the same reason session and membership
 * resolution live here. Unscoped database access is restricted to this
 * directory, and routing the lookup through it keeps that boundary intact
 * rather than carving an exception into the lint rule.
 *
 * It resolves a token to an organization and nothing else. See migration 0005
 * for why the underlying function cannot be used to enumerate.
 */
export interface ResolvedInvitation {
  organizationId: string
  organizationName: string
  expiresAt: Date
}

export async function resolveInvitationToken(token: string): Promise<ResolvedInvitation | null> {
  const preview = await withGlobal((db) => previewInvitation(db, token))
  if (!preview) return null

  // The name comes through the ordinary tenant-scoped path, so the definer
  // function itself never returns tenant information.
  const name = await withTenant(preview.organizationId, (tx) =>
    organizationNameForInvite(tx, preview.organizationId),
  )
  if (!name) return null

  return {
    organizationId: preview.organizationId,
    organizationName: name,
    expiresAt: preview.expiresAt,
  }
}
