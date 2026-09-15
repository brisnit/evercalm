-- ===========================================================================
-- 0019 · Launch readiness: billing, support, the EverCalm team, worker runs.
--
-- Tenant tables (RLS, like everything else a customer owns):
--   subscriptions            one per organization: plan, status, dates, contact
--   billing_events           immutable history; idempotent on (org, key)
--   support_cases            a customer's cases
--   support_case_messages    the conversation the customer sees (append-only)
--
-- EverCalm-only tables (no organization_id, no tenant policy):
--   platform_staff           who at EverCalm may use the team dashboard
--   support_internal_notes   notes customers must never see. The runtime role
--                            holds NO privileges on it at all.
--   worker_runs              one row per worker tick, for status pages
--
-- EverCalm staff never get a tenant context. Everything they do goes through
-- the SECURITY DEFINER functions below, each of which checks the caller is
-- active staff, returns only what its screen needs (counts, statuses, case
-- threads - never employee records, inboxes or HR fields), and writes its own
-- audit event with actor_type 'support'. There is no impersonation path.
-- ===========================================================================

CREATE TABLE "subscriptions" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "plan" text NOT NULL,
  "billing_interval" text NOT NULL DEFAULT 'month',
  "status" text NOT NULL,
  "trial_starts_at" timestamptz,
  "trial_ends_at" timestamptz,
  "quantity_basis" text NOT NULL DEFAULT 'active_employees',
  "quantity" integer NOT NULL DEFAULT 0,
  "current_period_start" timestamptz,
  "current_period_end" timestamptz,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "cancel_requested_at" timestamptz,
  "canceled_at" timestamptz,
  "past_due_since" timestamptz,
  "suspended_at" timestamptz,
  "has_payment_method" boolean NOT NULL DEFAULT false,
  "billing_contact_name" text NOT NULL DEFAULT '',
  "billing_contact_email" text NOT NULL DEFAULT '',
  "provider" text NOT NULL DEFAULT 'mock',
  "provider_customer_ref" text,
  "provider_subscription_ref" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "subscriptions_org_unique" UNIQUE ("organization_id"),
  CONSTRAINT "subscriptions_org_id_unique" UNIQUE ("organization_id", "id"),
  CONSTRAINT "subscriptions_plan_check" CHECK ("plan" IN ('pilot','essentials','multi_location')),
  CONSTRAINT "subscriptions_interval_check" CHECK ("billing_interval" IN ('month')),
  CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('trialing','active','past_due','canceled','suspended')),
  CONSTRAINT "subscriptions_basis_check" CHECK ("quantity_basis" IN ('active_employees','locations')),
  CONSTRAINT "subscriptions_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "subscriptions_trial_check" CHECK ("status" <> 'trialing' OR "trial_ends_at" IS NOT NULL),
  CONSTRAINT "subscriptions_past_due_check" CHECK ("status" <> 'past_due' OR "past_due_since" IS NOT NULL),
  CONSTRAINT "subscriptions_provider_check" CHECK ("provider" IN ('mock'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_ref_unique" ON "subscriptions" ("provider", "provider_subscription_ref")
  WHERE "provider_subscription_ref" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "billing_events" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "subscription_id" uuid NOT NULL,
  "type" text NOT NULL,
  "source" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "summary" text NOT NULL,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor_label" text NOT NULL DEFAULT '',
  "occurred_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_events_idempotency_unique" UNIQUE ("organization_id", "idempotency_key"),
  CONSTRAINT "billing_events_source_check" CHECK ("source" IN ('owner','provider','system','evercalm')),
  CONSTRAINT "billing_events_subscription_tenant_fk" FOREIGN KEY ("organization_id", "subscription_id")
    REFERENCES "subscriptions"("organization_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "billing_events_org_idx" ON "billing_events" ("organization_id", "occurred_at");--> statement-breakpoint

CREATE TABLE "support_cases" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "reference" text NOT NULL,
  "category" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'normal',
  "status" text NOT NULL DEFAULT 'open',
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "created_by_employment_id" uuid NOT NULL,
  "created_by_label" text NOT NULL,
  "assigned_staff_user_id" text,
  "assigned_staff_label" text NOT NULL DEFAULT '',
  "resolved_at" timestamptz,
  "reopened_count" integer NOT NULL DEFAULT 0,
  "last_customer_activity_at" timestamptz NOT NULL DEFAULT now(),
  "last_evercalm_activity_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "support_cases_org_id_unique" UNIQUE ("organization_id", "id"),
  CONSTRAINT "support_cases_reference_unique" UNIQUE ("organization_id", "reference"),
  CONSTRAINT "support_cases_category_check" CHECK ("category" IN ('question','problem','billing','account','data_request','feedback')),
  CONSTRAINT "support_cases_severity_check" CHECK ("severity" IN ('low','normal','high','urgent')),
  CONSTRAINT "support_cases_status_check" CHECK ("status" IN ('open','in_progress','waiting_on_customer','resolved')),
  CONSTRAINT "support_cases_resolved_check" CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL)),
  CONSTRAINT "support_cases_text_check" CHECK (length(trim("subject")) > 0 AND length(trim("description")) > 0),
  CONSTRAINT "support_cases_creator_tenant_fk" FOREIGN KEY ("organization_id", "created_by_employment_id")
    REFERENCES "employments"("organization_id", "id")
);--> statement-breakpoint
CREATE INDEX "support_cases_status_idx" ON "support_cases" ("organization_id", "status", "updated_at");--> statement-breakpoint

