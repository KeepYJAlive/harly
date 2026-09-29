import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, jobStageAssessments, jobStages } from "@harly/db";

export async function listJobStageAssessmentConfiguration(
  organizationId: string,
  jobId: string,
) {
  return db
    .select({
      stageId: jobStageAssessments.stageId,
      assessmentDefinitionId: jobStageAssessments.assessmentDefinitionId,
    })
    .from(jobStageAssessments)
    .innerJoin(
      jobStages,
      and(
        eq(jobStages.id, jobStageAssessments.stageId),
        eq(jobStages.workspaceId, jobStageAssessments.organizationId),
        eq(jobStages.jobId, jobStageAssessments.jobId),
      ),
    )
    .where(
      and(
        eq(jobStageAssessments.organizationId, organizationId),
        eq(jobStageAssessments.jobId, jobId),
      ),
    )
    .orderBy(
      asc(jobStageAssessments.stageId),
      asc(jobStageAssessments.createdAt),
    );
}
