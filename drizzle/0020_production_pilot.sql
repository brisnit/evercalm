-- ===========================================================================
-- 0020 · Production pilot: manual billing, shared rate limits.
--
--   * Subscriptions may use the MANUAL pilot provider: no payment provider,
--     nothing charged, and no automatic lifecycle. Only an EverCalm support
--     administrator changes a manual subscription's status, through
--     evercalm_staff_set_subscription_status(), with a required reason that is
--     recorded in the billing history and the customer's audit log.
--   * The worker's due-work discovery ignores manual subscriptions.
--   * Rate limits move into the database so every server instance shares them:
--     `rate_limit` for Better Auth (sign-in, sign-up, password reset) and
--     `app_rate_limits` for application actions. Neither holds tenant data:
--     keys are an IP and path (Better Auth) or a hash (application).
-- ===========================================================================

ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_provider_check";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_check" CHECK ("provider" IN ('mock','manual'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION evercalm_staff_set_subscription_status(p_staff text, p_org uuid, p_status text,
  p_reason text, p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_name text; v_sub public.subscriptions%ROWTYPE; v_reason text; v_label text;
BEGIN
  v_name := public.evercalm_require_staff(p_staff, true);
  v_reason := left(trim(coalesce(p_reason, '')), 300);
  IF v_reason = '' THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('active','past_due','suspended','canceled') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  -- A real provider owns its subscriptions' status; only pilots are set by hand.
  IF v_sub.provider <> 'manual' THEN
    RAISE EXCEPTION 'provider-managed subscription' USING ERRCODE = '22023';
  END IF;
  IF v_sub.status = p_status THEN
    RETURN p_status;
  END IF;

  UPDATE public.subscriptions
     SET status = p_status,
         past_due_since = CASE WHEN p_status = 'past_due' THEN coalesce(past_due_since, now()) ELSE NULL END,
         suspended_at = CASE WHEN p_status = 'suspended' THEN coalesce(suspended_at, now()) ELSE NULL END,
         canceled_at = CASE WHEN p_status = 'canceled' THEN coalesce(canceled_at, now()) ELSE NULL END,
         cancel_at_period_end = CASE WHEN p_status = 'canceled' THEN false ELSE cancel_at_period_end END,
         updated_at = now()
   WHERE id = v_sub.id;

  v_label := CASE p_status
    WHEN 'active' THEN 'Active' WHEN 'past_due' THEN 'Payment overdue'
    WHEN 'suspended' THEN 'Suspended' ELSE 'Canceled' END;
  INSERT INTO public.billing_events
    (id, organization_id, subscription_id, type, source, idempotency_key, from_status, to_status, summary,
     detail, actor_label, occurred_at)
  VALUES
    (gen_random_uuid(), p_org, v_sub.id, 'status_set_by_evercalm', 'evercalm',
     'evercalm:status:' || p_event_id::text, v_sub.status, p_status,
     'EverCalm set the status to ' || v_label || ': ' || v_reason,
     jsonb_build_object('reason', v_reason), 'EverCalm support (' || v_name || ')', now())
  ON CONFLICT DO NOTHING;

  PERFORM public.evercalm_staff_audit(p_org, p_staff, v_name, 'support.subscription_status_set', 'subscription',
    v_sub.id::text, 'EverCalm support set the subscription status to ' || v_label,
    jsonb_build_object('from', v_sub.status, 'to', p_status, 'reason', v_reason));
  RETURN p_status;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_set_subscription_status(text, uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_set_subscription_status(text, uuid, text, text, uuid) TO evercalm_app;--> statement-breakpoint

-- The directory now says which provider manages each subscription.
DROP FUNCTION evercalm_staff_organizations(text, uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION evercalm_staff_organizations(p_staff text, p_org uuid)
RETURNS TABLE (
  organization_id uuid, name text, slug text, industry text, org_status text, created_at timestamptz,
  locations integer, active_employees integer,
  plan text, subscription_status text, trial_ends_at timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean, past_due_since timestamptz, has_payment_method boolean,
  billing_contact_name text, billing_contact_email text,
  open_cases integer, failed_notifications_7d integer, publish_failures_30d integer,
  last_activity_at timestamptz, billing_provider text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.evercalm_require_staff(p_staff, false);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.industry, o.status, o.created_at,
    (SELECT count(*) FROM public.locations l WHERE l.organization_id = o.id AND l.archived_at IS NULL)::integer,
    (SELECT count(*) FROM public.employments e WHERE e.organization_id = o.id AND e.status = 'active')::integer,
    s.plan, s.status, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end, s.past_due_since,
    s.has_payment_method, s.billing_contact_name, s.billing_contact_email,
    (SELECT count(*) FROM public.support_cases c WHERE c.organization_id = o.id AND c.status <> 'resolved')::integer,
    (SELECT count(*) FROM public.notifications n WHERE n.organization_id = o.id AND n.status = 'failed'
       AND n.failed_at > now() - interval '7 days')::integer,
    (SELECT count(*) FROM public.announcements a WHERE a.organization_id = o.id
       AND a.publish_failed_at > now() - interval '30 days')::integer,
    (SELECT max(ae.created_at) FROM public.audit_events ae WHERE ae.organization_id = o.id AND ae.actor_type = 'user'),
    s.provider
  FROM public.organizations o
  LEFT JOIN public.subscriptions s ON s.organization_id = o.id
  WHERE p_org IS NULL OR o.id = p_org
  ORDER BY o.name;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_organizations(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_organizations(text, uuid) TO evercalm_app;--> statement-breakpoint

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
      OR EXISTS (
        SELECT 1
        FROM public.ops_runs AS r
        JOIN public.shifts AS s
          ON s.organization_id = r.organization_id
         AND s.id = r.shift_id
        WHERE r.organization_id = o.id
          AND r.status = 'active'
          AND r.reminded_at IS NULL
          AND r.assignee_employment_id IS NOT NULL
          AND s.published_status = 'active'
          AND s.published_starts_at > p_now
          AND s.published_starts_at <= p_now + interval '60 minutes'
          AND EXISTS (
            SELECT 1 FROM public.ops_task_items AS i
            WHERE i.organization_id = r.organization_id
              AND i.run_id = r.id
              AND i.status = 'pending'
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.subscriptions AS s
        WHERE s.organization_id = o.id
          AND s.provider <> 'manual'
          AND (
            (s.status = 'trialing' AND s.trial_ends_at <= p_now)
            OR (s.status = 'past_due' AND s.past_due_since + interval '14 days' <= p_now)
            OR (s.status = 'active' AND s.cancel_at_period_end AND s.current_period_end <= p_now)
          )
      )
    );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_organizations_with_due_work(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_organizations_with_due_work(timestamptz) TO evercalm_app;--> statement-breakpoint

-- Better Auth's rate-limit model, with its own camelCase columns.
CREATE TABLE "rate_limit" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_unique" ON "rate_limit" ("key");--> statement-breakpoint
CREATE INDEX "rate_limit_last_request_idx" ON "rate_limit" ("lastRequest");--> statement-breakpoint

CREATE TABLE "app_rate_limits" (
  "key" text PRIMARY KEY,
  "window_started_at" timestamptz NOT NULL,
  "count" integer NOT NULL,
  CONSTRAINT "app_rate_limits_count_check" CHECK ("count" >= 1)
);--> statement-breakpoint
CREATE INDEX "app_rate_limits_window_idx" ON "app_rate_limits" ("window_started_at");--> statement-breakpoint

-- The runtime role needs to read, write and prune both; 0001's default
-- privileges already grant that. Stated explicitly so it is reviewed.
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limit" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "app_rate_limits" TO evercalm_app;
