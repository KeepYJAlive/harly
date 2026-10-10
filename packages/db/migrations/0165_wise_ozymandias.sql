CREATE TYPE "public"."interview_participant_role" AS ENUM('lead', 'interviewer', 'observer');--> statement-breakpoint
CREATE TYPE "public"."interview_scheduling_status" AS ENUM('draft', 'awaiting_candidate', 'pending_review', 'confirmed', 'needs_rescheduling', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."interview_slot_proposer" AS ENUM('recruiter', 'candidate');--> statement-breakpoint
CREATE TYPE "public"."interview_slot_status" AS ENUM('offered', 'proposed', 'accepted', 'rejected', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TABLE "interview_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "interview_participant_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_request_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "interview_participant_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_scheduling_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"application_id" uuid NOT NULL,
	"interview_id" uuid,
	"created_by" text NOT NULL,
	"interviewer_id" text,
	"title" text,
	"type" "interview_type" NOT NULL,
	"mode" "interview_mode" NOT NULL,
	"duration_mins" integer NOT NULL,
	"location" text,
	"notes" text,
	"meeting_provider" text DEFAULT 'auto' NOT NULL,
	"time_zone" text NOT NULL,
	"status" "interview_scheduling_status" DEFAULT 'awaiting_candidate' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_requests_duration_check" CHECK ("interview_scheduling_requests"."duration_mins" between 5 and 480)
);
--> statement-breakpoint
CREATE TABLE "interview_scheduling_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"proposed_by" "interview_slot_proposer" NOT NULL,
	"status" "interview_slot_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_participants" ADD CONSTRAINT "interview_participants_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_participants" ADD CONSTRAINT "interview_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_request_participants" ADD CONSTRAINT "interview_request_participants_request_id_interview_scheduling_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."interview_scheduling_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_request_participants" ADD CONSTRAINT "interview_request_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scheduling_requests" ADD CONSTRAINT "interview_scheduling_requests_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scheduling_requests" ADD CONSTRAINT "interview_scheduling_requests_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scheduling_requests" ADD CONSTRAINT "interview_scheduling_requests_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scheduling_requests" ADD CONSTRAINT "interview_scheduling_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scheduling_requests" ADD CONSTRAINT "interview_scheduling_requests_interviewer_id_user_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scheduling_slots" ADD CONSTRAINT "interview_scheduling_slots_request_id_interview_scheduling_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."interview_scheduling_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_participants_user_idx" ON "interview_participants" USING btree ("interview_id","user_id");--> statement-breakpoint
CREATE INDEX "interview_participants_user_lookup_idx" ON "interview_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_request_participants_user_idx" ON "interview_request_participants" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "interview_requests_workspace_status_idx" ON "interview_scheduling_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "interview_requests_application_idx" ON "interview_scheduling_requests" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_requests_active_interview_idx" ON "interview_scheduling_requests" USING btree ("interview_id") WHERE "interview_scheduling_requests"."status" in ('draft', 'awaiting_candidate', 'pending_review', 'needs_rescheduling');--> statement-breakpoint
CREATE INDEX "interview_slots_request_idx" ON "interview_scheduling_slots" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_slots_one_accepted_idx" ON "interview_scheduling_slots" USING btree ("request_id") WHERE "interview_scheduling_slots"."status" = 'accepted';