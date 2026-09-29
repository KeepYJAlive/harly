"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  assessmentDefinitions,
  db,
  jobStageAssessments,
  jobStages,
  workspaceSettings,
} from "@harly/db";
import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requireJobPermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";

const configurationSchema = z.object({
  jobId: z.uuid(),
  stageId: z.uuid(),
  enabled: z.boolean(),
  assessmentDefinitionIds: z.array(z.uuid()).max(50),
});

export type SaveStageAssessmentConfigurationInput = z.input<
  typeof configurationSchema
>;

export async function saveStageAssessmentConfigurationAction(
  input: SaveStageAssessmentConfigurationInput,
): Promise<{ ok: boolean; error?: string }> {
  assertNotDemo();
  const parsed = configurationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid stage assessment configuration." };
  }

  const definitionIds = [...new Set(parsed.data.assessmentDefinitionIds)];
  if (parsed.data.enabled && definitionIds.length === 0) {
    return { ok: false, error: "Select at least one assessment." };
  }

  const context = await requireJobPermission("jobs:edit", parsed.data.jobId);
  const organizationId = context.organization.id;

  const [[stage], [integration], definitions, existingConfiguration] =
    await Promise.all([
      db
        .select({ id: jobStages.id })
        .from(jobStages)
        .where(
          and(
            eq(jobStages.id, parsed.data.stageId),
            eq(jobStages.jobId, parsed.data.jobId),
            eq(jobStages.workspaceId, organizationId),
          ),
        )
        .limit(1),
      db
        .select({ enabled: workspaceSettings.taoEnabled })
        .from(workspaceSettings)
        .where(eq(workspaceSettings.organizationId, organizationId))
        .limit(1),
      definitionIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: assessmentDefinitions.id,
              active: assessmentDefinitions.active,
            })
            .from(assessmentDefinitions)
            .where(
              and(
                eq(assessmentDefinitions.organizationId, organizationId),
                eq(assessmentDefinitions.provider, "tao"),
                inArray(assessmentDefinitions.id, definitionIds),
              ),
            ),
      db
        .select({
          assessmentDefinitionId:
            jobStageAssessments.assessmentDefinitionId,
        })
        .from(jobStageAssessments)
        .where(
          and(
            eq(jobStageAssessments.organizationId, organizationId),
            eq(jobStageAssessments.jobId, parsed.data.jobId),
            eq(jobStageAssessments.stageId, parsed.data.stageId),
          ),
        ),
    ]);

  if (!stage) return { ok: false, error: "Pipeline stage not found." };
  if (!integration?.enabled) {
    return {
      ok: false,
      error: "Enable the TAO integration before changing stage assessments.",
    };
  }
  const existingIds = new Set(
    existingConfiguration.map((item) => item.assessmentDefinitionId),
  );
  if (
    definitions.length !== definitionIds.length ||
    definitions.some(
      (definition) => !definition.active && !existingIds.has(definition.id),
    )
  ) {
    return {
      ok: false,
      error:
        "Only active TAO assessments from this organization can be newly selected.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(jobStages)
      .set({
        assignAssessmentsOnEntry: parsed.data.enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobStages.id, parsed.data.stageId),
          eq(jobStages.jobId, parsed.data.jobId),
          eq(jobStages.workspaceId, organizationId),
        ),
      );

    await tx
      .delete(jobStageAssessments)
      .where(
        and(
          eq(jobStageAssessments.organizationId, organizationId),
          eq(jobStageAssessments.jobId, parsed.data.jobId),
          eq(jobStageAssessments.stageId, parsed.data.stageId),
        ),
      );

    if (parsed.data.enabled && definitionIds.length > 0) {
      await tx.insert(jobStageAssessments).values(
        definitionIds.map((assessmentDefinitionId) => ({
          organizationId,
          jobId: parsed.data.jobId,
          stageId: parsed.data.stageId,
          assessmentDefinitionId,
        })),
      );
    }
  });

  await logAuditEvent({
    workspaceId: organizationId,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: "pipeline.stage_assessments_updated",
    resourceType: "job_stage",
    resourceId: parsed.data.stageId,
    metadata: {
      jobId: parsed.data.jobId,
      enabled: parsed.data.enabled,
      assessmentDefinitionIds: parsed.data.enabled ? definitionIds : [],
    },
  });

  revalidatePath(`/dashboard/pipeline`);
  revalidatePath(`/dashboard/jobs/${parsed.data.jobId}`);
  return { ok: true };
}
