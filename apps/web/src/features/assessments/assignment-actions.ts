"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  activityEvents,
  applications,
  assessmentAssignments,
  assessmentDefinitions,
  db,
  workspaceSettings,
} from "@harly/db";
import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requireApplicationPermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";
import { toHarlyPublicUrl } from "@/lib/public-origin";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/tao/lti/tokens";

type Result = { ok: boolean; error?: string; candidateUrl?: string };

const assignSchema = z.object({
  applicationId: z.uuid(),
  assessmentDefinitionId: z.uuid(),
  expiresAt: z.iso.datetime(),
});

function refresh(candidateId?: string) {
  if (candidateId) revalidatePath(`/dashboard/candidates/${candidateId}`);
}

async function loadApplicationAndDefinition(
  organizationId: string,
  applicationId: string,
  definitionId: string,
) {
  const [row] = await db
    .select({
      applicationId: applications.id,
      candidateId: applications.candidateId,
      definitionId: assessmentDefinitions.id,
      definitionActive: assessmentDefinitions.active,
    })
    .from(applications)
    .innerJoin(
      assessmentDefinitions,
      and(
        eq(assessmentDefinitions.id, definitionId),
        eq(assessmentDefinitions.organizationId, organizationId),
        eq(assessmentDefinitions.provider, "tao"),
      ),
    )
    .where(
      and(
        eq(applications.id, applicationId),
        eq(applications.workspaceId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function assignAssessmentAction(
  input: z.input<typeof assignSchema>,
): Promise<Result> {
  assertNotDemo();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid assignment.",
    };
  }
  const context = await requireApplicationPermission(
    "candidates:edit",
    parsed.data.applicationId,
  );
  const [domain, integration] = await Promise.all([
    loadApplicationAndDefinition(
      context.organization.id,
      parsed.data.applicationId,
      parsed.data.assessmentDefinitionId,
    ),
    db
      .select({
        enabled: workspaceSettings.taoEnabled,
        clientId: workspaceSettings.taoClientId,
        deploymentId: workspaceSettings.taoDeploymentId,
        oidcUrl: workspaceSettings.taoOidcAuthUrl,
        launchUrl: workspaceSettings.taoLaunchUrl,
      })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.organizationId, context.organization.id))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (!domain || !domain.definitionActive) {
    return { ok: false, error: "That assessment is not available." };
  }
  if (
    !integration?.enabled ||
    !integration.clientId ||
    !integration.deploymentId ||
    !integration.oidcUrl ||
    !integration.launchUrl
  ) {
    return {
      ok: false,
      error: "Complete the TAO LTI configuration before assigning assessments.",
    };
  }
  const expiresAt = new Date(parsed.data.expiresAt);
  if (expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "Expiration must be in the future." };
  }

  const rawToken = createOpaqueToken(32);
  try {
    const [assignment] = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(assessmentAssignments)
        .values({
          organizationId: context.organization.id,
          applicationId: parsed.data.applicationId,
          assessmentDefinitionId: parsed.data.assessmentDefinitionId,
          assignedById: context.user.id,
          expiresAt,
          launchTokenHash: hashOpaqueToken(rawToken),
        })
        .returning({ id: assessmentAssignments.id });
      if (inserted[0]) {
        await tx.insert(activityEvents).values({
          workspaceId: context.organization.id,
          actorId: context.user.id,
          entityType: "application",
          entityId: parsed.data.applicationId,
          type: "assessment.assigned",
          metadata: {
            assignmentId: inserted[0].id,
            assessmentDefinitionId: parsed.data.assessmentDefinitionId,
          },
        });
      }
      return inserted;
    });
    if (!assignment)
      return { ok: false, error: "Could not create the assignment." };
    await logAuditEvent({
      workspaceId: context.organization.id,
      actorId: context.user.id,
      actorEmail: context.user.email,
      action: "assessment.assigned",
      resourceType: "assessment_assignment",
      resourceId: assignment.id,
      metadata: { applicationId: parsed.data.applicationId },
    });
    refresh(domain.candidateId);
    return {
      ok: true,
      candidateUrl: toHarlyPublicUrl(`/assessment/${rawToken}`),
    };
  } catch (error) {
    const activeDuplicate =
      error instanceof Error &&
      /assessment_assignments_active_application_definition_uidx|duplicate key/i.test(
        error.message,
      );
    return {
      ok: false,
      error: activeDuplicate
        ? "This application already has an active assignment for that assessment."
        : "Could not assign the assessment.",
    };
  }
}

async function mutateAssignment(
  assignmentId: string,
  operation: "cancel" | "regenerate",
): Promise<Result> {
  const id = z.uuid().safeParse(assignmentId);
  if (!id.success) return { ok: false, error: "Invalid assignment." };
  const [lookup] = await db
    .select({ applicationId: assessmentAssignments.applicationId })
    .from(assessmentAssignments)
    .where(eq(assessmentAssignments.id, id.data))
    .limit(1);
  if (!lookup) return { ok: false, error: "Assessment assignment not found." };
  const context = await requireApplicationPermission(
    "candidates:edit",
    lookup.applicationId,
  );
  const rawToken = operation === "regenerate" ? createOpaqueToken(32) : null;
  const [updated] = await db
    .update(assessmentAssignments)
    .set(
      operation === "cancel"
        ? { status: "cancelled", updatedAt: new Date() }
        : {
            launchTokenHash: hashOpaqueToken(rawToken!),
            updatedAt: new Date(),
          },
    )
    .where(
      and(
        eq(assessmentAssignments.id, id.data),
        eq(assessmentAssignments.organizationId, context.organization.id),
        inArray(assessmentAssignments.status, ["assigned", "started"]),
      ),
    )
    .returning({
      id: assessmentAssignments.id,
      applicationId: assessmentAssignments.applicationId,
    });
  if (!updated)
    return { ok: false, error: "This assignment can no longer be changed." };
  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action:
      operation === "cancel"
        ? "assessment.cancelled"
        : "assessment.link_regenerated",
    resourceType: "assessment_assignment",
    resourceId: updated.id,
  });
  revalidatePath("/dashboard/candidates");
  return rawToken
    ? { ok: true, candidateUrl: toHarlyPublicUrl(`/assessment/${rawToken}`) }
    : { ok: true };
}

export async function cancelAssessmentAssignmentAction(assignmentId: string) {
  assertNotDemo();
  return mutateAssignment(assignmentId, "cancel");
}

export async function regenerateAssessmentLinkAction(assignmentId: string) {
  assertNotDemo();
  return mutateAssignment(assignmentId, "regenerate");
}
