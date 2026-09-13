-- ===========================================================================
-- Row-Level Security for the Slice 3 tables.
--
-- Same predicate as every other tenant table. `nullif` is required, not
-- stylistic: after a transaction the setting reverts to an EMPTY STRING and
-- ''::uuid raises 22P02, so without it the policy would error instead of
-- failing closed.
--
-- The RLS coverage test derives its list from the schema, so any table added
-- here and forgotten below fails CI rather than shipping unprotected.
-- ===========================================================================

ALTER TABLE "employment_teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employment_teams"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employment_teams" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "events"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "events" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "announcement_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "announcement_categories"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "announcement_categories" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "announcements"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "announcements" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "announcement_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "announcement_revisions"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
-- NOTE: this GRANT is not a restriction. 0001 sets ALTER DEFAULT PRIVILEGES
-- granting full DML on every table created afterwards, so narrowing needs an
-- explicit REVOKE - which migration 0012 does for DELETE on this table.
GRANT SELECT, INSERT ON "announcement_revisions" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "announcement_audience" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "announcement_audience"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "announcement_audience" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "announcement_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "announcement_recipients"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
-- A receipt is the evidence that somebody was told something and whether they
-- acknowledged it. DELETE is taken away in 0012; see the note above for why a
-- narrower GRANT here would not have done it.
GRANT SELECT, INSERT, UPDATE ON "announcement_recipients" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notifications" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_preferences"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preferences" TO evercalm_app;--> statement-breakpoint

ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_settings"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification_settings" TO evercalm_app;
