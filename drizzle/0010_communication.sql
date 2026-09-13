-- ===========================================================================
-- Slice 3: announcements, notifications, and the event foundation.
--
-- Hand-written rather than generated. `drizzle-kit generate` cannot run
-- non-interactively here: the snapshot drifted when 0006 hand-restructured the
-- onboarding tables, so the generator now asks rename-or-create questions
-- about tables this migration does not touch. The schema in
-- src/modules/{comms,events,notifications}/schema.ts is the source of truth and
-- this file mirrors it exactly; the RLS coverage test proves no tenant table
-- was missed either way.
--
-- Table order matters: events before announcements (announcements reference
-- an event), categories before announcements, announcements before their
-- revisions, audience, and recipients.
-- ===========================================================================

-- --- team membership -------------------------------------------------------
-- Teams existed; membership did not. Announcement targeting is the first
-- feature that needs to name a group of people who are not simply everyone
-- holding a job role.
CREATE TABLE "employment_teams" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "employment_teams_unique" UNIQUE("organization_id","employment_id","team_id")
);--> statement-breakpoint
ALTER TABLE "employment_teams" ADD CONSTRAINT "employment_teams_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "employment_teams" ADD CONSTRAINT "employment_teams_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "employment_teams" ADD CONSTRAINT "employment_teams_team_tenant_fk"
  FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "employment_teams_org_idx" ON "employment_teams" ("organization_id");--> statement-breakpoint

-- --- events ----------------------------------------------------------------
CREATE TABLE "events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "location_id" uuid,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "kind" text DEFAULT 'general' NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone,
  "all_day" boolean DEFAULT false NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "created_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "events_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "events_kind_check" CHECK (kind in ('large_party','training','inspection','promotion','general')),
  CONSTRAINT "events_end_after_start" CHECK (ends_at is null or ends_at >= starts_at)
);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "events_org_start_idx" ON "events" ("organization_id","starts_at");--> statement-breakpoint

-- --- announcement categories ----------------------------------------------
-- Rows, not a code enum, so a tenant can rename or extend them later.
CREATE TABLE "announcement_categories" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "overrides_preferences" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "announcement_categories_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "announcement_categories_org_key_unique" UNIQUE("organization_id","key")
);--> statement-breakpoint
ALTER TABLE "announcement_categories" ADD CONSTRAINT "announcement_categories_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "announcement_categories_org_idx" ON "announcement_categories" ("organization_id");--> statement-breakpoint

-- --- announcements ---------------------------------------------------------
CREATE TABLE "announcements" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "current_revision_id" uuid,
  "requires_acknowledgement" boolean DEFAULT false NOT NULL,
  "acknowledgement_due_at" timestamp with time zone,
  "publish_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "event_id" uuid,
  "created_by_employment_id" uuid,
  "updated_by_employment_id" uuid,
  "published_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  "archived_by_employment_id" uuid,
  CONSTRAINT "announcements_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "announcements_status_check" CHECK (status in ('draft','scheduled','published','expired','archived')),
  CONSTRAINT "announcements_priority_check" CHECK (priority in ('normal','important','urgent','emergency')),
  CONSTRAINT "announcements_scheduled_needs_time" CHECK (status <> 'scheduled' or publish_at is not null),
  CONSTRAINT "announcements_ack_deadline_needs_ack" CHECK (acknowledgement_due_at is null or requires_acknowledgement)
);--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_category_tenant_fk"
  FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."announcement_categories"("organization_id","id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_event_tenant_fk"
  FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "announcements_org_status_idx" ON "announcements" ("organization_id","status");--> statement-breakpoint
CREATE INDEX "announcements_publish_at_idx" ON "announcements" ("publish_at");--> statement-breakpoint

-- --- revisions -------------------------------------------------------------
-- Immutable content history. An acknowledgement points at the exact wording
-- it was made against.
CREATE TABLE "announcement_revisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "announcement_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "call_to_action_label" text,
  "call_to_action_href" text,
  "is_material" boolean DEFAULT false NOT NULL,
  "note" text,
  "created_by_employment_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "announcement_revisions_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "announcement_revisions_number_unique" UNIQUE("organization_id","announcement_id","revision_number")
);--> statement-breakpoint
ALTER TABLE "announcement_revisions" ADD CONSTRAINT "announcement_revisions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "announcement_revisions" ADD CONSTRAINT "announcement_revisions_announcement_tenant_fk"
  FOREIGN KEY ("organization_id","announcement_id") REFERENCES "public"."announcements"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "announcement_revisions_announcement_idx" ON "announcement_revisions" ("organization_id","announcement_id");--> statement-breakpoint

