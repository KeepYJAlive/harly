DROP TABLE "lti_access_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "lti_assessment_attempts" CASCADE;--> statement-breakpoint
DROP TABLE "lti_client_assertions" CASCADE;--> statement-breakpoint
DROP TABLE "lti_registrations" CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_instance_url" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_client_id" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_client_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_client_secret_iv" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_client_secret_tag" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_deployment_id" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_oidc_auth_url" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_oauth_token_url" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_jwks_url" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_launch_url" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_last_connection_status" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_last_connection_error" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_last_tested_at" timestamp with time zone;