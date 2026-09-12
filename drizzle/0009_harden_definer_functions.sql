-- ===========================================================================
-- Hardening the two SECURITY DEFINER functions.
--
-- WHY THEY NEED SECURITY DEFINER AT ALL
--
-- Both answer a question that must be answered BEFORE a tenant context
-- exists, so RLS correctly returns nothing:
--
--   evercalm_user_memberships   "which organizations does this signed-in user
--                                belong to?" - asked at session resolution,
--                                before we know which tenant to scope to.
--   evercalm_invitation_by_token "which organization does this invitation
--                                token belong to?" - asked by somebody with no
--                                account at all.
--
-- The alternatives were considered and rejected:
--   * A permissive RLS policy on `invitations` loose enough for an anonymous
--     caller to read would also be loose enough to enumerate.
--   * Granting the runtime role broad SELECT on `employments` would hand it
--     cross-tenant read access for every request, not just this one.
--
-- So SECURITY DEFINER stays, and is instead made as narrow as possible.
--
-- WHAT THIS MIGRATION CHANGES
--
--  1. **search_path pinned to pg_catalog, pg_temp** - not `public`. Every
--     referenced object is now SCHEMA-QUALIFIED, so the body cannot be
--     hijacked by a caller-created object shadowing a table name, even if
--     somebody later gains CREATE on a schema in the path.
--  2. **Minimum information.** The invitation lookup no longer returns the
--     invitation id or the organization slug. It returns the organization id
--     and the expiry, and nothing else - no name, no email, no display name.
--     The organization's NAME is now read through the ordinary tenant-scoped
--     path once the id is known, so the definer function leaks nothing about
--     the tenant by itself.
--  3. **Constant-shape failure.** Every failure - unknown, revoked, expired,
--     already accepted, superseded by a resend - returns zero rows through the
--     same code path. There is no distinguishable error.
-- ===========================================================================

DROP FUNCTION IF EXISTS evercalm_invitation_by_token(text);--> statement-breakpoint

CREATE FUNCTION evercalm_invitation_by_token(p_token_hash text)
RETURNS TABLE (
  organization_id uuid,
  expires_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT i.organization_id, i.expires_at
  FROM public.invitations AS i
  JOIN public.organizations AS o ON o.id = i.organization_id
  WHERE i.token_hash = p_token_hash
    AND i.status = 'pending'
    AND i.expires_at > pg_catalog.now()
    AND o.archived_at IS NULL
  LIMIT 1;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_invitation_by_token(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_invitation_by_token(text) TO evercalm_app;--> statement-breakpoint

-- The membership lookup gets the same treatment. It already returned only the
-- caller's own memberships; this pins its search_path and schema-qualifies its
-- references for the same reason.
CREATE OR REPLACE FUNCTION evercalm_user_memberships(p_user_id text)
RETURNS TABLE (
  organization_id   uuid,
  organization_name text,
  organization_slug text,
  industry          text,
  employment_id     uuid,
  employment_status text,
  display_name      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT o.id, o.name, o.slug, o.industry, e.id, e.status, e.display_name
  FROM public.employments AS e
  JOIN public.organizations AS o ON o.id = e.organization_id
  WHERE e.user_id = p_user_id
    AND e.archived_at IS NULL
    AND o.archived_at IS NULL
    AND e.status <> 'separated'
  ORDER BY o.name;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_user_memberships(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_user_memberships(text) TO evercalm_app;
