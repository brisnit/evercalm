-- ===========================================================================
-- 0023 · Slotted: named week templates, day review, recorded overrides,
--        and call-outs.
--
--   Round 2 rebuilds manager scheduling on the Slotted model: describe demand
--   once, generate the week's slots, fill them, review one day at a time,
--   publish. Most of that already has a home - shift_templates carries a
--   demand pattern, a shifts row with no assignee IS a slot, schedules carries
--   draft/published, and conflicts.ts already knows about availability, time
--   off, overtime and rest. What was missing is the four things below.
--
--   schedule_templates   a NAMED WEEK: which days are open, the break rules,
--                        and the patterns that belong to it. shift_templates
--                        gains a nullable pointer to one, so every existing
--                        standalone pattern keeps working exactly as it did.
--
--   schedule_day_reviews the review stack has to survive a page reload:
--                        approved, flagged, or not looked at yet, per day.
--
--   schedule_overrides   when a manager schedules somebody against their
--                        stated availability, that is a decision with a name
--                        on it. It is shown again at the final check and to
--                        the person on their own schedule. APPROVED TIME OFF
--                        IS NEVER AN OVERRIDE - there is no row shape here
--                        that can express one, because it cannot happen.
--
--   shift_callouts       a call-out is an event, so replacing somebody is a
--                        decision with a record rather than a silent edit.
--
--   Additive only. No existing column changes type or nullability.
-- ===========================================================================

CREATE TABLE "schedule_templates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "name" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  -- ISO weekdays (Monday = 1) the business is open. A closed day never gets slots.
  "open_days" smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
  -- Break rules, described once and applied to every generated shift.
  "meal_minutes" integer DEFAULT 30 NOT NULL,
  "meal_after_minutes" integer DEFAULT 300 NOT NULL,
  "rest_minutes" integer DEFAULT 10 NOT NULL,
  "rest_every_minutes" integer DEFAULT 240 NOT NULL,
  "stagger_breaks" boolean DEFAULT true NOT NULL,
  "created_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "schedule_templates_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "schedule_templates_meal_check" CHECK ("meal_minutes" >= 0 and "meal_after_minutes" > 0),
  CONSTRAINT "schedule_templates_rest_check" CHECK ("rest_minutes" >= 0 and "rest_every_minutes" > 0)
);--> statement-breakpoint

ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_created_by_tenant_fk"
  FOREIGN KEY ("organization_id","created_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_templates_location_name_unique"
  ON "schedule_templates" ("organization_id","location_id","name") WHERE "archived_at" is null;--> statement-breakpoint

-- A demand pattern may now belong to a named week. Existing patterns do not,
-- and keep behaving exactly as before.
ALTER TABLE "shift_templates" ADD COLUMN "template_set_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_set_tenant_fk"
  FOREIGN KEY ("organization_id","template_set_id") REFERENCES "public"."schedule_templates"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "shift_templates_set_idx" ON "shift_templates" ("organization_id","template_set_id");--> statement-breakpoint

CREATE TABLE "schedule_day_reviews" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "on_date" date NOT NULL,
  "state" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "reviewed_by_employment_id" uuid,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "schedule_day_reviews_unique" UNIQUE("organization_id","schedule_id","on_date"),
  CONSTRAINT "schedule_day_reviews_state_check" CHECK ("state" in ('approved','flagged'))
);--> statement-breakpoint

ALTER TABLE "schedule_day_reviews" ADD CONSTRAINT "schedule_day_reviews_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedule_day_reviews" ADD CONSTRAINT "schedule_day_reviews_schedule_tenant_fk"
  FOREIGN KEY ("organization_id","schedule_id") REFERENCES "public"."schedules"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedule_day_reviews" ADD CONSTRAINT "schedule_day_reviews_reviewer_tenant_fk"
  FOREIGN KEY ("organization_id","reviewed_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint

CREATE TABLE "schedule_overrides" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "schedule_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  -- Only availability can be overridden. Approved time off has no kind here.
  "kind" text NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "decided_by_employment_id" uuid,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "schedule_overrides_unique" UNIQUE("organization_id","shift_id"),
  CONSTRAINT "schedule_overrides_kind_check" CHECK ("kind" in ('unavailable','not_preferred'))
);--> statement-breakpoint

ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_schedule_tenant_fk"
  FOREIGN KEY ("organization_id","schedule_id") REFERENCES "public"."schedules"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_shift_tenant_fk"
  FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shifts"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

CREATE TABLE "shift_callouts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "reported_by_employment_id" uuid,
  "reported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "replacement_employment_id" uuid,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "shift_callouts_open_unique" UNIQUE("organization_id","shift_id")
);--> statement-breakpoint

ALTER TABLE "shift_callouts" ADD CONSTRAINT "shift_callouts_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_callouts" ADD CONSTRAINT "shift_callouts_shift_tenant_fk"
  FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shifts"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_callouts" ADD CONSTRAINT "shift_callouts_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "shift_callouts" ADD CONSTRAINT "shift_callouts_replacement_tenant_fk"
  FOREIGN KEY ("organization_id","replacement_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "shift_callouts_open_idx" ON "shift_callouts" ("organization_id","resolved_at");--> statement-breakpoint

-- ===========================================================================
-- Row-Level Security.
-- ===========================================================================

ALTER TABLE "schedule_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "schedule_templates"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "schedule_day_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "schedule_day_reviews"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "schedule_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "schedule_overrides"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "shift_callouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_callouts"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
