CREATE TABLE "pipeline_stage_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"stage_id" uuid NOT NULL,
	"assessment_definition_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD COLUMN "source_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "job_stages" ADD COLUMN "assign_assessments_on_entry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stage_assessments" ADD CONSTRAINT "pipeline_stage_assessments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_assessments" ADD CONSTRAINT "pipeline_stage_assessments_stage_id_job_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."job_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_assessments" ADD CONSTRAINT "pipeline_stage_assessments_assessment_definition_id_assessment_definitions_id_fk" FOREIGN KEY ("assessment_definition_id") REFERENCES "public"."assessment_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_stages_workspace_id_uidx" ON "job_stages" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "pipeline_stage_assessments" ADD CONSTRAINT "pipeline_stage_assessments_org_stage_fk" FOREIGN KEY ("organization_id","stage_id") REFERENCES "public"."job_stages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_assessments" ADD CONSTRAINT "pipeline_stage_assessments_org_definition_fk" FOREIGN KEY ("organization_id","assessment_definition_id") REFERENCES "public"."assessment_definitions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stage_assessments_stage_definition_uidx" ON "pipeline_stage_assessments" USING btree ("stage_id","assessment_definition_id");--> statement-breakpoint
CREATE INDEX "pipeline_stage_assessments_org_idx" ON "pipeline_stage_assessments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pipeline_stage_assessments_definition_idx" ON "pipeline_stage_assessments" USING btree ("assessment_definition_id");--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_source_stage_id_job_stages_id_fk" FOREIGN KEY ("source_stage_id") REFERENCES "public"."job_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_assignments_stage_origin_uidx" ON "assessment_assignments" USING btree ("organization_id","application_id","assessment_definition_id","source_stage_id") WHERE "assessment_assignments"."source_stage_id" is not null;
