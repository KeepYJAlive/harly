import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, jobStages, pipelineStageAssessments } from "@harly/db";

export async function listPipelineStageAssessmentConfiguration(
  organizationId: string,
  jobId: string,
) {
  return db
    .select({
      stageId: pipelineStageAssessments.stageId,
      assessmentDefinitionId: pipelineStageAssessments.assessmentDefinitionId,
    })
    .from(pipelineStageAssessments)
    .innerJoin(
      jobStages,
      and(
        eq(jobStages.id, pipelineStageAssessments.stageId),
        eq(jobStages.workspaceId, pipelineStageAssessments.organizationId),
      ),
    )
    .where(
      and(
        eq(pipelineStageAssessments.organizationId, organizationId),
        eq(jobStages.jobId, jobId),
      ),
    )
    .orderBy(
      asc(pipelineStageAssessments.stageId),
      asc(pipelineStageAssessments.createdAt),
    );
}
