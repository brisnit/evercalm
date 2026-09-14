-- ===========================================================================
-- Slice 5: training.
--
-- Hand-written (see 0010 for why the generator cannot run here). Mirrors
-- src/modules/training/schema.ts, plus what Drizzle cannot express:
--
--   1. FROZEN PUBLISHED VERSIONS. A trigger refuses any change to a published
--      course version or to the lessons inside it. The service already only
--      edits drafts; this is the backstop that holds if it ever does not, so
--      what somebody was assigned can never change underneath them.
--   2. Composite keys that tie progress, attempts and sign-offs to the exact
--      version an assignment is pinned to. A lesson from another version, or
--      another course, cannot be recorded against an assignment - and an
--      assignment that has progress cannot be moved to a different version.
--   3. Grants: quiz attempts and sign-off decisions are append-only, and no
--      training record is ever deleted by the application.
--
-- Every table follows the tenant pattern: organization_id, composite
-- (organization_id, id) foreign keys, and a tenant_isolation RLS policy.
-- ===========================================================================

-- --- courses -----------------------------------------------------------------
CREATE TABLE "courses" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "published_version_id" uuid,
  "created_by_employment_id" uuid,
  "archived_at" timestamp with time zone,
  "archived_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "courses_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "courses_status_check" CHECK (status in ('active','archived')),
  CONSTRAINT "courses_archived_check" CHECK ((status = 'archived') = (archived_at is not null))
);--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_tenant_fk"
  FOREIGN KEY ("organization_id","created_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_archived_by_tenant_fk"
  FOREIGN KEY ("organization_id","archived_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_title_unique" ON "courses" ("organization_id",lower("title")) WHERE status = 'active';--> statement-breakpoint

-- --- versions ----------------------------------------------------------------
CREATE TABLE "course_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "title" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "change_note" text DEFAULT '' NOT NULL,
  "published_at" timestamp with time zone,
  "published_by_employment_id" uuid,
  "created_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_versions_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "course_versions_org_id_course_unique" UNIQUE("organization_id","id","course_id"),
  CONSTRAINT "course_versions_number_unique" UNIQUE("organization_id","course_id","version_number"),
  CONSTRAINT "course_versions_number_check" CHECK (version_number >= 1),
  CONSTRAINT "course_versions_status_check" CHECK (status in ('draft','published')),
  CONSTRAINT "course_versions_published_check" CHECK ((status = 'published') = (published_at is not null))
);--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_course_tenant_fk"
  FOREIGN KEY ("organization_id","course_id") REFERENCES "public"."courses"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_published_by_tenant_fk"
  FOREIGN KEY ("organization_id","published_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_created_by_tenant_fk"
  FOREIGN KEY ("organization_id","created_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
-- At most one draft per course, so "the draft" is never ambiguous.
CREATE UNIQUE INDEX "course_versions_one_draft" ON "course_versions" ("organization_id","course_id") WHERE status = 'draft';--> statement-breakpoint

-- The course's current published version must be one of ITS versions.
ALTER TABLE "courses" ADD CONSTRAINT "courses_published_version_tenant_fk"
  FOREIGN KEY ("organization_id","published_version_id","id") REFERENCES "public"."course_versions"("organization_id","id","course_id");--> statement-breakpoint

-- --- lessons -----------------------------------------------------------------
CREATE TABLE "course_lessons" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "estimated_minutes" smallint DEFAULT 5 NOT NULL,
  "content" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_lesson_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_lessons_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "course_lessons_org_id_version_unique" UNIQUE("organization_id","id","version_id"),
  CONSTRAINT "course_lessons_kind_check" CHECK (kind in ('reading','checklist','quiz','practical')),
  CONSTRAINT "course_lessons_minutes_check" CHECK (estimated_minutes between 1 and 240),
  CONSTRAINT "course_lessons_content_check" CHECK (jsonb_typeof(content) = 'object')
);--> statement-breakpoint
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."course_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "course_lessons_version_idx" ON "course_lessons" ("organization_id","version_id","position");--> statement-breakpoint

-- --- assignments -------------------------------------------------------------
CREATE TABLE "training_assignments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "course_version_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "location_id" uuid,
  "source" text DEFAULT 'manual' NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "due_on" date,
  "note" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'assigned' NOT NULL,
  "assigned_by_employment_id" uuid,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_by_employment_id" uuid,
  "cancellation_reason" text DEFAULT '' NOT NULL,
  "previous_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "training_assignments_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "training_assignments_org_id_version_unique" UNIQUE("organization_id","id","course_version_id"),
  CONSTRAINT "training_assignments_source_check" CHECK (source in ('manual','job_role')),
  CONSTRAINT "training_assignments_status_check" CHECK (status in ('assigned','in_progress','completed','cancelled')),
  CONSTRAINT "training_assignments_completed_check" CHECK ((status = 'completed') = (completed_at is not null)),
  CONSTRAINT "training_assignments_cancelled_check" CHECK ((status = 'cancelled') = (cancelled_at is not null)),
  CONSTRAINT "training_assignments_started_check" CHECK (status = 'assigned' or status = 'cancelled' or started_at is not null)
);--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
-- The pinned version must belong to the assigned course.
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_version_tenant_fk"
  FOREIGN KEY ("organization_id","course_version_id","course_id") REFERENCES "public"."course_versions"("organization_id","id","course_id");--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_previous_version_tenant_fk"
  FOREIGN KEY ("organization_id","previous_version_id") REFERENCES "public"."course_versions"("organization_id","id");--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id");--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_assigned_by_tenant_fk"
  FOREIGN KEY ("organization_id","assigned_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_cancelled_by_tenant_fk"
  FOREIGN KEY ("organization_id","cancelled_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
-- One open assignment of a course per person. A completed course may be
-- assigned again later (a refresher); an open one cannot be duplicated.
CREATE UNIQUE INDEX "training_assignments_one_open" ON "training_assignments" ("organization_id","employment_id","course_id") WHERE status in ('assigned','in_progress');--> statement-breakpoint
CREATE INDEX "training_assignments_employment_idx" ON "training_assignments" ("organization_id","employment_id","status");--> statement-breakpoint
CREATE INDEX "training_assignments_course_idx" ON "training_assignments" ("organization_id","course_id","status");--> statement-breakpoint

-- --- lesson progress ---------------------------------------------------------
CREATE TABLE "training_lesson_progress" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "assignment_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "lesson_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "status" text DEFAULT 'in_progress' NOT NULL,
  "checked_item_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "extra_attempts" smallint DEFAULT 0 NOT NULL,
  "signoff_requested_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "training_lesson_progress_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "training_lesson_progress_lesson_unique" UNIQUE("organization_id","assignment_id","lesson_id"),
  CONSTRAINT "training_lesson_progress_status_check" CHECK (status in ('in_progress','awaiting_signoff','returned','completed')),
  CONSTRAINT "training_lesson_progress_completed_check" CHECK ((status = 'completed') = (completed_at is not null)),
  CONSTRAINT "training_lesson_progress_extra_attempts_check" CHECK (extra_attempts between 0 and 20)
);--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
-- Progress belongs to the version the assignment is pinned to...
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_assignment_tenant_fk"
  FOREIGN KEY ("organization_id","assignment_id","version_id") REFERENCES "public"."training_assignments"("organization_id","id","course_version_id") ON DELETE cascade;--> statement-breakpoint
-- ...and to a lesson inside that same version.
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_lesson_tenant_fk"
  FOREIGN KEY ("organization_id","lesson_id","version_id") REFERENCES "public"."course_lessons"("organization_id","id","version_id");--> statement-breakpoint
ALTER TABLE "training_lesson_progress" ADD CONSTRAINT "training_lesson_progress_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "training_lesson_progress_status_idx" ON "training_lesson_progress" ("organization_id","status");--> statement-breakpoint

-- --- quiz attempts -----------------------------------------------------------
CREATE TABLE "training_quiz_attempts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "assignment_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "lesson_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "attempt_number" smallint NOT NULL,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "correct_count" smallint NOT NULL,
  "question_count" smallint NOT NULL,
  "score_percent" smallint NOT NULL,
  "passed" boolean NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "training_quiz_attempts_number_unique" UNIQUE("organization_id","assignment_id","lesson_id","attempt_number"),
  CONSTRAINT "training_quiz_attempts_number_check" CHECK (attempt_number >= 1),
  CONSTRAINT "training_quiz_attempts_score_check" CHECK (score_percent between 0 and 100 and correct_count between 0 and question_count)
);--> statement-breakpoint
ALTER TABLE "training_quiz_attempts" ADD CONSTRAINT "training_quiz_attempts_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "training_quiz_attempts" ADD CONSTRAINT "training_quiz_attempts_assignment_tenant_fk"
  FOREIGN KEY ("organization_id","assignment_id","version_id") REFERENCES "public"."training_assignments"("organization_id","id","course_version_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "training_quiz_attempts" ADD CONSTRAINT "training_quiz_attempts_lesson_tenant_fk"
  FOREIGN KEY ("organization_id","lesson_id","version_id") REFERENCES "public"."course_lessons"("organization_id","id","version_id");--> statement-breakpoint
ALTER TABLE "training_quiz_attempts" ADD CONSTRAINT "training_quiz_attempts_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

-- --- practical sign-offs -----------------------------------------------------
CREATE TABLE "training_signoffs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "progress_id" uuid NOT NULL,
  "assignment_id" uuid NOT NULL,
  "lesson_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "criteria_confirmed" text[] DEFAULT '{}'::text[] NOT NULL,
  "decided_by_employment_id" uuid NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "training_signoffs_decision_check" CHECK (decision in ('verified','returned')),
  -- Nobody signs off their own practical, whatever the application does.
  CONSTRAINT "training_signoffs_not_self_check" CHECK (decided_by_employment_id <> employment_id)
);--> statement-breakpoint
ALTER TABLE "training_signoffs" ADD CONSTRAINT "training_signoffs_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "training_signoffs" ADD CONSTRAINT "training_signoffs_progress_tenant_fk"
  FOREIGN KEY ("organization_id","progress_id") REFERENCES "public"."training_lesson_progress"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "training_signoffs" ADD CONSTRAINT "training_signoffs_assignment_tenant_fk"
  FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."training_assignments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "training_signoffs" ADD CONSTRAINT "training_signoffs_lesson_tenant_fk"
  FOREIGN KEY ("organization_id","lesson_id") REFERENCES "public"."course_lessons"("organization_id","id");--> statement-breakpoint
ALTER TABLE "training_signoffs" ADD CONSTRAINT "training_signoffs_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "training_signoffs" ADD CONSTRAINT "training_signoffs_decided_by_tenant_fk"
  FOREIGN KEY ("organization_id","decided_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "training_signoffs_progress_idx" ON "training_signoffs" ("organization_id","progress_id");--> statement-breakpoint

-- ===========================================================================
-- Frozen published versions.
--
-- SECURITY INVOKER on purpose: the lookups run as whoever made the change,
-- under that caller's tenant policy, and need no privilege of their own.
--
-- A delete is let through only when the organization itself is being deleted
-- (the cascade from organizations), which is the one legitimate way a
-- published version stops existing.
-- ===========================================================================
CREATE FUNCTION evercalm_refuse_published_version_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published'
       AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
      RAISE EXCEPTION 'A published training version cannot be deleted'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'A published training version cannot be changed; start a new draft'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "course_versions_frozen_when_published"
  BEFORE UPDATE OR DELETE ON "course_versions"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_version_change();--> statement-breakpoint

CREATE FUNCTION evercalm_refuse_published_lesson_change()
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
    SELECT 1 FROM public.course_versions
     WHERE id = ANY (touched) AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'Lessons in a published training version cannot be changed; start a new draft'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "course_lessons_frozen_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "course_lessons"
  FOR EACH ROW EXECUTE FUNCTION evercalm_refuse_published_lesson_change();--> statement-breakpoint

REVOKE ALL ON FUNCTION evercalm_refuse_published_version_change() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION evercalm_refuse_published_lesson_change() FROM PUBLIC;--> statement-breakpoint

-- ===========================================================================
-- Row-Level Security. Same predicate as every other tenant table.
-- ===========================================================================
ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "courses"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "course_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "course_versions"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "course_lessons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "course_lessons"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "training_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "training_assignments"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "training_lesson_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "training_lesson_progress"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "training_quiz_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "training_quiz_attempts"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "training_signoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "training_signoffs"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- ===========================================================================
-- Grants. 0001's default privileges give the runtime role full DML on new
-- tables, so restriction is an explicit REVOKE (see 0012).
--
--   courses, assignments, progress   retired by status, never deleted
--   course_versions, course_lessons  DELETE kept for discarding a DRAFT; the
--                                    trigger refuses it for a published one
--   quiz attempts, sign-offs         append-only: the record of what someone
--                                    answered and who vouched for them
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON "courses" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "course_versions" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "course_lessons" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "training_assignments" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "training_lesson_progress" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "training_quiz_attempts" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "training_signoffs" TO evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "courses" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "training_assignments" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "training_lesson_progress" FROM evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "training_quiz_attempts" FROM evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "training_signoffs" FROM evercalm_app;
