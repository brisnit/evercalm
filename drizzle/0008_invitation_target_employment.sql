-- ===========================================================================
-- Invitations that attach to an EXISTING employment.
--
-- Bulk import creates employment records first, so those people already exist
-- in the directory before they have an account. An invitation for one of them
-- must LINK the identity to the existing employment rather than create a
-- second one - otherwise accepting would duplicate the person.
--
-- `target_employment_id` is NULL for an ordinary invitation, which still
-- creates the employment on acceptance.
-- ===========================================================================

ALTER TABLE "invitations" ADD COLUMN "target_employment_id" uuid;--> statement-breakpoint

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_target_employment_tenant_fk"
  FOREIGN KEY ("organization_id","target_employment_id")
  REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;
