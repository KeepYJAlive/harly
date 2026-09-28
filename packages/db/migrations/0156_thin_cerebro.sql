CREATE TYPE "public"."assessment_assignment_status" AS ENUM('assigned', 'started', 'completed', 'expired', 'cancelled', 'error');--> statement-breakpoint
CREATE TABLE "assessment_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "application_id" uuid NOT NULL,
        "assessment_definition_id" uuid NOT NULL,
        "external_execution_id" text,
        "status" "assessment_assignment_status" DEFAULT 'assigned' NOT NULL,
        "score" double precision,
        "max_score" double precision,
        "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
        "started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "synced_at" timestamp with time zone,
        "expires_at" timestamp with time zone,
        "launch_token_hash" text NOT NULL,
        "assigned_by_id" text,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "assessment_assignments_launch_token_hash_unique" UNIQUE("launch_token_hash")
);
--> statement-breakpoint
CREATE TABLE "assessment_definitions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "provider" text DEFAULT 'tao' NOT NULL,
        "external_id" text NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "active" boolean DEFAULT true NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "assessment_definitions_provider_check" CHECK ("assessment_definitions"."provider" = 'tao')
);
--> statement-breakpoint
CREATE TABLE "assessment_lti_launches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "assignment_id" uuid NOT NULL,
        "login_hint_hash" text NOT NULL,
        "state_hash" text,
        "nonce_hash" text,
        "return_token_hash" text NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "return_expires_at" timestamp with time zone NOT NULL,
        "consumed_at" timestamp with time zone,
        "returned_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "assessment_lti_launches_login_hint_hash_unique" UNIQUE("login_hint_hash"),
        CONSTRAINT "assessment_lti_launches_state_hash_unique" UNIQUE("state_hash"),
        CONSTRAINT "assessment_lti_launches_nonce_hash_unique" UNIQUE("nonce_hash"),
        CONSTRAINT "assessment_lti_launches_return_token_hash_unique" UNIQUE("return_token_hash")
);
--> statement-breakpoint
CREATE TABLE "tao_lti_signing_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" text NOT NULL,
        "kid" text NOT NULL,
        "private_key_ciphertext" text NOT NULL,
        "private_key_iv" text NOT NULL,
        "private_key_tag" text NOT NULL,
        "public_jwk" jsonb NOT NULL,
        "active" boolean DEFAULT true NOT NULL,
        "retired_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "tao_lti_signing_keys_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint

-- This unique index MUST exist before assessment_assignments_org_definition_fk
-- because PostgreSQL requires the referenced column pair to be unique.
CREATE UNIQUE INDEX "assessment_definitions_org_id_uidx" ON "assessment_definitions" USING btree ("organization_id","id");--> statement-breakpoint

ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_assessment_definition_id_assessment_definitions_id_fk" FOREIGN KEY ("assessment_definition_id") REFERENCES "public"."assessment_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_assigned_by_id_user_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_org_definition_fk" FOREIGN KEY ("organization_id","assessment_definition_id") REFERENCES "public"."assessment_definitions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "assessment_assignments_active_application_definition_uidx" ON "assessment_assignments" USING btree ("organization_id","application_id","assessment_definition_id") WHERE "assessment_assignments"."status" in ('assigned', 'started');--> statement-breakpoint

ALTER TABLE "assessment_definitions" ADD CONSTRAINT "assessment_definitions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_lti_launches" ADD CONSTRAINT "assessment_lti_launches_assignment_id_assessment_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assessment_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tao_lti_signing_keys" ADD CONSTRAINT "tao_lti_signing_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "assessment_assignments_org_idx" ON "assessment_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "assessment_assignments_application_idx" ON "assessment_assignments" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "assessment_assignments_status_idx" ON "assessment_assignments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "assessment_assignments_definition_idx" ON "assessment_assignments" USING btree ("assessment_definition_id");--> statement-breakpoint

CREATE UNIQUE INDEX "assessment_definitions_org_provider_external_uidx" ON "assessment_definitions" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "assessment_definitions_org_active_idx" ON "assessment_definitions" USING btree ("organization_id","active");--> statement-breakpoint

CREATE INDEX "assessment_lti_launches_assignment_idx" ON "assessment_lti_launches" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assessment_lti_launches_expires_idx" ON "assessment_lti_launches" USING btree ("expires_at");--> statement-breakpoint

CREATE UNIQUE INDEX "tao_lti_signing_keys_active_org_uidx" ON "tao_lti_signing_keys" USING btree ("organization_id") WHERE "tao_lti_signing_keys"."active" = true;--> statement-breakpoint
CREATE INDEX "tao_lti_signing_keys_org_idx" ON "tao_lti_signing_keys" USING btree ("organization_id");