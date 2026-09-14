-- ===========================================================================
-- Slice 4: scheduling and shift management.
--
-- Hand-written (see 0010 for why the generator cannot run here). Mirrors
-- src/modules/scheduling/schema.ts, plus the two things Drizzle cannot express:
--
--   1. An EXCLUSION CONSTRAINT that makes it impossible for one person to hold
--      two overlapping active shifts. The service checks conflicts first and
--      gives a readable answer; this is the backstop that still holds when two
--      managers approve two different swaps for the same person in the same
--      instant.
--   2. Grants that take DELETE away from decision records.
--
-- Every table follows the tenant pattern: organization_id, composite
-- (organization_id, id) foreign keys, and a tenant_isolation RLS policy.
-- ===========================================================================

-- btree_gist lets a GiST exclusion constraint compare uuid equality alongside
-- a time range. A trusted extension since PostgreSQL 13, so the database
-- owner (the migration role) may create it without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- --- availability ------------------------------------------------------------
CREATE TABLE "availability_rules" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "weekday" smallint NOT NULL,
  "start_minute" integer NOT NULL,
  "end_minute" integer NOT NULL,
  "preference" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "availability_rules_weekday_check" CHECK (weekday between 1 and 7),
  CONSTRAINT "availability_rules_window_check" CHECK (start_minute >= 0 and end_minute > start_minute and end_minute <= 1440),
  CONSTRAINT "availability_rules_preference_check" CHECK (preference in ('available','preferred','unavailable'))
);--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "availability_rules_employment_idx" ON "availability_rules" ("organization_id","employment_id");--> statement-breakpoint

CREATE TABLE "availability_exceptions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "on_date" date NOT NULL,
  "start_minute" integer,
  "end_minute" integer,
  "preference" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "availability_exceptions_window_check" CHECK ((start_minute is null and end_minute is null) or (start_minute >= 0 and end_minute > start_minute and end_minute <= 1440)),
  CONSTRAINT "availability_exceptions_preference_check" CHECK (preference in ('available','unavailable'))
);--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "availability_exceptions_employment_idx" ON "availability_exceptions" ("organization_id","employment_id","on_date");--> statement-breakpoint

-- --- time off ----------------------------------------------------------------
CREATE TABLE "time_off_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "start_minute" integer,
  "end_minute" integer,
  "reason" text DEFAULT 'personal' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by_employment_id" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text DEFAULT '' NOT NULL,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "time_off_requests_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "time_off_requests_dates_check" CHECK (ends_on >= starts_on),
  CONSTRAINT "time_off_requests_partial_day_check" CHECK ((start_minute is null and end_minute is null) or (starts_on = ends_on and start_minute >= 0 and end_minute > start_minute and end_minute <= 1440)),
  CONSTRAINT "time_off_requests_reason_check" CHECK (reason in ('vacation','sick','personal','family','other')),
  CONSTRAINT "time_off_requests_status_check" CHECK (status in ('pending','approved','denied','cancelled')),
  CONSTRAINT "time_off_requests_decision_check" CHECK (status not in ('approved','denied') or decided_at is not null)
);--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "time_off_requests_employment_idx" ON "time_off_requests" ("organization_id","employment_id","starts_on");--> statement-breakpoint
CREATE INDEX "time_off_requests_status_idx" ON "time_off_requests" ("organization_id","status");--> statement-breakpoint

