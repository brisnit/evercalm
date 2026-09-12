-- ===========================================================================
-- Membership lookup.
--
-- THE PROBLEM: to show a signed-in user which organizations they belong to,
-- we must read `employments` BEFORE any tenant context exists. RLS fails
-- closed with no app.organization_id set, so an ordinary query returns
-- nothing - correctly.
--
-- THE FIX: one narrowly scoped SECURITY DEFINER function, owned by the
-- migration role (which is exempt from these policies as table owner). It
-- returns memberships for exactly one user id and nothing else. This is the
-- only sanctioned way for the runtime role to read across tenants, and it
-- cannot be used to enumerate a tenant's employees: the only input is a user
-- id, and the only output is that user's own memberships.
--
-- search_path is pinned so the function body cannot be hijacked by a
-- caller-controlled schema.
-- ===========================================================================

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
SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.name, o.slug, o.industry, e.id, e.status, e.display_name
  FROM employments e
  JOIN organizations o ON o.id = e.organization_id
  WHERE e.user_id = p_user_id
    AND e.archived_at IS NULL
    AND o.archived_at IS NULL
    AND e.status <> 'separated'
  ORDER BY o.name;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_user_memberships(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_user_memberships(text) TO evercalm_app;
