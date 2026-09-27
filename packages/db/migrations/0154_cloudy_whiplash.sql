CREATE TABLE "lti_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"registration_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"created_by_id" text,
	"title" text NOT NULL,
	"delivery_id" text,
	"target_link_uri" text NOT NULL,
	"subject" text NOT NULL,
	"login_hint_hash" text,
	"status" text DEFAULT 'assigned' NOT NULL,
	"score_given" double precision,
	"score_maximum" double precision,
	"normalized_score" integer,
	"activity_progress" text,
	"grading_progress" text,
	"last_score_payload" jsonb,
	"launched_at" timestamp with time zone,
	"last_score_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lti_attempts_normalized_score_check" CHECK ("lti_assessment_attempts"."normalized_score" is null or ("lti_assessment_attempts"."normalized_score" >= 0 and "lti_assessment_attempts"."normalized_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "lti_client_assertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"jti" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"tool_name" text DEFAULT 'TAO' NOT NULL,
	"client_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"tool_audience" text,
	"oidc_initiation_url" text NOT NULL,
	"jwks_url" text NOT NULL,
	"key_id" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_key_ciphertext" text NOT NULL,
	"private_key_iv" text NOT NULL,
	"private_key_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "employment_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."employment_type";--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'internship', 'temporary');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "employment_type" SET DATA TYPE "public"."employment_type" USING "employment_type"::"public"."employment_type";--> statement-breakpoint
ALTER TABLE "lti_access_tokens" ADD CONSTRAINT "lti_access_tokens_registration_id_lti_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."lti_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_assessment_attempts" ADD CONSTRAINT "lti_assessment_attempts_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_assessment_attempts" ADD CONSTRAINT "lti_assessment_attempts_registration_id_lti_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."lti_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_assessment_attempts" ADD CONSTRAINT "lti_assessment_attempts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_assessment_attempts" ADD CONSTRAINT "lti_assessment_attempts_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_assessment_attempts" ADD CONSTRAINT "lti_assessment_attempts_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_client_assertions" ADD CONSTRAINT "lti_client_assertions_registration_id_lti_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."lti_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_registrations" ADD CONSTRAINT "lti_registrations_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lti_access_tokens_hash_uidx" ON "lti_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "lti_access_tokens_registration_expiry_idx" ON "lti_access_tokens" USING btree ("registration_id","expires_at");--> statement-breakpoint
CREATE INDEX "lti_attempts_workspace_application_idx" ON "lti_assessment_attempts" USING btree ("workspace_id","application_id","created_at");--> statement-breakpoint
CREATE INDEX "lti_attempts_candidate_idx" ON "lti_assessment_attempts" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "lti_attempts_registration_status_idx" ON "lti_assessment_attempts" USING btree ("registration_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_client_assertions_registration_jti_uidx" ON "lti_client_assertions" USING btree ("registration_id","jti");--> statement-breakpoint
CREATE INDEX "lti_client_assertions_expiry_idx" ON "lti_client_assertions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_registrations_workspace_uidx" ON "lti_registrations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lti_registrations_client_id_uidx" ON "lti_registrations" USING btree ("client_id");