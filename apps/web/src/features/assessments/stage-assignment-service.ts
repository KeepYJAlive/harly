import "server-only";

import { and, eq } from "drizzle-orm";

import {
  activityEvents,
  assessmentAssignments,
  assessmentDefinitions,
  candidatePortalNotifications,
  db,
  jobStages,
  pipelineStageAssessments,
  workspaceSettings,
} from "@harly/db";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/tao/lti/tokens";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Create every local assignment configured for a stage. This function never
 * calls TAO: provider availability is intentionally deferred until launch.
 * Database uniqueness makes retries, re-entry, and concurrent moves safe.
 */
export async function createStageAssessmentAssignments(
  tx: DatabaseTransaction,
  input: {
    organizationId: string;
    applicationId: string;
    candidateId: string;
    stageId: string;
    actorId?: string | null;
  },
) {
  const configured = await tx
    .select({
      stageName: jobStages.name,
      assessmentDefinitionId: pipelineStageAssessments.assessmentDefinitionId,
    })
    .from(pipelineStageAssessments)
    .innerJoin(
      jobStages,
      and(
        eq(jobStages.id, pipelineStageAssessments.stageId),
        eq(jobStages.workspaceId, pipelineStageAssessments.organizationId),
        eq(jobStages.assignAssessmentsOnEntry, true),
      ),
    )
    .innerJoin(
      assessmentDefinitions,
      and(
        eq(
          assessmentDefinitions.id,
          pipelineStageAssessments.assessmentDefinitionId,
        ),
        eq(
          assessmentDefinitions.organizationId,
          pipelineStageAssessments.organizationId,
        ),
        eq(assessmentDefinitions.provider, "tao"),
        eq(assessmentDefinitions.active, true),
      ),
    )
    .innerJoin(
      workspaceSettings,
      and(
        eq(
          workspaceSettings.organizationId,
          pipelineStageAssessments.organizationId,
        ),
        eq(workspaceSettings.taoEnabled, true),
      ),
    )
    .where(
      and(
        eq(pipelineStageAssessments.organizationId, input.organizationId),
        eq(pipelineStageAssessments.stageId, input.stageId),
      ),
    );

  if (configured.length === 0) return [];

  const inserted = await tx
    .insert(assessmentAssignments)
    .values(
      configured.map((item) => ({
        organizationId: input.organizationId,
        applicationId: input.applicationId,
        assessmentDefinitionId: item.assessmentDefinitionId,
        sourceStageId: input.stageId,
        assignedById: input.actorId ?? null,
        // The raw value is deliberately discarded. Authenticated portal
        // launches resolve the assignment server-side; a recruiter can rotate
        // a public link explicitly if one is needed.
        launchTokenHash: hashOpaqueToken(createOpaqueToken(32)),
        metadata: {
          source: "pipeline_stage",
          sourceStageName: item.stageName,
        },
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: assessmentAssignments.id,
      assessmentDefinitionId: assessmentAssignments.assessmentDefinitionId,
    });

  if (inserted.length === 0) return [];

  await tx.insert(activityEvents).values(
    inserted.map((assignment) => ({
      workspaceId: input.organizationId,
      actorId: input.actorId ?? null,
      entityType: "application" as const,
      entityId: input.applicationId,
      type: "assessment.assigned",
      metadata: {
        assignmentId: assignment.id,
        assessmentDefinitionId: assignment.assessmentDefinitionId,
        sourceStageId: input.stageId,
        automatic: true,
      },
    })),
  );

  await tx.insert(candidatePortalNotifications).values({
    workspaceId: input.organizationId,
    candidateId: input.candidateId,
    type: "assessment_assigned",
    title:
      inserted.length === 1
        ? "A new assessment is ready"
        : `${inserted.length} new assessments are ready`,
    body: "Open your application to start when you are ready.",
    href: `/portal/applications/${input.applicationId}`,
    metadata: {
      applicationId: input.applicationId,
      assignmentIds: inserted.map((assignment) => assignment.id),
      sourceStageId: input.stageId,
    },
  });

  return inserted;
}
