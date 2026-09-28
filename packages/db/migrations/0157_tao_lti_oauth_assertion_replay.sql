CREATE TABLE "tao_lti_client_assertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"jti" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tao_lti_client_assertions_client_jti_uidx" ON "tao_lti_client_assertions" USING btree ("client_id","jti");--> statement-breakpoint
CREATE INDEX "tao_lti_client_assertions_expires_idx" ON "tao_lti_client_assertions" USING btree ("expires_at");--> statement-breakpoint
UPDATE "workspace_settings" SET "tao_client_id" = NULL, "tao_deployment_id" = NULL, "tao_last_connection_status" = NULL, "tao_last_connection_error" = NULL, "tao_last_tested_at" = NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP COLUMN "tao_client_secret_ciphertext";--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP COLUMN "tao_client_secret_iv";--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP COLUMN "tao_client_secret_tag";--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP COLUMN "tao_oauth_token_url";--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP COLUMN "tao_jwks_url";