-- ===========================================================================
-- Link onboarding training steps to training courses.
--
-- Hand-written. Three changes, each enforced by the database rather than only
-- by the service:
--
--   1. A template step may name a COURSE. Only a `training_assignment` step
--      may, and the course must belong to the same organization.
--   2. A step in someone's onboarding run records the course it was linked to
--      and the exact training ASSIGNMENT that satisfies it. The assignment
--      carries the pinned course version, so the version is fixed the moment
--      onboarding starts and later publications cannot change it.
--   3. Training assignments gain the `onboarding` source, so reports can say
--      where an assignment came from.
--
-- No new table, so no new RLS policy: every column added here lives on a
-- table that already has its tenant_isolation policy and grants.
-- ===========================================================================

ALTER TABLE "onboarding_steps" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_course_tenant_fk"
  FOREIGN KEY ("organization_id","course_id") REFERENCES "public"."courses"("organization_id","id");--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_course_kind_check"
  CHECK (course_id IS NULL OR kind = 'training_assignment');--> statement-breakpoint

ALTER TABLE "onboarding_step_progress" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD COLUMN "training_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD CONSTRAINT "onboarding_step_progress_course_tenant_fk"
  FOREIGN KEY ("organization_id","course_id") REFERENCES "public"."courses"("organization_id","id");--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD CONSTRAINT "onboarding_step_progress_training_tenant_fk"
  FOREIGN KEY ("organization_id","training_assignment_id") REFERENCES "public"."training_assignments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD CONSTRAINT "onboarding_step_progress_training_link_check"
  CHECK (training_assignment_id IS NULL OR (course_id IS NOT NULL AND kind = 'training_assignment'));--> statement-breakpoint
CREATE INDEX "onboarding_step_progress_training_idx"
  ON "onboarding_step_progress" ("organization_id","training_assignment_id")
  WHERE training_assignment_id IS NOT NULL;--> statement-breakpoint

ALTER TABLE "training_assignments" DROP CONSTRAINT "training_assignments_source_check";--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_source_check"
  CHECK (source in ('manual','job_role','onboarding'));--> statement-breakpoint

-- Runs that started before this link existed keep their history. Their
-- training steps were never connected to a course, and saying they wait on
-- "a later release" is no longer true: a person has to act.
UPDATE "onboarding_step_progress"
   SET blocked_reason = 'No course was linked to this step when onboarding started. A manager can assign the course under Training.'
 WHERE kind = 'training_assignment'
   AND status = 'blocked'
   AND training_assignment_id IS NULL;
