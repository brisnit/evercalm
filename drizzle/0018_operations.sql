-- ===========================================================================
-- Slice 6: shift operations.
--
-- Hand-written. Mirrors src/modules/operations/schema.ts, plus what Drizzle
-- cannot express:
--
--   1. FROZEN PUBLISHED TEMPLATE VERSIONS. Triggers refuse changes to a
--      published version and to its sections, tasks and targeting, so what a
--      shift was asked to do can never be rewritten afterwards.
--   2. Composite keys that pin every run and task item to the exact version it
--      was generated from, and a unique (shift, template) pair that makes
--      generation idempotent however often a schedule is published.
--   3. Grants that make task history, assignee history and acknowledgements
--      append-only, and remove DELETE from every operational record.
--   4. The background worker's discovery function learns about pre-shift
--      reminders.
--
-- Every table follows the tenant pattern: organization_id, composite
-- (organization_id, id) foreign keys, and a tenant_isolation RLS policy.
-- ===========================================================================

-- --- templates -----------------------------------------------------------------
CREATE TABLE "ops_templates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "published_version_id" uuid,
  "created_by_employment_id" uuid,
  "archived_at" timestamp with time zone,
  "archived_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_templates_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "ops_templates_kind_check" CHECK (kind in ('pre_shift','opening','side_work','station_setup','shift_duties','closing','handoff')),
  CONSTRAINT "ops_templates_status_check" CHECK (status in ('active','archived')),
  CONSTRAINT "ops_templates_archived_check" CHECK ((status = 'archived') = (archived_at is not null))
);--> statement-breakpoint
ALTER TABLE "ops_templates" ADD CONSTRAINT "ops_templates_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_templates" ADD CONSTRAINT "ops_templates_created_by_tenant_fk"
  FOREIGN KEY ("organization_id","created_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_templates" ADD CONSTRAINT "ops_templates_archived_by_tenant_fk"
  FOREIGN KEY ("organization_id","archived_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_templates_name_unique" ON "ops_templates" ("organization_id",lower("name")) WHERE status = 'active';--> statement-breakpoint

CREATE TABLE "ops_template_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "template_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "change_note" text DEFAULT '' NOT NULL,
  "published_at" timestamp with time zone,
  "published_by_employment_id" uuid,
  "created_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_template_versions_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "ops_template_versions_org_id_template_unique" UNIQUE("organization_id","id","template_id"),
  CONSTRAINT "ops_template_versions_number_unique" UNIQUE("organization_id","template_id","version_number"),
  CONSTRAINT "ops_template_versions_number_check" CHECK (version_number >= 1),
  CONSTRAINT "ops_template_versions_status_check" CHECK (status in ('draft','published')),
  CONSTRAINT "ops_template_versions_kind_check" CHECK (kind in ('pre_shift','opening','side_work','station_setup','shift_duties','closing','handoff')),
  CONSTRAINT "ops_template_versions_published_check" CHECK ((status = 'published') = (published_at is not null))
);--> statement-breakpoint
ALTER TABLE "ops_template_versions" ADD CONSTRAINT "ops_template_versions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_template_versions" ADD CONSTRAINT "ops_template_versions_template_tenant_fk"
  FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."ops_templates"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_template_versions" ADD CONSTRAINT "ops_template_versions_published_by_tenant_fk"
  FOREIGN KEY ("organization_id","published_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_template_versions" ADD CONSTRAINT "ops_template_versions_created_by_tenant_fk"
  FOREIGN KEY ("organization_id","created_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_template_versions_one_draft" ON "ops_template_versions" ("organization_id","template_id") WHERE status = 'draft';--> statement-breakpoint
ALTER TABLE "ops_templates" ADD CONSTRAINT "ops_templates_published_version_tenant_fk"
  FOREIGN KEY ("organization_id","published_version_id","id") REFERENCES "public"."ops_template_versions"("organization_id","id","template_id");--> statement-breakpoint

-- Targeting belongs to a version: changing who a template applies to is an
-- edit like any other, and never re-targets shifts it has already reached.
-- No rows for a dimension means "any".
CREATE TABLE "ops_version_locations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  CONSTRAINT "ops_version_locations_unique" UNIQUE("organization_id","version_id","location_id")
);--> statement-breakpoint
ALTER TABLE "ops_version_locations" ADD CONSTRAINT "ops_version_locations_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_version_locations" ADD CONSTRAINT "ops_version_locations_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."ops_template_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_version_locations" ADD CONSTRAINT "ops_version_locations_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id");--> statement-breakpoint

CREATE TABLE "ops_version_job_roles" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "job_role_id" uuid NOT NULL,
  CONSTRAINT "ops_version_job_roles_unique" UNIQUE("organization_id","version_id","job_role_id")
);--> statement-breakpoint
ALTER TABLE "ops_version_job_roles" ADD CONSTRAINT "ops_version_job_roles_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_version_job_roles" ADD CONSTRAINT "ops_version_job_roles_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."ops_template_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_version_job_roles" ADD CONSTRAINT "ops_version_job_roles_role_tenant_fk"
  FOREIGN KEY ("organization_id","job_role_id") REFERENCES "public"."job_roles"("organization_id","id");--> statement-breakpoint

CREATE TABLE "ops_version_stations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  CONSTRAINT "ops_version_stations_unique" UNIQUE("organization_id","version_id","station_id")
);--> statement-breakpoint
ALTER TABLE "ops_version_stations" ADD CONSTRAINT "ops_version_stations_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_version_stations" ADD CONSTRAINT "ops_version_stations_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."ops_template_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_version_stations" ADD CONSTRAINT "ops_version_stations_station_tenant_fk"
  FOREIGN KEY ("organization_id","station_id") REFERENCES "public"."stations"("organization_id","id");--> statement-breakpoint