-- --- audience rules --------------------------------------------------------
CREATE TABLE "announcement_audience" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "announcement_id" uuid NOT NULL,
  "mode" text DEFAULT 'include' NOT NULL,
  "selector_type" text NOT NULL,
  "selector_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "announcement_audience_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "announcement_audience_rule_unique" UNIQUE("organization_id","announcement_id","mode","selector_type","selector_id"),
  CONSTRAINT "announcement_audience_mode_check" CHECK (mode in ('include','exclude')),
  CONSTRAINT "announcement_audience_selector_check" CHECK (selector_type in ('organization','location','department','job_role','team','station','employment')),
  CONSTRAINT "announcement_audience_target_check" CHECK ((selector_type = 'organization') = (selector_id is null))
);--> statement-breakpoint
ALTER TABLE "announcement_audience" ADD CONSTRAINT "announcement_audience_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "announcement_audience" ADD CONSTRAINT "announcement_audience_announcement_tenant_fk"
  FOREIGN KEY ("organization_id","announcement_id") REFERENCES "public"."announcements"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "announcement_audience_announcement_idx" ON "announcement_audience" ("organization_id","announcement_id");--> statement-breakpoint

-- --- recipients ------------------------------------------------------------
-- The unique constraint on (organization, announcement, employment) is the
-- idempotency guarantee: publishing twice, retrying, or syncing later cannot
-- duplicate anybody.
CREATE TABLE "announcement_recipients" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "announcement_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "location_id_at_publish" uuid,
  "department_id_at_publish" uuid,
  "job_role_id_at_publish" uuid,
  "delivery_status" text DEFAULT 'pending' NOT NULL,
  "delivery_failure_reason" text,
  "delivered_at" timestamp with time zone,
  "first_viewed_at" timestamp with time zone,
  "last_viewed_at" timestamp with time zone,
  "view_count" integer DEFAULT 0 NOT NULL,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_revision_id" uuid,
  "reacknowledgement_requested_at" timestamp with time zone,
  "reminder_count" integer DEFAULT 0 NOT NULL,
  "last_reminded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "announcement_recipients_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "announcement_recipients_person_unique" UNIQUE("organization_id","announcement_id","employment_id"),
  CONSTRAINT "announcement_recipients_delivery_check" CHECK (delivery_status in ('pending','sent','failed','suppressed'))
);--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_tenant_fk"
  FOREIGN KEY ("organization_id","announcement_id") REFERENCES "public"."announcements"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_location_tenant_fk"
  FOREIGN KEY ("organization_id","location_id_at_publish") REFERENCES "public"."locations"("organization_id","id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "announcement_recipients_announcement_idx" ON "announcement_recipients" ("organization_id","announcement_id");--> statement-breakpoint
CREATE INDEX "announcement_recipients_inbox_idx" ON "announcement_recipients" ("organization_id","employment_id");--> statement-breakpoint

-- --- notifications ---------------------------------------------------------
-- A delivery record carries a pointer and a short preview, never the content
-- and never anything about the person beyond their employment id.
CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid,
  "title" text NOT NULL,
  "preview" text DEFAULT '' NOT NULL,
  "href" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "mandatory" boolean DEFAULT false NOT NULL,
  "scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "failure_reason" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "read_at" timestamp with time zone,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "notifications_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
  CONSTRAINT "notifications_status_check" CHECK (status in ('pending','sent','failed','suppressed','cancelled')),
  CONSTRAINT "notifications_channel_check" CHECK (channel in ('in_app','email','sms','push'))
);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" ("organization_id","employment_id","status");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" ("status","scheduled_for");--> statement-breakpoint

-- --- notification preferences ----------------------------------------------
CREATE TABLE "notification_preferences" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preferences_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "notification_preferences_unique" UNIQUE("organization_id","employment_id","category","channel"),
  CONSTRAINT "notification_preferences_channel_check" CHECK (channel in ('in_app','email','sms','push'))
);--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "notification_preferences_employment_idx" ON "notification_preferences" ("organization_id","employment_id");--> statement-breakpoint

-- --- notification settings (quiet hours) -----------------------------------
CREATE TABLE "notification_settings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "employment_id" uuid NOT NULL,
  "quiet_hours_enabled" boolean DEFAULT false NOT NULL,
  "quiet_hours_start_minute" integer DEFAULT 1320 NOT NULL,
  "quiet_hours_end_minute" integer DEFAULT 420 NOT NULL,
  "timezone" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_settings_org_id_unique" UNIQUE("organization_id","id"),
  CONSTRAINT "notification_settings_employment_unique" UNIQUE("organization_id","employment_id"),
  CONSTRAINT "notification_settings_start_range" CHECK (quiet_hours_start_minute between 0 and 1439),
  CONSTRAINT "notification_settings_end_range" CHECK (quiet_hours_end_minute between 0 and 1439)
);--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_employment_tenant_fk"
  FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade;
