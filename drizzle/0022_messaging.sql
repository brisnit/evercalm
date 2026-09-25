-- ===========================================================================
-- 0022 · Channels and direct messages.
--
--   Round 2 asks for three ways to talk, not one: announcements (already
--   here), at most two custom channels, and a direct conversation between a
--   manager and a person who works for them.
--
--   Additive only. Nothing existing is altered, and the announcement tables
--   are untouched. Every new table carries organization_id and the same
--   tenant_isolation policy as the rest of the database, so the RLS coverage
--   test accounts for them automatically.
--
--   The two-channel ceiling is a product rule and lives in the service, where
--   it can say why in English. What the database guarantees is that a channel
--   name is unique inside an organization, and that a direct thread between
--   two people is one row: participant_one_id < participant_two_id, so the
--   pair has a canonical order and a unique index.
-- ===========================================================================

CREATE TABLE "channels" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "purpose" text,
  "audience" text NOT NULL,
  "created_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "channels_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "channels_name_unique" UNIQUE("organization_id","name"),
  CONSTRAINT "channels_audience_check" CHECK ("audience" in ('managers', 'everyone'))
);--> statement-breakpoint

CREATE TABLE "channel_messages" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "author_employment_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "direct_threads" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "participant_one_id" uuid NOT NULL,
  "participant_two_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_at" timestamp with time zone,
  CONSTRAINT "direct_threads_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "direct_threads_pair_unique" UNIQUE("organization_id","participant_one_id","participant_two_id"),
  CONSTRAINT "direct_threads_ordered_check" CHECK ("participant_one_id" < "participant_two_id")
);--> statement-breakpoint

CREATE TABLE "direct_messages" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "author_employment_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_tenant_fk"
  FOREIGN KEY ("organization_id","created_by_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint

ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_tenant_fk"
  FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channels"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_author_tenant_fk"
  FOREIGN KEY ("organization_id","author_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint

ALTER TABLE "direct_threads" ADD CONSTRAINT "direct_threads_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "direct_threads" ADD CONSTRAINT "direct_threads_one_tenant_fk"
  FOREIGN KEY ("organization_id","participant_one_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint
ALTER TABLE "direct_threads" ADD CONSTRAINT "direct_threads_two_tenant_fk"
  FOREIGN KEY ("organization_id","participant_two_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint

ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_thread_tenant_fk"
  FOREIGN KEY ("organization_id","thread_id") REFERENCES "public"."direct_threads"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_author_tenant_fk"
  FOREIGN KEY ("organization_id","author_employment_id") REFERENCES "public"."employments"("organization_id","id");--> statement-breakpoint

-- A channel's messages are read newest-first; a thread's oldest-first. One
-- index per access path, both keyed on the tenant so RLS can use them.
CREATE INDEX "channels_org_idx" ON "channels" ("organization_id","archived_at");--> statement-breakpoint
CREATE INDEX "channel_messages_channel_idx" ON "channel_messages" ("organization_id","channel_id","created_at");--> statement-breakpoint
CREATE INDEX "direct_threads_recent_idx" ON "direct_threads" ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "direct_messages_thread_idx" ON "direct_messages" ("organization_id","thread_id","created_at");--> statement-breakpoint

-- ===========================================================================
-- Row-Level Security. Identical to every other tenant table: a session can
-- only see rows for the organization it set.
-- ===========================================================================

ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channels"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "channel_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channel_messages"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "direct_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "direct_threads"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "direct_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "direct_messages"
  USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
