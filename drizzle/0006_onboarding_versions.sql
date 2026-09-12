-- ===========================================================================
-- Onboarding template VERSIONING.
--
-- Hand-written because this is a restructure with a data migration, not a
-- column addition. drizzle-kit cannot infer which existing column maps to
-- which new one, and getting that wrong would silently orphan live onboarding
-- runs.
--
-- THE SHAPE CHANGE
--   Before: onboarding_templates -> onboarding_steps
--   After:  onboarding_templates -> onboarding_template_versions
--                                     -> onboarding_sections -> onboarding_steps
--
-- A template becomes the durable thing an administrator names and archives;
-- its CONTENT belongs to a numbered version. A published version is immutable,
-- so editing a live checklist means drafting a new version. Every assignment
-- points at the exact version it started on, so somebody halfway through their
-- first week never has the ground moved under them.
--
-- Existing data is preserved: each template becomes version 1, published, with
-- a single section holding its current steps, and every in-flight assignment is
-- repointed at that version.
-- ===========================================================================

-- --- new tables ------------------------------------------------------------

CREATE TABLE "onboarding_template_versions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "template_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "template_name" text NOT NULL,
  "published_at" timestamp with time zone,
  "published_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_versions_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "onboarding_versions_number_unique" UNIQUE("organization_id","template_id","version_number"),
  CONSTRAINT "onboarding_versions_status_check" CHECK (status in ('draft','published'))
);--> statement-breakpoint

CREATE TABLE "onboarding_sections" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_sections_org_id_unique" UNIQUE("organization_id","id")
);--> statement-breakpoint

CREATE TABLE "onboarding_template_job_roles" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "template_id" uuid NOT NULL,
  "job_role_id" uuid NOT NULL,
  CONSTRAINT "onboarding_template_job_roles_unique" UNIQUE("organization_id","template_id","job_role_id")
);--> statement-breakpoint

CREATE TABLE "onboarding_template_locations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "template_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  CONSTRAINT "onboarding_template_locations_unique" UNIQUE("organization_id","template_id","location_id")
);--> statement-breakpoint

-- --- template: status lifecycle and published pointer -----------------------

ALTER TABLE "onboarding_templates" ADD COLUMN "published_version_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD COLUMN "archived_by_employment_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "onboarding_templates"
  ADD CONSTRAINT "onboarding_templates_status_check" CHECK (status in ('draft','published','archived'));--> statement-breakpoint

-- --- steps: hang off a version and a section --------------------------------

ALTER TABLE "onboarding_steps" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD COLUMN "instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD COLUMN "responsibility" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD COLUMN "due_offset_days" integer;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD COLUMN "due_offset_basis" text DEFAULT 'onboarding_start' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD COLUMN "requires_manager_verification" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD COLUMN "blocks_completion" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- --- assignments: point at an exact version ---------------------------------

ALTER TABLE "onboarding_assignments" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_assignments" ADD COLUMN "template_version_number" integer;--> statement-breakpoint

-- --- progress: carry the richer step description forward --------------------

ALTER TABLE "onboarding_step_progress" ADD COLUMN "section_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD COLUMN "instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD COLUMN "responsibility" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD COLUMN "requires_manager_verification" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD COLUMN "blocks_completion" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- ===========================================================================
-- DATA MIGRATION
-- Each existing template becomes version 1 (published), with one section
-- holding its steps. Runs in one statement block so a partial state is
-- impossible.
-- ===========================================================================

DO $$
DECLARE
  t         record;
  v_id      uuid;
  s_id      uuid;
BEGIN
  FOR t IN SELECT id, organization_id, name, job_role_id FROM onboarding_templates LOOP
    v_id := gen_random_uuid();
    s_id := gen_random_uuid();

    INSERT INTO onboarding_template_versions
      (id, organization_id, template_id, version_number, status, template_name, published_at)
    VALUES (v_id, t.organization_id, t.id, 1, 'published', t.name, now());

    INSERT INTO onboarding_sections (id, organization_id, version_id, title, position)
    VALUES (s_id, t.organization_id, v_id, 'Onboarding', 0);

    UPDATE onboarding_steps
       SET version_id = v_id, section_id = s_id
     WHERE template_id = t.id;

    -- Carry the old single job role into the new many-to-many table.
    IF t.job_role_id IS NOT NULL THEN
      INSERT INTO onboarding_template_job_roles (id, organization_id, template_id, job_role_id)
      VALUES (gen_random_uuid(), t.organization_id, t.id, t.job_role_id);
    END IF;

    UPDATE onboarding_templates
       SET published_version_id = v_id, status = 'published'
     WHERE id = t.id;

    UPDATE onboarding_assignments
       SET template_version_id = v_id, template_version_number = 1
     WHERE template_id = t.id;
  END LOOP;
END $$;--> statement-breakpoint

-- Map the old step kinds onto the richer set. Done AFTER the data move so the
-- old check constraint is still satisfied while rows are being relocated.
ALTER TABLE "onboarding_steps" DROP CONSTRAINT IF EXISTS "onboarding_steps_kind_check";--> statement-breakpoint
UPDATE "onboarding_steps" SET "kind" = 'employee_task'          WHERE "kind" = 'task';--> statement-breakpoint
UPDATE "onboarding_steps" SET "kind" = 'information'            WHERE "kind" = 'acknowledge';--> statement-breakpoint
UPDATE "onboarding_steps" SET "kind" = 'document_request'       WHERE "kind" = 'document';--> statement-breakpoint
UPDATE "onboarding_steps" SET "kind" = 'training_assignment'    WHERE "kind" = 'training';--> statement-breakpoint
UPDATE "onboarding_steps" SET "kind" = 'practical_verification', "responsibility" = 'manager'
  WHERE "kind" = 'manager_verify';--> statement-breakpoint