-- --- templates ---------------------------------------------------------------
CREATE TABLE "shift_templates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "name" text NOT NULL,
  "job_role_id" uuid,
  "station_id" uuid,
  "start_minute" integer NOT NULL,
  "end_minute" integer NOT NULL,
  "break_minutes" integer DEFAULT 0 NOT NULL,
  "days_of_week" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
  "headcount" smallint DEFAULT 1 NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "created_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "shift_templates_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "shift_templates_times_check" CHECK (start_minute between 0 and 1439 and end_minute between 0 and 1439 and start_minute <> end_minute),
  CONSTRAINT "shift_templates_break_check" CHECK (break_minutes between 0 and 240),
  CONSTRAINT "shift_templates_headcount_check" CHECK (headcount between 1 and 20),
  CONSTRAINT "shift_templates_days_check" CHECK (days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[])
);--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_job_role_tenant_fk"
  FOREIGN KEY ("organization_id","job_role_id") REFERENCES "public"."job_roles"("organization_id","id");--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_station_tenant_fk"
  FOREIGN KEY ("organization_id","station_id") REFERENCES "public"."stations"("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_templates_location_name_unique" ON "shift_templates" ("organization_id","location_id",lower("name")) WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "shift_templates_location_idx" ON "shift_templates" ("organization_id","location_id");--> statement-breakpoint

-- --- schedules ---------------------------------------------------------------
CREATE TABLE "schedules" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "week_start" date NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "published_version" integer DEFAULT 0 NOT NULL,
  "published_at" timestamp with time zone,
  "published_by_employment_id" uuid,
  "has_unpublished_changes" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "schedules_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "schedules_org_id_location_unique" UNIQUE("organization_id","id","location_id"),
  CONSTRAINT "schedules_location_week_unique" UNIQUE("organization_id","location_id","week_start"),
  CONSTRAINT "schedules_status_check" CHECK (status in ('draft','published')),
  CONSTRAINT "schedules_monday_check" CHECK (extract(isodow from week_start) = 1),
  CONSTRAINT "schedules_published_check" CHECK (status = 'draft' or published_at is not null)
);--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

