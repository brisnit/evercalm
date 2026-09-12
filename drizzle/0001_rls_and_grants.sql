-- ===========================================================================
-- EverCalm - Row-Level Security, privileges, and append-only audit.
--
-- Hand-written on purpose. This file IS the tenant isolation boundary, so it
-- must be reviewable as plain SQL rather than generated from a schema DSL.
--
-- ROLE MODEL
--   evercalm_migrator  owns every object. Runs DDL and seeds. Never serves a
--                      request. As the table owner it is exempt from these
--                      policies, which is what makes migration and seeding
--                      possible.
--   evercalm_app       the runtime role. NOSUPERUSER, NOBYPASSRLS, owns
--                      nothing. Fully subject to every policy below.
--
-- The application asserts at boot that its role is neither superuser nor
-- BYPASSRLS, so a misconfigured connection string fails loudly.
--
-- TENANT PREDICATE
--   nullif(current_setting('app.organization_id', true), '')::uuid
--
--   `true` makes a missing setting return NULL instead of raising. After a
--   transaction ends, the setting reverts to an EMPTY STRING rather than
--   NULL, and ''::uuid raises 22P02 - so nullif() is required, not stylistic.
--   With no tenant context the predicate is NULL, which is not true, so every
--   policy FAILS CLOSED and returns zero rows.
-- ===========================================================================

-- --- Schema privileges -----------------------------------------------------
-- Nothing is granted by default; the runtime role may use the schema but not
-- create objects in it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO evercalm_app;
--> statement-breakpoint

-- ===========================================================================
-- TENANT TABLES
-- Each gets: RLS enabled, one isolation policy covering read and write, and
-- exactly the privileges the runtime needs.
-- ===========================================================================

-- --- organizations (tenant root, keyed by id) ------------------------------
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organizations" TO evercalm_app;--> statement-breakpoint

-- --- locations -------------------------------------------------------------
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "locations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "locations" TO evercalm_app;--> statement-breakpoint

-- --- employments -----------------------------------------------------------
ALTER TABLE "employments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employments"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employments" TO evercalm_app;--> statement-breakpoint

-- --- employment_locations --------------------------------------------------
ALTER TABLE "employment_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employment_locations"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employment_locations" TO evercalm_app;--> statement-breakpoint

-- --- roles -----------------------------------------------------------------
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roles"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "roles" TO evercalm_app;--> statement-breakpoint

-- --- role_capabilities -----------------------------------------------------
ALTER TABLE "role_capabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "role_capabilities"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "role_capabilities" TO evercalm_app;--> statement-breakpoint

-- --- role_grants -----------------------------------------------------------
ALTER TABLE "role_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "role_grants"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "role_grants" TO evercalm_app;--> statement-breakpoint

-- --- audit_events (APPEND-ONLY) --------------------------------------------
-- Platform-scoped rows carry organization_id IS NULL. NULL never equals a
-- tenant id, so those rows are invisible to every tenant by construction.
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_events"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

-- Platform-scoped identity events (sign-in) are written with no tenant
-- context. A separate INSERT-only policy permits exactly that and nothing
-- more: it cannot be used to write a row attributed to a tenant.
CREATE POLICY "platform_scoped_insert" ON "audit_events"
  FOR INSERT
  WITH CHECK ("organization_id" IS NULL);--> statement-breakpoint

-- The runtime role can append and read. It CANNOT update or delete, so a
-- compromised application cannot rewrite history.
GRANT SELECT, INSERT ON "audit_events" TO evercalm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "audit_events" FROM evercalm_app;--> statement-breakpoint

-- ===========================================================================
-- GLOBAL IDENTITY TABLES
-- No organization_id and no tenant policy: authentication resolves before an
-- organization context exists. Documented as exempt in tenant-tables.ts and
-- asserted by the RLS coverage test.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "user" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account" TO evercalm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "verification" TO evercalm_app;--> statement-breakpoint

-- ===========================================================================
-- Future tables created by the migration role are readable/writable by the
-- runtime role by default. RLS still has to be added explicitly, and the
-- coverage test fails CI if it is not.
-- ===========================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE evercalm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO evercalm_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE evercalm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO evercalm_app;