CREATE TABLE "ops_sections" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "title" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_sections_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "ops_sections_org_id_version_unique" UNIQUE("organization_id","id","version_id")
);--> statement-breakpoint
ALTER TABLE "ops_sections" ADD CONSTRAINT "ops_sections_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_sections" ADD CONSTRAINT "ops_sections_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."ops_template_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

CREATE TABLE "ops_tasks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "section_id" uuid NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "title" text NOT NULL,
  "instructions" text DEFAULT '' NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "response_type" text DEFAULT 'check' NOT NULL,
  "timing_anchor" text DEFAULT 'shift_start' NOT NULL,
  "offset_minutes" integer DEFAULT 0 NOT NULL,
  "requires_verification" boolean DEFAULT false NOT NULL,
  "shared" boolean DEFAULT false NOT NULL,
  "source_task_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_tasks_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "ops_tasks_org_id_version_unique" UNIQUE("organization_id","id","version_id"),
  CONSTRAINT "ops_tasks_response_check" CHECK (response_type in ('check','text','number','handoff')),
  CONSTRAINT "ops_tasks_anchor_check" CHECK (timing_anchor in ('shift_start','shift_end')),
  CONSTRAINT "ops_tasks_offset_check" CHECK (offset_minutes between -720 and 720)
);--> statement-breakpoint
ALTER TABLE "ops_tasks" ADD CONSTRAINT "ops_tasks_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_tasks" ADD CONSTRAINT "ops_tasks_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."ops_template_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
-- A task's section must be in the same version as the task.
ALTER TABLE "ops_tasks" ADD CONSTRAINT "ops_tasks_section_tenant_fk"
  FOREIGN KEY ("organization_id","section_id","version_id") REFERENCES "public"."ops_sections"("organization_id","id","version_id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "ops_tasks_version_idx" ON "ops_tasks" ("organization_id","version_id","position");--> statement-breakpoint

-- --- runs: one template applied to one published shift ------------------------
CREATE TABLE "ops_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "template_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "business_date" date NOT NULL,
  "assignee_employment_id" uuid,
  "status" text DEFAULT 'active' NOT NULL,
  "cancelled_at" timestamp with time zone,
  "cancellation_reason" text DEFAULT '' NOT NULL,
  "reminded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_runs_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "ops_runs_org_id_version_unique" UNIQUE("organization_id","id","version_id"),
  -- Idempotent generation: one run of a template per shift, ever.
  CONSTRAINT "ops_runs_shift_template_unique" UNIQUE("organization_id","shift_id","template_id"),
  CONSTRAINT "ops_runs_status_check" CHECK (status in ('active','cancelled')),
  CONSTRAINT "ops_runs_cancelled_check" CHECK ((status = 'cancelled') = (cancelled_at is not null))
);--> statement-breakpoint
ALTER TABLE "ops_runs" ADD CONSTRAINT "ops_runs_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
-- No cascade: a published shift is never deleted, and neither is its history.
ALTER TABLE "ops_runs" ADD CONSTRAINT "ops_runs_shift_tenant_fk"
  FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shifts"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_runs" ADD CONSTRAINT "ops_runs_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_runs" ADD CONSTRAINT "ops_runs_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id","template_id") REFERENCES "public"."ops_template_versions"("organization_id","id","template_id");--> statement-breakpoint