CREATE TABLE "support_case_messages" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL,
  "author_type" text NOT NULL,
  "author_employment_id" uuid,
  "author_label" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "status_from" text,
  "status_to" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "support_case_messages_author_check" CHECK ("author_type" IN ('customer','evercalm')),
  CONSTRAINT "support_case_messages_content_check" CHECK (length(trim("body")) > 0 OR "status_to" IS NOT NULL),
  CONSTRAINT "support_case_messages_case_tenant_fk" FOREIGN KEY ("organization_id", "case_id")
    REFERENCES "support_cases"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "support_case_messages_author_tenant_fk" FOREIGN KEY ("organization_id", "author_employment_id")
    REFERENCES "employments"("organization_id", "id")
);--> statement-breakpoint
CREATE INDEX "support_case_messages_case_idx" ON "support_case_messages" ("organization_id", "case_id", "created_at");--> statement-breakpoint

CREATE TABLE "platform_staff" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "display_name" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_staff_role_check" CHECK ("role" IN ('support_agent','support_admin'))
);--> statement-breakpoint

CREATE TABLE "support_internal_notes" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL REFERENCES "support_cases"("id") ON DELETE CASCADE,
  "author_staff_user_id" text NOT NULL,
  "author_label" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "support_internal_notes_body_check" CHECK (length(trim("body")) > 0)
);--> statement-breakpoint

