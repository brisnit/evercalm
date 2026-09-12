-- ===========================================================================
-- EverCalm - Row-Level Security and privileges for the Slice 2 tables.
--
-- Hand-written, like 0001, because this file is part of the tenant isolation
-- boundary and must be reviewable as plain SQL.
--
-- The predicate is identical to 0001:
--   nullif(current_setting('app.organization_id', true), '')::uuid
-- `nullif` is required, not stylistic: after a transaction the setting reverts
-- to an EMPTY STRING, and ''::uuid raises 22P02. With nullif the predicate is
-- NULL, which is never true, so every policy FAILS CLOSED.
--
-- `invitations` gets an extra consideration. Acceptance has to find an
-- invitation by token hash BEFORE any tenant context exists, so it cannot go
-- through these policies. It uses a SECURITY DEFINER function (see 0005)
-- rather than a weakened policy - a policy permissive enough for acceptance
-- would be permissive enough to enumerate.
-- ===========================================================================

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "departments"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "departments" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "job_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "job_roles"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_roles" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "teams"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "teams" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "stations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stations" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "employment_job_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employment_job_roles"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employment_job_roles" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "organization_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organization_values"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_values" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "onboarding_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_templates"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_templates" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "onboarding_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_steps"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_steps" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "onboarding_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_assignments"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_assignments" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "onboarding_step_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_step_progress"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_step_progress" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "employment_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employment_credentials"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employment_credentials" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "separations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "separations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "separations" TO evercalm_app;--> statement-breakpoint

-- Separations are an employment record with legal weight. The runtime role may
-- create, advance and cancel them, but must never be able to erase one: a
-- deleted separation record would hide who requested and who approved it.
REVOKE DELETE ON "separations" FROM evercalm_app;