ALTER TABLE "ops_runs" ADD CONSTRAINT "ops_runs_assignee_tenant_fk"
  FOREIGN KEY ("organization_id","assignee_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "ops_runs_board_idx" ON "ops_runs" ("organization_id","location_id","business_date");--> statement-breakpoint
CREATE INDEX "ops_runs_assignee_idx" ON "ops_runs" ("organization_id","assignee_employment_id","business_date");--> statement-breakpoint

-- Who a run was moved between, and why. Append-only.
CREATE TABLE "ops_run_assignees" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "from_employment_id" uuid,
  "to_employment_id" uuid,
  "reason" text DEFAULT '' NOT NULL,
  "changed_by_employment_id" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "ops_run_assignees" ADD CONSTRAINT "ops_run_assignees_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_run_assignees" ADD CONSTRAINT "ops_run_assignees_run_tenant_fk"
  FOREIGN KEY ("organization_id","run_id") REFERENCES "public"."ops_runs"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_run_assignees" ADD CONSTRAINT "ops_run_assignees_from_tenant_fk"
  FOREIGN KEY ("organization_id","from_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_run_assignees" ADD CONSTRAINT "ops_run_assignees_to_tenant_fk"
  FOREIGN KEY ("organization_id","to_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_run_assignees" ADD CONSTRAINT "ops_run_assignees_changed_by_tenant_fk"
  FOREIGN KEY ("organization_id","changed_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint

-- --- task items: one task of a run -------------------------------------------------
CREATE TABLE "ops_task_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "assigned_employment_id" uuid,
  "due_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "response_text" text DEFAULT '' NOT NULL,
  "response_number" numeric(12,2),
  "reason" text DEFAULT '' NOT NULL,
  "returned_note" text DEFAULT '' NOT NULL,
  "completed_by_employment_id" uuid,
  "completed_at" timestamp with time zone,
  "verified_by_employment_id" uuid,
  "verified_at" timestamp with time zone,
  "reassigned_from_employment_id" uuid,
  "reassigned_at" timestamp with time zone,
  "handoff_id" uuid,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_task_items_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "ops_task_items_run_task_unique" UNIQUE("organization_id","run_id","task_id"),
  CONSTRAINT "ops_task_items_status_check" CHECK (status in ('pending','blocked','skipped','awaiting_verification','done')),
  CONSTRAINT "ops_task_items_done_check" CHECK (status not in ('done','awaiting_verification','skipped') or (completed_at is not null and completed_by_employment_id is not null)),
  CONSTRAINT "ops_task_items_reason_check" CHECK (status not in ('skipped','blocked') or length(trim(reason)) > 0)
);--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
-- An item belongs to its run's version, and to a task in that same version.
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_run_tenant_fk"
  FOREIGN KEY ("organization_id","run_id","version_id") REFERENCES "public"."ops_runs"("organization_id","id","version_id");--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_task_tenant_fk"
  FOREIGN KEY ("organization_id","task_id","version_id") REFERENCES "public"."ops_tasks"("organization_id","id","version_id");--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_shift_tenant_fk"
  FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shifts"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_assigned_tenant_fk"
  FOREIGN KEY ("organization_id","assigned_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_completed_by_tenant_fk"
  FOREIGN KEY ("organization_id","completed_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_verified_by_tenant_fk"
  FOREIGN KEY ("organization_id","verified_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_reassigned_from_tenant_fk"
  FOREIGN KEY ("organization_id","reassigned_from_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "ops_task_items_run_idx" ON "ops_task_items" ("organization_id","run_id");--> statement-breakpoint
CREATE INDEX "ops_task_items_assigned_idx" ON "ops_task_items" ("organization_id","assigned_employment_id","status");--> statement-breakpoint

-- Everything that ever happened to an item. Append-only.
CREATE TABLE "ops_task_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "action" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "note" text DEFAULT '' NOT NULL,
  "employment_id" uuid,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_task_events_action_check" CHECK (action in ('generated','completed','submitted','skipped','blocked','unblocked','verified','returned','reassigned','reopened','cancelled','rescheduled'))
);--> statement-breakpoint
ALTER TABLE "ops_task_events" ADD CONSTRAINT "ops_task_events_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "ops_task_events" ADD CONSTRAINT "ops_task_events_item_tenant_fk"
  FOREIGN KEY ("organization_id","item_id") REFERENCES "public"."ops_task_items"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_task_events" ADD CONSTRAINT "ops_task_events_run_tenant_fk"
  FOREIGN KEY ("organization_id","run_id") REFERENCES "public"."ops_runs"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_task_events" ADD CONSTRAINT "ops_task_events_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "ops_task_events_item_idx" ON "ops_task_events" ("organization_id","item_id","at");--> statement-breakpoint

-- --- handoffs ------------------------------------------------------------------
CREATE TABLE "handoffs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "shift_id" uuid,
  "business_date" date NOT NULL,
  "category" text NOT NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "title" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "author_employment_id" uuid NOT NULL,
  "task_item_id" uuid,
  "status" text DEFAULT 'open' NOT NULL,
  "resolved_by_employment_id" uuid,
  "resolved_at" timestamp with time zone,
  "resolution_note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "handoffs_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "handoffs_category_check" CHECK (category in ('staffing','inventory','maintenance','safety','guest','follow_up')),
  CONSTRAINT "handoffs_priority_check" CHECK (priority in ('normal','urgent')),
  CONSTRAINT "handoffs_status_check" CHECK (status in ('open','resolved')),
  CONSTRAINT "handoffs_resolved_check" CHECK ((status = 'resolved') = (resolved_at is not null and resolved_by_employment_id is not null))
);--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id");--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_shift_tenant_fk"
  FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shifts"("organization_id","id");--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_author_tenant_fk"
  FOREIGN KEY ("organization_id","author_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_task_item_tenant_fk"
  FOREIGN KEY ("organization_id","task_item_id") REFERENCES "public"."ops_task_items"("organization_id","id");--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_resolved_by_tenant_fk"
  FOREIGN KEY ("organization_id","resolved_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "ops_task_items" ADD CONSTRAINT "ops_task_items_handoff_tenant_fk"
  FOREIGN KEY ("organization_id","handoff_id") REFERENCES "public"."handoffs"("organization_id","id");--> statement-breakpoint
CREATE INDEX "handoffs_location_idx" ON "handoffs" ("organization_id","location_id","status","created_at");--> statement-breakpoint

-- Each person who has read a handoff. Append-only.
CREATE TABLE "handoff_acknowledgements" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "handoff_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "handoff_acknowledgements_unique" UNIQUE("organization_id","handoff_id","employment_id")
);--> statement-breakpoint
ALTER TABLE "handoff_acknowledgements" ADD CONSTRAINT "handoff_acknowledgements_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "handoff_acknowledgements" ADD CONSTRAINT "handoff_acknowledgements_handoff_tenant_fk"
  FOREIGN KEY ("organization_id","handoff_id") REFERENCES "public"."handoffs"("organization_id","id");--> statement-breakpoint
ALTER TABLE "handoff_acknowledgements" ADD CONSTRAINT "handoff_acknowledgements_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint

-- ===========================================================================
-- Frozen published template versions.
--
-- The version row reuses the training trigger function from 0016: it refuses
-- any update to a published row and any delete of one while its organization
-- exists. The content tables need their own, pointing at ops_template_versions.
-- ===========================================================================
CREATE TRIGGER "ops_template_versions_frozen_when_published"
  BEFORE UPDATE OR DELETE ON "ops_template_versions"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_version_change();--> statement-breakpoint

CREATE FUNCTION evercalm_refuse_published_ops_content_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  touched uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    touched := ARRAY[NEW.version_id];
  ELSIF TG_OP = 'UPDATE' THEN
    touched := ARRAY[OLD.version_id, NEW.version_id];
  ELSE
    -- Organization deletion cascades through here; nothing else may.
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
      RETURN OLD;
    END IF;
    touched := ARRAY[OLD.version_id];
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ops_template_versions
     WHERE id = ANY (touched) AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'A published operational template version cannot be changed; start a new draft'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_refuse_published_ops_content_change() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER "ops_sections_frozen_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "ops_sections"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_ops_content_change();--> statement-breakpoint
CREATE TRIGGER "ops_tasks_frozen_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "ops_tasks"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_ops_content_change();--> statement-breakpoint
CREATE TRIGGER "ops_version_locations_frozen_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "ops_version_locations"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_ops_content_change();--> statement-breakpoint
CREATE TRIGGER "ops_version_job_roles_frozen_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "ops_version_job_roles"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_ops_content_change();--> statement-breakpoint
CREATE TRIGGER "ops_version_stations_frozen_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "ops_version_stations"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_ops_content_change();--> statement-breakpoint
ALTER TABLE "ops_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_templates"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_template_versions"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_version_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_version_locations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_version_job_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_version_job_roles"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_version_stations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_version_stations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_sections"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_tasks"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_runs"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_run_assignees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_run_assignees"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_task_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_task_items"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "ops_task_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops_task_events"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "handoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "handoffs"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "handoff_acknowledgements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "handoff_acknowledgements"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- ===========================================================================
-- Grants. 0001's default privileges give the runtime role full DML on new
-- tables, so restriction is an explicit REVOKE (see 0012).
--
--   templates                  retired by status, never deleted
--   versions, sections, tasks,
--   targeting                  DELETE kept for editing a DRAFT; the triggers
--                              refuse it for a published version
--   runs, task items, handoffs retired by status, never deleted
--   task events, assignee
--   history, acknowledgements  append-only
-- ===========================================================================
REVOKE DELETE ON "ops_templates" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "ops_runs" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "ops_task_items" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "handoffs" FROM evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "ops_task_events" FROM evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "ops_run_assignees" FROM evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "handoff_acknowledgements" FROM evercalm_app;--> statement-breakpoint

-- ===========================================================================
-- The worker's discovery function learns one more kind of due work: a run
-- whose shift starts within the hour, with work still to do, whose assignee
-- has not been reminded. Everything else is restated exactly as in 0014.
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
    );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_organizations_with_due_work(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION evercalm_organizations_with_due_work(timestamptz) TO evercalm_app;
