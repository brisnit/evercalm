-- ===========================================================================
-- 0024 · The document hub.
--
--   One list of the things an operator is asked for and cannot find: the
--   handbook, the allergen matrix, the cleaning schedule. Each row carries who
--   it is for (everyone, or managers only) and where it applies (one location,
--   or the whole organization).
--
--   THE BYTES. The file is stored here, in the tenant database, behind the
--   same row-level security as everything else, and served by a route that
--   authorizes every request. That makes the hub genuinely work rather than
--   pretend to, and it is bounded on purpose: 8 MB a file, enforced by a check
--   constraint rather than by the form. Production belongs on object storage
--   with short-lived signed URLs; that move is written down in
--   docs/STAKEHOLDER-DEMO-DEFERRED.md rather than left implicit.
--
--   Additive only.
-- ===========================================================================

CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "category" text DEFAULT 'other' NOT NULL,
  "visibility" text DEFAULT 'everyone' NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "content" bytea NOT NULL,
  "uploaded_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "documents_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "documents_visibility_check" CHECK ("visibility" in ('everyone', 'managers')),
  CONSTRAINT "documents_category_check" CHECK ("category" in ('policy','safety','training','operations','legal','other')),
  CONSTRAINT "documents_size_check" CHECK ("byte_size" > 0 and "byte_size" <= 8388608)
);--> statement-breakpoint

ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploader_tenant_fk"
  FOREIGN KEY ("organization_id","uploaded_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" ("organization_id","archived_at");--> statement-breakpoint

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
