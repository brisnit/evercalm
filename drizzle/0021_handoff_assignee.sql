-- ===========================================================================
-- 0021 · Handoffs can be assigned to a person.
--
--   Stakeholder round 1 simplified a handoff to "Task" and "Assigned to". The
--   assignee is optional (a handoff can still be for whoever is on next), must
--   belong to the same organization (tenant-scoped foreign key), and is chosen
--   from people who work at the handoff's location - checked by the service.
--   Additive only: existing handoffs keep a null assignee. RLS, the tenant
--   isolation policy and the refusal of DELETE on this table are unchanged.
-- ===========================================================================

ALTER TABLE "handoffs" ADD COLUMN "assigned_employment_id" uuid;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_assignee_tenant_fk"
  FOREIGN KEY ("organization_id","assigned_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "handoffs_assignee_idx" ON "handoffs" ("organization_id","assigned_employment_id","status");
