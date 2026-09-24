CREATE TYPE "public"."commitment_period" AS ENUM('week', 'month');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('employment', 'volunteer');--> statement-breakpoint
ALTER TYPE "public"."employment_type" ADD VALUE 'temporary' BEFORE 'internship';--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "employment_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "opportunity_type" "opportunity_type" DEFAULT 'employment' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "minimum_hours" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "commitment_period" "commitment_period";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "schedule_notes" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_opportunity_fields_check" CHECK ((
        ("jobs"."opportunity_type" = 'employment' and "jobs"."employment_type" is not null and "jobs"."minimum_hours" is null and "jobs"."commitment_period" is null and "jobs"."schedule_notes" is null)
        or
        ("jobs"."opportunity_type" = 'volunteer' and "jobs"."employment_type" is null and "jobs"."salary_min" is null and "jobs"."salary_max" is null and "jobs"."currency" is null and "jobs"."salary_period" is null and "jobs"."minimum_hours" > 0 and "jobs"."commitment_period" is not null)
      ));