-- ===========================================================================
-- Narrow the "reminders due" test in evercalm_organizations_with_due_work.
--
-- 0013 reported an organization as having reminder work whenever it had ANY
-- published acknowledgement-required announcement due within a day - including
-- ones whose reminders had all been sent, or that everybody had confirmed. The
-- worker then opened a tenant transaction for it on every tick and found
-- nothing to do, forever. Harmless, but a wasted transaction per tick per
-- organization, growing with every overdue announcement.
--
-- Now it is reported only when some recipient still needs the specific
-- reminder the current time calls for:
--   due within a day, not yet past   -> no due_soon_reminded_at yet
--   past due                          -> no overdue_reminded_at yet
-- and only for recipients who have not confirmed (or were asked again).
--
-- Same hardening as before: SECURITY DEFINER, pinned search_path,
-- schema-qualified objects, EXECUTE for the runtime role only. CREATE OR
-- REPLACE keeps the grants, which are restated anyway so this file alone says
-- what the function's privileges are.
-- ===========================================================================

CREATE OR REPLACE FUNCTION evercalm_organizations_with_due_work(p_now timestamptz)
RETURNS TABLE (organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT o.id
  FROM public.organizations AS o
  WHERE o.archived_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.announcements AS a
        WHERE a.organization_id = o.id
          AND a.status = 'scheduled'
          AND a.publish_at <= p_now
      )
      OR EXISTS (
        SELECT 1 FROM public.announcements AS a
        WHERE a.organization_id = o.id
          AND a.status = 'published'
          AND a.expires_at <= p_now
      )
      OR EXISTS (
        SELECT 1
        FROM public.announcements AS a
        JOIN public.announcement_recipients AS r
          ON r.organization_id = a.organization_id
         AND r.announcement_id = a.id
        WHERE a.organization_id = o.id
          AND a.status = 'published'
          AND a.requires_acknowledgement
          AND a.acknowledgement_due_at IS NOT NULL
          AND a.acknowledgement_due_at <= p_now + interval '24 hours'
          AND (r.acknowledged_at IS NULL OR r.reacknowledgement_requested_at IS NOT NULL)
          AND (
            (a.acknowledgement_due_at > p_now AND r.due_soon_reminded_at IS NULL)
            OR (a.acknowledgement_due_at <= p_now AND r.overdue_reminded_at IS NULL)
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.notifications AS n
        WHERE n.organization_id = o.id
          AND n.status = 'pending'
          AND n.scheduled_for <= p_now
          AND (n.locked_until IS NULL OR n.locked_until <= p_now)
      )
    );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_organizations_with_due_work(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_organizations_with_due_work(timestamptz) TO evercalm_app;
