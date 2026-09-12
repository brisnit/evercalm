-- ===========================================================================
-- Row-Level Security for the onboarding versioning tables.
--
-- Same predicate as every other tenant table. `nullif` is required, not
-- stylistic: after a transaction the setting reverts to an EMPTY STRING and
-- ''::uuid raises 22P02, so without it the policy would error instead of
-- failing closed.
-- ===========================================================================

ALTER TABLE "onboarding_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_template_versions"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_template_versions" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "onboarding_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_sections"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_sections" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "onboarding_template_job_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_template_job_roles"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_template_job_roles" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "onboarding_template_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_template_locations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_template_locations" TO evercalm_app;
