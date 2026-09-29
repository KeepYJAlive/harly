ALTER TABLE "assessment_assignments" ADD COLUMN "provider_resource_id" text;--> statement-breakpoint
UPDATE "assessment_assignments" AS assignment SET "provider_resource_id" = definition."external_id" FROM "assessment_definitions" AS definition WHERE assignment."assessment_definition_id" = definition."id" AND assignment."organization_id" = definition."organization_id";--> statement-breakpoint
ALTER TABLE "assessment_assignments" ALTER COLUMN "provider_resource_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_workspace_id_uidx" ON "applications" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_org_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."applications"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP COLUMN "tao_oidc_auth_url";--> statement-breakpoint
ALTER TABLE "workspace_settings" DROP COLUMN "tao_launch_url";