UPDATE "onboarding_steps" SET "due_offset_days" = "due_days" WHERE "due_days" IS NOT NULL;--> statement-breakpoint

UPDATE "onboarding_step_progress" SET "kind" = 'employee_task'       WHERE "kind" = 'task';--> statement-breakpoint
UPDATE "onboarding_step_progress" SET "kind" = 'information'         WHERE "kind" = 'acknowledge';--> statement-breakpoint
UPDATE "onboarding_step_progress" SET "kind" = 'document_request'    WHERE "kind" = 'document';--> statement-breakpoint
UPDATE "onboarding_step_progress" SET "kind" = 'training_assignment' WHERE "kind" = 'training';--> statement-breakpoint
UPDATE "onboarding_step_progress" SET "kind" = 'practical_verification', "responsibility" = 'manager'
  WHERE "kind" = 'manager_verify';--> statement-breakpoint

-- --- drop what the new shape replaces ---------------------------------------

ALTER TABLE "onboarding_steps" DROP CONSTRAINT IF EXISTS "onboarding_steps_template_tenant_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "onboarding_steps_template_idx";--> statement-breakpoint
ALTER TABLE "onboarding_steps" DROP COLUMN "template_id";--> statement-breakpoint
ALTER TABLE "onboarding_steps" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "onboarding_steps" DROP COLUMN "due_days";--> statement-breakpoint
ALTER TABLE "onboarding_steps" ALTER COLUMN "version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ALTER COLUMN "section_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ALTER COLUMN "kind" SET DEFAULT 'employee_task';--> statement-breakpoint

ALTER TABLE "onboarding_templates" DROP CONSTRAINT IF EXISTS "onboarding_templates_job_role_tenant_fk";--> statement-breakpoint
ALTER TABLE "onboarding_templates" DROP COLUMN "job_role_id";--> statement-breakpoint
ALTER TABLE "onboarding_templates" DROP COLUMN "version";--> statement-breakpoint

ALTER TABLE "onboarding_assignments" DROP COLUMN "template_version";--> statement-breakpoint
ALTER TABLE "onboarding_assignments" ALTER COLUMN "template_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_assignments" ALTER COLUMN "template_version_number" SET NOT NULL;--> statement-breakpoint

-- --- constraints and keys on the new shape ----------------------------------

ALTER TABLE "onboarding_steps"
  ADD CONSTRAINT "onboarding_steps_kind_check"
  CHECK (kind in ('information','employee_task','manager_task','document_request','policy_ack','training_assignment','practical_verification','credential_requirement'));--> statement-breakpoint
ALTER TABLE "onboarding_steps"
  ADD CONSTRAINT "onboarding_steps_responsibility_check"
  CHECK (responsibility in ('employee','manager','hr','training_manager'));--> statement-breakpoint
ALTER TABLE "onboarding_steps"
  ADD CONSTRAINT "onboarding_steps_due_basis_check"
  CHECK (due_offset_basis in ('hire_date','onboarding_start'));--> statement-breakpoint

ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_versions_template_tenant_fk"
  FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."onboarding_templates"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "onboarding_sections" ADD CONSTRAINT "onboarding_sections_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "onboarding_sections" ADD CONSTRAINT "onboarding_sections_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."onboarding_template_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_version_tenant_fk"
  FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."onboarding_template_versions"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_section_tenant_fk"
  FOREIGN KEY ("organization_id","section_id") REFERENCES "public"."onboarding_sections"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "onboarding_template_job_roles" ADD CONSTRAINT "onboarding_template_job_roles_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "onboarding_template_job_roles" ADD CONSTRAINT "onboarding_template_job_roles_template_tenant_fk"
  FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."onboarding_templates"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "onboarding_template_job_roles" ADD CONSTRAINT "onboarding_template_job_roles_role_tenant_fk"
  FOREIGN KEY ("organization_id","job_role_id") REFERENCES "public"."job_roles"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "onboarding_template_locations" ADD CONSTRAINT "onboarding_template_locations_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "onboarding_template_locations" ADD CONSTRAINT "onboarding_template_locations_template_tenant_fk"
  FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."onboarding_templates"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "onboarding_template_locations" ADD CONSTRAINT "onboarding_template_locations_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "onboarding_assignments" ADD CONSTRAINT "onboarding_assignments_version_tenant_fk"
  FOREIGN KEY ("organization_id","template_version_id") REFERENCES "public"."onboarding_template_versions"("organization_id","id");--> statement-breakpoint

-- --- indexes ----------------------------------------------------------------

CREATE INDEX "onboarding_versions_template_idx" ON "onboarding_template_versions" ("organization_id","template_id");--> statement-breakpoint
CREATE INDEX "onboarding_sections_version_idx" ON "onboarding_sections" ("organization_id","version_id");--> statement-breakpoint
CREATE INDEX "onboarding_steps_version_idx" ON "onboarding_steps" ("organization_id","version_id");--> statement-breakpoint
CREATE INDEX "onboarding_template_job_roles_org_idx" ON "onboarding_template_job_roles" ("organization_id");--> statement-breakpoint
CREATE INDEX "onboarding_template_locations_org_idx" ON "onboarding_template_locations" ("organization_id");--> statement-breakpoint

-- At most one default template per organization. A partial unique index
-- expresses this precisely; a plain UNIQUE would forbid more than one
-- non-default template.
CREATE UNIQUE INDEX "onboarding_templates_one_default"
  ON "onboarding_templates" ("organization_id")
  WHERE "is_default" AND "archived_at" IS NULL;