-- --- shifts ------------------------------------------------------------------
CREATE TABLE "shifts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "template_id" uuid,
  "job_role_id" uuid,
  "station_id" uuid,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "break_minutes" integer DEFAULT 0 NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "assignee_employment_id" uuid,
  "is_open" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "published_at" timestamp with time zone,
  "published_starts_at" timestamp with time zone,
  "published_ends_at" timestamp with time zone,
  "published_break_minutes" integer,
  "published_job_role_id" uuid,
  "published_station_id" uuid,
  "published_notes" text,
  "published_assignee_employment_id" uuid,
  "published_is_open" boolean,
  "published_status" text,
  "created_by_employment_id" uuid,
  "updated_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shifts_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "shifts_times_check" CHECK (ends_at > starts_at),
  CONSTRAINT "shifts_length_check" CHECK (ends_at - starts_at <= interval '24 hours'),
  CONSTRAINT "shifts_break_check" CHECK (break_minutes between 0 and 240),
  CONSTRAINT "shifts_status_check" CHECK (status in ('active','cancelled')),
  CONSTRAINT "shifts_open_check" CHECK (not (is_open and assignee_employment_id is not null)),
  CONSTRAINT "shifts_published_check" CHECK ((published_at is null) = (published_starts_at is null) and (published_status is null or published_status in ('active','cancelled')))
);--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_schedule_tenant_fk"
  FOREIGN KEY ("organization_id","schedule_id","location_id") REFERENCES "public"."schedules"("organization_id","id","location_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_template_tenant_fk"
  FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."shift_templates"("organization_id","id");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_job_role_tenant_fk"
  FOREIGN KEY ("organization_id","job_role_id") REFERENCES "public"."job_roles"("organization_id","id");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_station_tenant_fk"
  FOREIGN KEY ("organization_id","station_id") REFERENCES "public"."stations"("organization_id","id");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_assignee_tenant_fk"
  FOREIGN KEY ("organization_id","assignee_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_published_assignee_tenant_fk"
  FOREIGN KEY ("organization_id","published_assignee_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "shifts_location_start_idx" ON "shifts" ("organization_id","location_id","starts_at");--> statement-breakpoint
CREATE INDEX "shifts_assignee_start_idx" ON "shifts" ("organization_id","assignee_employment_id","starts_at");--> statement-breakpoint
CREATE INDEX "shifts_published_assignee_idx" ON "shifts" ("organization_id","published_assignee_employment_id","published_starts_at");--> statement-breakpoint
CREATE INDEX "shifts_schedule_idx" ON "shifts" ("organization_id","schedule_id");--> statement-breakpoint

-- Nobody holds two overlapping active shifts. Half-open ranges, so a shift
-- ending at 16:00 does not collide with one starting at 16:00.
-- DEFERRABLE so a trade - two assignments moving at once - can be applied
-- inside one transaction and checked when it is complete.
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_no_double_booking"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "assignee_employment_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE (status = 'active' AND assignee_employment_id IS NOT NULL)
  DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint

-- --- open shift claims -------------------------------------------------------
CREATE TABLE "open_shift_claims" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "decided_by_employment_id" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "open_shift_claims_status_check" CHECK (status in ('pending','approved','declined','withdrawn','expired'))
);--> statement-breakpoint
ALTER TABLE "open_shift_claims" ADD CONSTRAINT "open_shift_claims_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "open_shift_claims" ADD CONSTRAINT "open_shift_claims_shift_tenant_fk"
  FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shifts"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "open_shift_claims" ADD CONSTRAINT "open_shift_claims_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "open_shift_claims_pending_unique" ON "open_shift_claims" ("organization_id","shift_id","employment_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "open_shift_claims_shift_idx" ON "open_shift_claims" ("organization_id","shift_id");--> statement-breakpoint
CREATE INDEX "open_shift_claims_employment_idx" ON "open_shift_claims" ("organization_id","employment_id");--> statement-breakpoint

-- --- swaps -------------------------------------------------------------------
CREATE TABLE "shift_swap_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "shift_id" uuid NOT NULL,
  "shift_version" integer NOT NULL,
  "requester_employment_id" uuid NOT NULL,
  "recipient_employment_id" uuid NOT NULL,
  "recipient_shift_id" uuid,
  "recipient_shift_version" integer,
  "status" text DEFAULT 'pending_recipient' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "recipient_responded_at" timestamp with time zone,
  "decided_by_employment_id" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shift_swap_requests_kind_check" CHECK (kind in ('giveaway','trade')),
  CONSTRAINT "shift_swap_requests_trade_check" CHECK ((kind = 'trade') = (recipient_shift_id is not null)),
  CONSTRAINT "shift_swap_requests_people_check" CHECK (requester_employment_id <> recipient_employment_id),
  CONSTRAINT "shift_swap_requests_status_check" CHECK (status in ('pending_recipient','pending_manager','approved','declined','denied','cancelled','expired'))
);--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_shift_tenant_fk"
  FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shifts"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_recipient_shift_tenant_fk"
  FOREIGN KEY ("organization_id","recipient_shift_id") REFERENCES "public"."shifts"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_tenant_fk"
  FOREIGN KEY ("organization_id","requester_employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_recipient_tenant_fk"
  FOREIGN KEY ("organization_id","recipient_employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_swap_requests_active_shift_unique" ON "shift_swap_requests" ("organization_id","shift_id") WHERE status in ('pending_recipient','pending_manager');--> statement-breakpoint
CREATE UNIQUE INDEX "shift_swap_requests_active_recipient_shift_unique" ON "shift_swap_requests" ("organization_id","recipient_shift_id") WHERE status in ('pending_recipient','pending_manager') and recipient_shift_id is not null;--> statement-breakpoint
CREATE INDEX "shift_swap_requests_requester_idx" ON "shift_swap_requests" ("organization_id","requester_employment_id");--> statement-breakpoint
CREATE INDEX "shift_swap_requests_recipient_idx" ON "shift_swap_requests" ("organization_id","recipient_employment_id");--> statement-breakpoint
CREATE INDEX "shift_swap_requests_status_idx" ON "shift_swap_requests" ("organization_id","status");--> statement-breakpoint

-- ===========================================================================
-- Row-Level Security. Same predicate as every other tenant table; `nullif` so
-- a reverted empty setting fails closed rather than erroring.
-- ===========================================================================
ALTER TABLE "availability_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "availability_rules"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "availability_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "availability_exceptions"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "time_off_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "time_off_requests"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "shift_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_templates"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "schedules"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shifts"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "open_shift_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "open_shift_claims"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "shift_swap_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_swap_requests"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- ===========================================================================
-- Grants. 0001's default privileges already give the runtime role full DML on
-- new tables, so restriction has to be an explicit REVOKE (see 0012).
--
-- Decision records - time off, claims, swaps, schedules, templates - are
-- retired by status, never deleted: they are the evidence of who asked for
-- what and who decided. Shifts may be deleted only by the service, and only
-- while never published; availability is a person's own editable preference.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "availability_rules" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "availability_exceptions" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shifts" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "time_off_requests" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "shift_templates" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "schedules" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "open_shift_claims" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "shift_swap_requests" TO evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "time_off_requests" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "shift_templates" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "schedules" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "open_shift_claims" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "shift_swap_requests" FROM evercalm_app;
