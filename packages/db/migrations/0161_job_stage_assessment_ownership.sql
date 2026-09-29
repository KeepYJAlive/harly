ALTER TABLE "pipeline_stage_assessments" RENAME TO "job_stage_assessments";--> statement-breakpoint
ALTER TABLE "job_stage_assessments" DROP CONSTRAINT "pipeline_stage_assessments_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "job_stage_assessments" DROP CONSTRAINT "pipeline_stage_assessments_stage_id_job_stages_id_fk";--> statement-breakpoint
ALTER TABLE "job_stage_assessments" DROP CONSTRAINT "pipeline_stage_assessments_assessment_definition_id_assessment_definitions_id_fk";--> statement-breakpoint
ALTER TABLE "job_stage_assessments" DROP CONSTRAINT "pipeline_stage_assessments_org_stage_fk";--> statement-breakpoint
ALTER TABLE "job_stage_assessments" DROP CONSTRAINT "pipeline_stage_assessments_org_definition_fk";--> statement-breakpoint
DROP INDEX "pipeline_stage_assessments_stage_definition_uidx";--> statement-breakpoint
DROP INDEX "pipeline_stage_assessments_org_idx";--> statement-breakpoint
DROP INDEX "pipeline_stage_assessments_definition_idx";--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ADD COLUMN "job_id" uuid;--> statement-breakpoint
UPDATE "job_stage_assessments" AS configured SET "job_id" = stage."job_id" FROM "job_stages" AS stage WHERE configured."stage_id" = stage."id" AND configured."organization_id" = stage."workspace_id";--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ALTER COLUMN "job_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "job_stages_workspace_job_id_uidx" ON "job_stages" USING btree ("workspace_id","job_id","id");--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ADD CONSTRAINT "job_stage_assessments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ADD CONSTRAINT "job_stage_assessments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ADD CONSTRAINT "job_stage_assessments_stage_id_job_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."job_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ADD CONSTRAINT "job_stage_assessments_assessment_definition_id_assessment_definitions_id_fk" FOREIGN KEY ("assessment_definition_id") REFERENCES "public"."assessment_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ADD CONSTRAINT "job_stage_assessments_org_job_stage_fk" FOREIGN KEY ("organization_id","job_id","stage_id") REFERENCES "public"."job_stages"("workspace_id","job_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stage_assessments" ADD CONSTRAINT "job_stage_assessments_org_definition_fk" FOREIGN KEY ("organization_id","assessment_definition_id") REFERENCES "public"."assessment_definitions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX "assessment_assignments_active_application_definition_uidx";--> statement-breakpoint
DROP INDEX "assessment_assignments_stage_origin_uidx";--> statement-breakpoint
ALTER TABLE "assessment_assignments" DROP CONSTRAINT "assessment_assignments_source_stage_id_job_stages_id_fk";--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD COLUMN "job_id" uuid;--> statement-breakpoint
UPDATE "assessment_assignments" AS assignment SET "job_id" = application."job_id" FROM "applications" AS application WHERE assignment."application_id" = application."id" AND assignment."organization_id" = application."workspace_id";--> statement-breakpoint
ALTER TABLE "assessment_assignments" ALTER COLUMN "job_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_workspace_job_id_uidx" ON "applications" USING btree ("workspace_id","job_id","id");--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_org_job_application_fk" FOREIGN KEY ("organization_id","job_id","application_id") REFERENCES "public"."applications"("workspace_id","job_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_stage_assessments_job_stage_definition_uidx" ON "job_stage_assessments" USING btree ("organization_id","job_id","stage_id","assessment_definition_id");--> statement-breakpoint
CREATE INDEX "job_stage_assessments_org_job_idx" ON "job_stage_assessments" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "job_stage_assessments_definition_idx" ON "job_stage_assessments" USING btree ("assessment_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_assignments_active_manual_uidx" ON "assessment_assignments" USING btree ("organization_id","job_id","application_id","assessment_definition_id") WHERE "assessment_assignments"."source_stage_id" is null and "assessment_assignments"."status" in ('assigned', 'started');--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_assignments_stage_origin_uidx" ON "assessment_assignments" USING btree ("organization_id","job_id","application_id","source_stage_id","assessment_definition_id") WHERE "assessment_assignments"."source_stage_id" is not null;
