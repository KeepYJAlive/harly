import "server-only";

import { and, eq } from "drizzle-orm";

import {
  activityEvents,
  assessmentAssignments,
  assessmentDefinitions,
  candidatePortalNotifications,
  db,
  emailOutbox,
  jobStageAssessments,
  jobStages,
  workspaceSettings,
} from "@harly/db";
import { isEncryptionConfigured } from "@/lib/crypto";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/tao/lti/tokens";
import {
  ASSESSMENT_INVITATION_KIND,
  assessmentInvitationDedupeKey,
  calculateAssessmentExpiry,
  createAssessmentInvitationPayload,
} from "./invitation";

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
    jobId: string;
    applicationId: string;
    candidateId: string;
    stageId: string;
    actorId?: string | null;
  },
) {
  const configured = await tx
    .select({
      stageName: jobStages.name,
      assessmentDefinitionId: jobStageAssessments.assessmentDefinitionId,
      providerResourceId: assessmentDefinitions.externalId,
      sendInvitation: jobStageAssessments.sendInvitation,
      deadlineDays: jobStageAssessments.deadlineDays,
    })
    .from(jobStageAssessments)
    .innerJoin(
      jobStages,
      and(
        eq(jobStages.id, jobStageAssessments.stageId),
        eq(jobStages.workspaceId, jobStageAssessments.organizationId),
        eq(jobStages.jobId, jobStageAssessments.jobId),
        eq(jobStages.assignAssessmentsOnEntry, true),
      ),
    )
    .innerJoin(
      assessmentDefinitions,
      and(
        eq(
          assessmentDefinitions.id,
          jobStageAssessments.assessmentDefinitionId,
        ),
        eq(
          assessmentDefinitions.organizationId,
          jobStageAssessments.organizationId,
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
          jobStageAssessments.organizationId,
        ),
        eq(workspaceSettings.taoEnabled, true),
      ),
    )
    .where(
      and(
        eq(jobStageAssessments.organizationId, input.organizationId),
        eq(jobStageAssessments.jobId, input.jobId),
        eq(jobStageAssessments.stageId, input.stageId),
      ),
    );

  if (configured.length === 0) return [];

  const assignedAt = new Date();
  const encryptionReady = isEncryptionConfigured();
  const prepared = configured.map((item) => {
    const rawToken = createOpaqueToken(32);
    return {
      ...item,
      rawToken,
      launchTokenHash: hashOpaqueToken(rawToken),
      expiresAt: calculateAssessmentExpiry(assignedAt, item.deadlineDays),
    };
  });

  const inserted = await tx
    .insert(assessmentAssignments)
    .values(
      prepared.map((item) => ({
        organizationId: input.organizationId,
        jobId: input.jobId,
        applicationId: input.applicationId,
        assessmentDefinitionId: item.assessmentDefinitionId,
        providerResourceId: item.providerResourceId,
        sourceStageId: input.stageId,
        assignedById: input.actorId ?? null,
        assignedAt,
        expiresAt: item.expiresAt,
        launchTokenHash: item.launchTokenHash,
        metadata: {
          source: "pipeline_stage",
          sourceStageName: item.stageName,
          deadlineDays: item.deadlineDays,
        },
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: assessmentAssignments.id,
      assessmentDefinitionId: assessmentAssignments.assessmentDefinitionId,
    });

  if (inserted.length === 0) return [];

  const preparedByDefinition = new Map(
    prepared.map((item) => [item.assessmentDefinitionId, item]),
  );
  const invitations = inserted.flatMap((assignment) => {
    const item = preparedByDefinition.get(assignment.assessmentDefinitionId);
    if (!item?.sendInvitation || !encryptionReady) return [];
    return [
      {
        workspaceId: input.organizationId,
        kind: ASSESSMENT_INVITATION_KIND,
        payload: createAssessmentInvitationPayload(
          assignment.id,
          item.rawToken,
        ),
        dedupeKey: assessmentInvitationDedupeKey(assignment.id),
        actorId: input.actorId ?? null,
      },
    ];
  });
  if (invitations.length > 0) {
    await tx
      .insert(emailOutbox)
      .values(invitations)
      .onConflictDoNothing({
        target: [emailOutbox.workspaceId, emailOutbox.dedupeKey],
      });
  }

  const activityValues = inserted.flatMap((assignment) => {
    const item = preparedByDefinition.get(assignment.assessmentDefinitionId);
    const values: Array<typeof activityEvents.$inferInsert> = [
      {
        workspaceId: input.organizationId,
        actorId: input.actorId ?? null,
        entityType: "application",
        entityId: input.applicationId,
        type: "assessment.assigned",
        metadata: {
          assignmentId: assignment.id,
          assessmentDefinitionId: assignment.assessmentDefinitionId,
          sourceStageId: input.stageId,
          automatic: true,
        },
      },
    ];
    if (item?.sendInvitation) {
      values.push({
        workspaceId: input.organizationId,
        actorId: input.actorId ?? null,
        entityType: "application",
        entityId: input.applicationId,
        type: encryptionReady
          ? "assessment.invitation_queued"
          : "assessment.invitation_failed",
        metadata: {
          assignmentId: assignment.id,
          reason: encryptionReady ? undefined : "encryption_not_configured",
        },
      });
    }
    return values;
  });
  await tx.insert(activityEvents).values(activityValues);

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
