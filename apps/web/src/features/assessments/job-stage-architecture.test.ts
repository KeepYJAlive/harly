import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../../../packages/db/migrations/0161_job_stage_assessment_ownership.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("job-owned stage assessment schema", () => {
  it("keys configuration by organization, job, stage, and assessment", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "job_stage_assessments_job_stage_definition_uidx" ON "job_stage_assessments" USING btree ("organization_id","job_id","stage_id","assessment_definition_id")',
    );
  });

  it("requires the configured stage to belong to the same organization and job", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("organization_id","job_id","stage_id") REFERENCES "public"."job_stages"("workspace_id","job_id","id")',
    );
  });

  it("makes stage-origin assignment retries idempotent while preserving provenance", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "assessment_assignments_stage_origin_uidx" ON "assessment_assignments" USING btree ("organization_id","job_id","application_id","source_stage_id","assessment_definition_id")',
    );
  });

  it("does not delete historical assignments when configuration is removed", () => {
    expect(migration).not.toContain(
      'REFERENCES "public"."job_stage_assessments"',
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "assessment_assignments_source_stage_id_job_stages_id_fk"',
    );
  });
});
