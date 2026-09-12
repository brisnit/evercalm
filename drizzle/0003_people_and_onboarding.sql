CREATE TABLE "employment_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issuing_authority" text,
	"identifier" text,
	"issued_on" date,
	"expires_on" date,
	"verified_at" timestamp with time zone,
	"verified_by_employment_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "employment_credentials_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "separations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"reason_category" text NOT NULL,
	"reason" text NOT NULL,
	"effective_on" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by_employment_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_employment_id" uuid,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_employment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "separations_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "separations_status_check" CHECK (status in ('draft','pending_approval','approved','completed','cancelled')),
	CONSTRAINT "separations_two_person_rule" CHECK (approved_by_employment_id is null or approved_by_employment_id <> requested_by_employment_id)
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "departments_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "departments_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "employment_job_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"job_role_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_job_roles_unique" UNIQUE("organization_id","employment_id","job_role_id")
);
--> statement-breakpoint
CREATE TABLE "job_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"color_token" text DEFAULT 'violet' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "job_roles_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "job_roles_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "organization_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text DEFAULT 'value' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "organization_values_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"job_role_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "stations_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "stations_location_name_unique" UNIQUE("organization_id","location_id","name")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"department_id" uuid,
	"location_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "teams_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"job_title" text,
	"token_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"role_scope" text DEFAULT 'org' NOT NULL,
	"scope_location_id" uuid,
	"home_location_id" uuid,
	"location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by_employment_id" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_employment_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_employment_id" uuid,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_status_check" CHECK (status in ('pending','accepted','revoked','expired')),
	CONSTRAINT "invitations_scope_check" CHECK ((role_scope = 'org' and scope_location_id is null) or (role_scope = 'location' and scope_location_id is not null))
);
--> statement-breakpoint
CREATE TABLE "onboarding_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"template_name" text NOT NULL,
	"started_on" date NOT NULL,
	"due_on" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_assignments_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "onboarding_assignments_one_per_person" UNIQUE("organization_id","employment_id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_step_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"blocked_reason" text,
	"completed_at" timestamp with time zone,
	"completed_by_employment_id" uuid,
	"verified_at" timestamp with time zone,
	"verified_by_employment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_step_progress_unique" UNIQUE("organization_id","assignment_id","step_id"),
	CONSTRAINT "onboarding_step_progress_status_check" CHECK (status in ('pending','completed','blocked','waived'))
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'task' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"due_days" integer,
	"reference_type" text,
	"reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_steps_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "onboarding_steps_kind_check" CHECK (kind in ('task','acknowledge','policy_ack','training','manager_verify','document'))
);
--> statement-breakpoint
CREATE TABLE "onboarding_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"job_role_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "onboarding_templates_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "manager_employment_id" uuid;--> statement-breakpoint
ALTER TABLE "employment_credentials" ADD CONSTRAINT "employment_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_credentials" ADD CONSTRAINT "employment_credentials_employment_tenant_fk" FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separations" ADD CONSTRAINT "separations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separations" ADD CONSTRAINT "separations_employment_tenant_fk" FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_job_roles" ADD CONSTRAINT "employment_job_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_job_roles" ADD CONSTRAINT "employment_job_roles_employment_tenant_fk" FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_job_roles" ADD CONSTRAINT "employment_job_roles_role_tenant_fk" FOREIGN KEY ("organization_id","job_role_id") REFERENCES "public"."job_roles"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_roles" ADD CONSTRAINT "job_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_roles" ADD CONSTRAINT "job_roles_department_tenant_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_values" ADD CONSTRAINT "organization_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_location_tenant_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_job_role_tenant_fk" FOREIGN KEY ("organization_id","job_role_id") REFERENCES "public"."job_roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_tenant_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_location_tenant_fk" FOREIGN KEY ("organization_id","location_id") REFERENCES "public"."locations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_tenant_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_tenant_fk" FOREIGN KEY ("organization_id","invited_by_employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_assignments" ADD CONSTRAINT "onboarding_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_assignments" ADD CONSTRAINT "onboarding_assignments_employment_tenant_fk" FOREIGN KEY ("organization_id","employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_assignments" ADD CONSTRAINT "onboarding_assignments_template_tenant_fk" FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."onboarding_templates"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD CONSTRAINT "onboarding_step_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_step_progress" ADD CONSTRAINT "onboarding_step_progress_assignment_tenant_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."onboarding_assignments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_template_tenant_fk" FOREIGN KEY ("organization_id","template_id") REFERENCES "public"."onboarding_templates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_job_role_tenant_fk" FOREIGN KEY ("organization_id","job_role_id") REFERENCES "public"."job_roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employment_credentials_expiry_idx" ON "employment_credentials" USING btree ("organization_id","expires_on");--> statement-breakpoint
CREATE INDEX "separations_org_status_idx" ON "separations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "departments_org_idx" ON "departments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employment_job_roles_org_idx" ON "employment_job_roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_roles_org_idx" ON "job_roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_values_org_idx" ON "organization_values" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stations_org_idx" ON "stations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teams_org_idx" ON "teams" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_org_status_idx" ON "invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "invitations_org_email_idx" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "onboarding_assignments_org_idx" ON "onboarding_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "onboarding_step_progress_assignment_idx" ON "onboarding_step_progress" USING btree ("organization_id","assignment_id");--> statement-breakpoint
CREATE INDEX "onboarding_steps_template_idx" ON "onboarding_steps" USING btree ("organization_id","template_id");--> statement-breakpoint
CREATE INDEX "onboarding_templates_org_idx" ON "onboarding_templates" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_manager_tenant_fk" FOREIGN KEY ("organization_id","manager_employment_id") REFERENCES "public"."employments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_manager_not_self" CHECK (manager_employment_id is null or manager_employment_id <> id);