CREATE TABLE "worker_runs" (
  "id" uuid PRIMARY KEY,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz NOT NULL,
  "organizations" integer NOT NULL DEFAULT 0,
  "counters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_count" integer NOT NULL DEFAULT 0,
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "worker_runs_finished_idx" ON "worker_runs" ("finished_at");--> statement-breakpoint

-- --- tenant isolation --------------------------------------------------------
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscriptions"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "billing_events"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "support_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "support_cases"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "support_case_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "support_case_messages"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- --- what the runtime role may do ------------------------------------------
-- 0001's default privileges grant everything on new tables; take back what
-- must never happen.
REVOKE DELETE ON "subscriptions" FROM evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "billing_events" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "support_cases" FROM evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "support_case_messages" FROM evercalm_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "platform_staff" FROM evercalm_app;--> statement-breakpoint
REVOKE ALL ON "support_internal_notes" FROM evercalm_app;--> statement-breakpoint
ALTER TABLE "support_internal_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "worker_runs" FROM evercalm_app;--> statement-breakpoint

-- ===========================================================================
-- Staff functions.
-- ===========================================================================

CREATE OR REPLACE FUNCTION evercalm_require_staff(p_staff text, p_admin boolean)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT s.display_name INTO v_name
    FROM public.platform_staff AS s
   WHERE s.user_id = p_staff
     AND s.active
     AND (NOT p_admin OR s.role = 'support_admin');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN v_name;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_require_staff(text, boolean) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION evercalm_staff_audit(p_org uuid, p_staff text, p_label text, p_action text,
  p_subject_type text, p_subject_id text, p_summary text, p_metadata jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO public.audit_events
    (id, organization_id, actor_type, actor_user_id, actor_label, action, subject_type, subject_id, summary, metadata)
  VALUES
    (gen_random_uuid(), p_org, 'support', p_staff, 'EverCalm support: ' || p_label, p_action,
     p_subject_type, p_subject_id, p_summary, coalesce(p_metadata, '{}'::jsonb));
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_audit(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC;--> statement-breakpoint

-- The organization directory, or one organization. Counts and statuses only.
CREATE OR REPLACE FUNCTION evercalm_staff_organizations(p_staff text, p_org uuid)
RETURNS TABLE (
  organization_id uuid, name text, slug text, industry text, org_status text, created_at timestamptz,
  locations integer, active_employees integer,
  plan text, subscription_status text, trial_ends_at timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean, past_due_since timestamptz, has_payment_method boolean,
  billing_contact_name text, billing_contact_email text,
  open_cases integer, failed_notifications_7d integer, publish_failures_30d integer,
  last_activity_at timestamptz
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
    (SELECT max(ae.created_at) FROM public.audit_events ae WHERE ae.organization_id = o.id AND ae.actor_type = 'user')
  FROM public.organizations o
  LEFT JOIN public.subscriptions s ON s.organization_id = o.id
  WHERE p_org IS NULL OR o.id = p_org
  ORDER BY o.name;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_organizations(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_organizations(text, uuid) TO evercalm_app;--> statement-breakpoint

-- Delivery failures grouped by channel, category and reason. No people.
CREATE OR REPLACE FUNCTION evercalm_staff_delivery_failures(p_staff text, p_org uuid)
RETURNS TABLE (channel text, category text, failure_reason text, failures integer, last_failed_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.evercalm_require_staff(p_staff, false);
  RETURN QUERY
  SELECT n.channel, n.category, coalesce(n.failure_reason, 'Unknown'), count(*)::integer, max(n.failed_at)
    FROM public.notifications n
   WHERE n.organization_id = p_org AND n.status = 'failed' AND n.failed_at > now() - interval '30 days'
   GROUP BY 1, 2, 3
   ORDER BY 5 DESC;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_delivery_failures(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_delivery_failures(text, uuid) TO evercalm_app;--> statement-breakpoint

-- Worker errors that mention an organization (or all of them).
CREATE OR REPLACE FUNCTION evercalm_staff_worker_errors(p_staff text, p_org uuid)
RETURNS TABLE (finished_at timestamptz, organization_id text, step text, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.evercalm_require_staff(p_staff, false);
  RETURN QUERY
  SELECT w.finished_at, e->>'organizationId', e->>'step', e->>'message'
    FROM public.worker_runs w, jsonb_array_elements(w.errors) AS e
   WHERE w.finished_at > now() - interval '7 days'
     AND (p_org IS NULL OR e->>'organizationId' = p_org::text)
   ORDER BY w.finished_at DESC
   LIMIT 50;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_worker_errors(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_worker_errors(text, uuid) TO evercalm_app;--> statement-breakpoint

-- What happened in an organization: action names and counts, never summaries.
CREATE OR REPLACE FUNCTION evercalm_staff_audit_summary(p_staff text, p_org uuid, p_days integer)
RETURNS TABLE (action text, actor_type text, events integer, last_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.evercalm_require_staff(p_staff, false);
  RETURN QUERY
  SELECT a.action, a.actor_type, count(*)::integer, max(a.created_at)
    FROM public.audit_events a
   WHERE a.organization_id = p_org AND a.created_at > now() - make_interval(days => least(greatest(p_days, 1), 90))
   GROUP BY 1, 2
   ORDER BY 3 DESC, 1;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_audit_summary(text, uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_audit_summary(text, uuid, integer) TO evercalm_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION evercalm_staff_billing_events(p_staff text, p_org uuid)
RETURNS TABLE (type text, source text, from_status text, to_status text, summary text, occurred_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.evercalm_require_staff(p_staff, false);
  RETURN QUERY
  SELECT b.type, b.source, b.from_status, b.to_status, b.summary, b.occurred_at
    FROM public.billing_events b
   WHERE b.organization_id = p_org
   ORDER BY b.occurred_at DESC
   LIMIT 50;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_billing_events(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_billing_events(text, uuid) TO evercalm_app;--> statement-breakpoint

-- Explicit, audited diagnostic access.
CREATE OR REPLACE FUNCTION evercalm_staff_record_access(p_staff text, p_org uuid, p_what text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_name text;
BEGIN
  v_name := public.evercalm_require_staff(p_staff, false);
  PERFORM 1 FROM public.organizations WHERE id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.evercalm_staff_audit(p_org, p_staff, v_name, 'support.diagnostics_viewed', 'organization', p_org::text,
    'EverCalm support viewed ' || left(p_what, 80), jsonb_build_object('view', left(p_what, 80)));
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_record_access(text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_record_access(text, uuid, text) TO evercalm_app;--> statement-breakpoint

-- Put recent, retryable delivery failures back in the queue. Support admins only.
CREATE OR REPLACE FUNCTION evercalm_staff_retry_deliveries(p_staff text, p_org uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_name text; v_count integer;
BEGIN
  v_name := public.evercalm_require_staff(p_staff, true);
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.notifications n
     SET status = 'pending', attempts = 0, failed_at = NULL, failure_reason = NULL,
         scheduled_for = now(), locked_until = NULL, claim_token = NULL
   WHERE n.organization_id = p_org AND n.status = 'failed'
     AND n.failed_at > now() - interval '7 days'
     AND coalesce(n.failure_reason, '') NOT LIKE 'No email address%'
     AND coalesce(n.failure_reason, '') NOT LIKE 'The % channel is not available%';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.evercalm_staff_audit(p_org, p_staff, v_name, 'support.deliveries_retried', 'organization', p_org::text,
    'EverCalm support queued ' || v_count || ' failed notifications to try again',
    jsonb_build_object('count', v_count, 'reason', left(p_reason, 300)));
  RETURN v_count;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_retry_deliveries(text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_retry_deliveries(text, uuid, text) TO evercalm_app;--> statement-breakpoint

-- --- support cases, from EverCalm's side --------------------------------------

CREATE OR REPLACE FUNCTION evercalm_staff_cases(p_staff text, p_org uuid, p_case uuid, p_open_only boolean)
RETURNS TABLE (
  id uuid, organization_id uuid, organization_name text, reference text, category text, severity text,
  status text, subject text, description text, created_by_label text, assigned_staff_user_id text,
  assigned_staff_label text, resolved_at timestamptz, reopened_count integer, created_at timestamptz,
  updated_at timestamptz, last_customer_activity_at timestamptz, last_evercalm_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.evercalm_require_staff(p_staff, false);
  RETURN QUERY
  SELECT c.id, c.organization_id, o.name, c.reference, c.category, c.severity, c.status, c.subject,
         c.description, c.created_by_label, c.assigned_staff_user_id, c.assigned_staff_label, c.resolved_at,
         c.reopened_count, c.created_at, c.updated_at, c.last_customer_activity_at, c.last_evercalm_activity_at
    FROM public.support_cases c
    JOIN public.organizations o ON o.id = c.organization_id
   WHERE (p_org IS NULL OR c.organization_id = p_org)
     AND (p_case IS NULL OR c.id = p_case)
     AND (NOT p_open_only OR c.status <> 'resolved')
   ORDER BY CASE c.severity WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
            c.updated_at DESC;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_cases(text, uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_cases(text, uuid, uuid, boolean) TO evercalm_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION evercalm_staff_case_thread(p_staff text, p_case uuid)
RETURNS TABLE (id uuid, kind text, author_label text, body text, status_from text, status_to text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.evercalm_require_staff(p_staff, false);
  RETURN QUERY
  SELECT m.id, m.author_type, m.author_label, m.body, m.status_from, m.status_to, m.created_at
    FROM public.support_case_messages m WHERE m.case_id = p_case
  UNION ALL
  SELECT n.id, 'internal', n.author_label, n.body, NULL, NULL, n.created_at
    FROM public.support_internal_notes n WHERE n.case_id = p_case
  ORDER BY 7;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_case_thread(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_case_thread(text, uuid) TO evercalm_app;--> statement-breakpoint

-- A reply the customer sees, a status change, or both. Notifies the case's author.
CREATE OR REPLACE FUNCTION evercalm_staff_case_update(p_staff text, p_case uuid, p_body text, p_status text,
  p_message_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_name text; v_case public.support_cases%ROWTYPE; v_status text; v_body text; v_action text; v_title text;
BEGIN
  v_name := public.evercalm_require_staff(p_staff, false);
  SELECT * INTO v_case FROM public.support_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  v_body := trim(coalesce(p_body, ''));
  v_status := coalesce(nullif(p_status, ''), v_case.status);
  IF v_status NOT IN ('open','in_progress','waiting_on_customer','resolved') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  IF v_body = '' AND v_status = v_case.status THEN
    RAISE EXCEPTION 'nothing to record' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.support_case_messages
    (id, organization_id, case_id, author_type, author_employment_id, author_label, body, status_from, status_to)
  VALUES
    (p_message_id, v_case.organization_id, v_case.id, 'evercalm', NULL, 'EverCalm support (' || v_name || ')',
     left(v_body, 5000),
     CASE WHEN v_status <> v_case.status THEN v_case.status END,
     CASE WHEN v_status <> v_case.status THEN v_status END);

  UPDATE public.support_cases
     SET status = v_status,
         resolved_at = CASE WHEN v_status = 'resolved' THEN coalesce(resolved_at, now()) ELSE NULL END,
         reopened_count = reopened_count + CASE WHEN v_case.status = 'resolved' AND v_status <> 'resolved' THEN 1 ELSE 0 END,
         last_evercalm_activity_at = now(),
         updated_at = now()
   WHERE id = v_case.id;

  v_action := CASE
    WHEN v_status = 'resolved' AND v_case.status <> 'resolved' THEN 'support_case.resolved'
    WHEN v_case.status = 'resolved' AND v_status <> 'resolved' THEN 'support_case.reopened'
    WHEN v_status <> v_case.status THEN 'support_case.status_changed'
    ELSE 'support_case.replied' END;
  PERFORM public.evercalm_staff_audit(v_case.organization_id, p_staff, v_name, v_action, 'support_case', v_case.id::text,
    'EverCalm support ' || replace(split_part(v_action, '.', 2), '_', ' ') || ' case ' || v_case.reference,
    jsonb_build_object('from', v_case.status, 'to', v_status));

  v_title := CASE
    WHEN v_action = 'support_case.resolved' THEN 'EverCalm resolved your support case ' || v_case.reference
    WHEN v_action = 'support_case.reopened' THEN 'EverCalm reopened your support case ' || v_case.reference
    ELSE 'EverCalm replied to your support case ' || v_case.reference END;
  INSERT INTO public.notifications
    (id, organization_id, employment_id, category, channel, subject_type, subject_id, title, preview, href,
     status, idempotency_key)
  SELECT gen_random_uuid(), v_case.organization_id, v_case.created_by_employment_id, 'support', 'in_app',
         'support_case', v_case.id, left(v_title, 140), left(v_case.subject, 140),
         '/app/support/' || v_case.id::text, 'pending',
         'support_case:' || v_case.id::text || ':' || v_case.created_by_employment_id::text || ':in_app:update-' || p_message_id::text
  ON CONFLICT DO NOTHING;

  RETURN v_status;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_case_update(text, uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_case_update(text, uuid, text, text, uuid) TO evercalm_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION evercalm_staff_case_note(p_staff text, p_case uuid, p_body text, p_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_name text; v_case public.support_cases%ROWTYPE;
BEGIN
  v_name := public.evercalm_require_staff(p_staff, false);
  SELECT * INTO v_case FROM public.support_cases WHERE id = p_case;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF length(trim(coalesce(p_body, ''))) = 0 THEN
    RAISE EXCEPTION 'a note is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.support_internal_notes (id, case_id, author_staff_user_id, author_label, body)
  VALUES (p_note_id, v_case.id, p_staff, v_name, left(trim(p_body), 5000));
  UPDATE public.support_cases SET last_evercalm_activity_at = now() WHERE id = v_case.id;
  -- The audit row says a note exists, never what it says: customers can read their audit log.
  PERFORM public.evercalm_staff_audit(v_case.organization_id, p_staff, v_name, 'support_case.internal_note_added',
    'support_case', v_case.id::text, 'EverCalm support added an internal note to case ' || v_case.reference, '{}'::jsonb);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_case_note(text, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_case_note(text, uuid, text, uuid) TO evercalm_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION evercalm_staff_case_assign(p_staff text, p_case uuid, p_assignee text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_name text; v_case public.support_cases%ROWTYPE; v_assignee_name text := '';
BEGIN
  v_name := public.evercalm_require_staff(p_staff, false);
  SELECT * INTO v_case FROM public.support_cases WHERE id = p_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF p_assignee IS NOT NULL THEN
    SELECT display_name INTO v_assignee_name FROM public.platform_staff WHERE user_id = p_assignee AND active;
    IF v_assignee_name IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = '22023'; END IF;
  END IF;
  UPDATE public.support_cases
     SET assigned_staff_user_id = p_assignee, assigned_staff_label = coalesce(v_assignee_name, ''), updated_at = now()
   WHERE id = v_case.id;
  PERFORM public.evercalm_staff_audit(v_case.organization_id, p_staff, v_name, 'support_case.assigned', 'support_case',
    v_case.id::text,
    CASE WHEN p_assignee IS NULL THEN 'EverCalm support unassigned case ' || v_case.reference
         ELSE 'EverCalm support assigned case ' || v_case.reference || ' to ' || v_assignee_name END,
    '{}'::jsonb);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_staff_case_assign(text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_staff_case_assign(text, uuid, text) TO evercalm_app;--> statement-breakpoint

-- --- small, tenant-safe questions ---------------------------------------------

-- The provider knows its subscription reference, not our organization id.
CREATE OR REPLACE FUNCTION evercalm_org_for_provider_subscription(p_provider text, p_ref text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.organization_id FROM public.subscriptions s
   WHERE s.provider = p_provider AND s.provider_subscription_ref = p_ref;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_org_for_provider_subscription(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_org_for_provider_subscription(text, text) TO evercalm_app;--> statement-breakpoint

-- For the CURRENT tenant only: when the worker last ran, and how many of its
-- errors in the last day concerned this organization. Reads the tenant from
-- the transaction setting, so no organization can ask about another.
CREATE OR REPLACE FUNCTION evercalm_tenant_worker_status()
RETURNS TABLE (last_finished_at timestamptz, errors_24h integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    (SELECT max(w.finished_at) FROM public.worker_runs w),
    (SELECT count(*) FROM public.worker_runs w, jsonb_array_elements(w.errors) AS e
      WHERE w.finished_at > now() - interval '1 day'
        AND e->>'organizationId' = nullif(current_setting('app.organization_id', true), ''))::integer;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_tenant_worker_status() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_tenant_worker_status() TO evercalm_app;--> statement-breakpoint

-- Readiness: the newest applied migration.
CREATE OR REPLACE FUNCTION evercalm_latest_migration()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT filename FROM public.evercalm_migrations ORDER BY filename DESC LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_latest_migration() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_latest_migration() TO evercalm_app;--> statement-breakpoint

-- ===========================================================================
-- Due work: billing lifecycle changes (trial ending, grace expiring, a
-- cancellation reaching its period end) wake the worker too.
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
          AND (
            (s.status = 'trialing' AND s.trial_ends_at <= p_now)
            OR (s.status = 'past_due' AND s.past_due_since + interval '14 days' <= p_now)
            OR (s.status = 'active' AND s.cancel_at_period_end AND s.current_period_end <= p_now)
          )
      )
    );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_organizations_with_due_work(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_organizations_with_due_work(timestamptz) TO evercalm_app;
