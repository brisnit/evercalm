-- ===========================================================================
-- Invitation acceptance lookup.
--
-- THE PROBLEM: someone accepting an invitation is not signed in and has no
-- organization context, so RLS on `invitations` correctly returns nothing.
-- But acceptance has to discover WHICH organization the token belongs to.
--
-- THE FIX: one narrowly scoped SECURITY DEFINER function, keyed on the token
-- HASH. It is the second and last sanctioned cross-tenant read in EverCalm,
-- and it is deliberately narrower than it looks:
--
--   * The only input is a SHA-256 hash. Without the token there is nothing to
--     present, and the token exists only in the emailed link.
--   * It returns at most ONE row, and only while the invitation is pending
--     and unexpired. An accepted, revoked or expired invitation returns
--     nothing, so a replayed link is inert.
--   * It returns no email address and no name, so a leaked hash cannot be
--     turned into personal information.
--   * It cannot be used to enumerate: there is no way to ask "which
--     invitations exist" or "does this address have one".
--
-- A permissive RLS policy on `invitations` was the alternative and was
-- rejected: any policy loose enough for an anonymous caller to accept with
-- would also be loose enough to enumerate with.
--
-- search_path is pinned so the body cannot be hijacked by a caller-controlled
-- schema.
-- ===========================================================================

CREATE OR REPLACE FUNCTION evercalm_invitation_by_token(p_token_hash text)
RETURNS TABLE (
  invitation_id     uuid,
  organization_id   uuid,
  organization_name text,
  organization_slug text,
  expires_at        timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, o.id, o.name, o.slug, i.expires_at
  FROM invitations i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.token_hash = p_token_hash
    AND i.status = 'pending'
    AND i.expires_at > now()
    AND o.archived_at IS NULL
  LIMIT 1;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_invitation_by_token(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_invitation_by_token(text) TO evercalm_app;
