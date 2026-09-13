-- ===========================================================================
-- Background work: scheduled publishing, expiry, automatic reminders, and
-- notification delivery that actually run.
--
-- Everything the worker does is recorded IN THE DATABASE, not in the worker's
-- memory. That is what makes it durable: a worker that dies mid-tick leaves
-- rows that say exactly what was and was not done, and the next worker - the
-- same process restarted, a second one, or a production scheduler invoking
-- `worker --once` - picks up from there.
-- ===========================================================================

-- --- scheduling ------------------------------------------------------------
-- Who scheduled it, so the worker publishes with THAT person's permissions
-- and scope, re-checked at the moment of publication. If they have lost the
-- right to send it in the meantime, it does not go out; it returns to draft
-- with the reason recorded.
ALTER TABLE "announcements" ADD COLUMN "scheduled_by_employment_id" uuid;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "publish_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "publish_failure_reason" text;--> statement-breakpoint

-- --- automatic reminders -----------------------------------------------------
-- One stamp per automatic reminder. The worker claims a reminder with a
-- conditional UPDATE ... WHERE <stamp> IS NULL, so two workers racing cannot
-- both send it, and a restarted worker does not send it again.
ALTER TABLE "announcement_recipients" ADD COLUMN "due_soon_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD COLUMN "overdue_reminded_at" timestamp with time zone;--> statement-breakpoint

-- --- delivery ----------------------------------------------------------------
-- A LEASE, not a status. Claiming a notification sets `locked_until` and a
-- `claim_token`; completing it requires the same token. A worker that crashes
-- while holding a lease simply lets it expire, and the row becomes claimable
-- again - no human has to find and unstick it.
ALTER TABLE "notifications" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint

-- `mandatory` keeps its meaning - the category or priority cannot be muted by
-- a preference. Interrupting quiet hours is now a SEPARATE, narrower decision:
-- a routine acknowledgement must not wake somebody at 3am.
ALTER TABLE "notifications" ADD COLUMN "overrides_quiet_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE INDEX "notifications_claimable_idx" ON "notifications" ("organization_id", "status", "scheduled_for", "locked_until");--> statement-breakpoint
CREATE INDEX "announcements_due_idx" ON "announcements" ("status", "publish_at", "expires_at");--> statement-breakpoint

-- --- which tenants have work -------------------------------------------------
-- The third sanctioned cross-tenant read, after membership lookup (0002) and
-- invitation lookup (0005).
--
-- WHY IT HAS TO EXIST. The worker has no signed-in user and therefore no
-- tenant context, and every tenant table fails closed without one. It needs
-- to know WHICH organizations to open a tenant transaction for. The
-- alternatives were worse: running the worker as the migration role would
-- make the runtime privileged, and giving evercalm_app a policy exception
-- would open every table to every request.
--
-- WHAT IT RETURNS: organization ids and nothing else. No names, no counts, no
-- rows. Every piece of actual work then happens inside withTenant(), under
-- RLS, exactly as a request would.
--
-- Same hardening as 0009: SECURITY DEFINER with search_path pinned to
-- pg_catalog, every object schema-qualified, EXECUTE revoked from PUBLIC and
-- granted only to the runtime role.
CREATE FUNCTION evercalm_organizations_with_due_work(p_now timestamptz)
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
        SELECT 1 FROM public.announcements AS a
        WHERE a.organization_id = o.id
          AND a.status = 'published'
          AND a.requires_acknowledgement
          AND a.acknowledgement_due_at IS NOT NULL
          AND a.acknowledgement_due_at <= p_now + interval '24 hours'
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
