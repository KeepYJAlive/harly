CREATE TYPE "public"."candidate_referral_kind" AS ENUM('internal', 'personal');--> statement-breakpoint
CREATE TYPE "public"."candidate_referral_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "application_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"referral_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"referrer_user_id" text,
	"referrer_name_snapshot" text NOT NULL,
	"usage_slot" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_referrals_usage_slot_check" CHECK ("application_referrals"."usage_slot" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "candidate_referrals" ALTER COLUMN "candidate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "kind" "candidate_referral_kind" DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "referred_name" text;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "referred_email_normalized" text;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "status" "candidate_referral_status" DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_workspace_id_candidate_uidx" UNIQUE("workspace_id","id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_referrals_workspace_id_uidx" ON "candidate_referrals" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "application_referrals" ADD CONSTRAINT "application_referrals_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_referrals" ADD CONSTRAINT "application_referrals_referrer_user_id_user_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_referrals" ADD CONSTRAINT "application_referrals_workspace_referral_fk" FOREIGN KEY ("workspace_id","referral_id") REFERENCES "public"."candidate_referrals"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_referrals" ADD CONSTRAINT "application_referrals_workspace_application_candidate_fk" FOREIGN KEY ("workspace_id","application_id","candidate_id") REFERENCES "public"."applications"("workspace_id","id","candidate_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_referrals_application_uidx" ON "application_referrals" USING btree ("workspace_id","application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_referrals_referral_slot_uidx" ON "application_referrals" USING btree ("referral_id","usage_slot");--> statement-breakpoint
CREATE INDEX "application_referrals_workspace_referral_idx" ON "application_referrals" USING btree ("workspace_id","referral_id");--> statement-breakpoint
CREATE INDEX "application_referrals_candidate_idx" ON "application_referrals" USING btree ("workspace_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_referrals_token_hash_uidx" ON "candidate_referrals" USING btree ("token_hash") WHERE "candidate_referrals"."token_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_referrals_personal_referrer_email_active_uidx" ON "candidate_referrals" USING btree ("workspace_id","referred_by_id","referred_email_normalized") WHERE "candidate_referrals"."kind" = 'personal' and "candidate_referrals"."status" in ('pending', 'accepted');--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_referrals_personal_candidate_active_uidx" ON "candidate_referrals" USING btree ("workspace_id","candidate_id") WHERE "candidate_referrals"."kind" = 'personal' and "candidate_referrals"."status" = 'accepted' and "candidate_referrals"."candidate_id" is not null;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD CONSTRAINT "candidate_referrals_personal_shape_check" CHECK (("candidate_referrals"."kind" = 'internal' and "candidate_referrals"."candidate_id" is not null) or ("candidate_referrals"."kind" = 'personal' and "candidate_referrals"."job_id" is null and "candidate_referrals"."referred_name" is not null and "candidate_referrals"."referred_email_normalized" is not null and "candidate_referrals"."token_hash" is not null));
