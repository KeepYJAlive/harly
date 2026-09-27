"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  activityEvents,
  applications,
  db,
  ltiAssessmentAttempts,
  ltiRegistrations,
} from "@harly/db";

import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requireApplicationPermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";
import { deliveryIdFromTargetLink, validateTaoTargetLink } from "@/lib/lti/url";

export type AssignAssessmentResult = { ok: boolean; error?: string };

const assignSchema = z.object({
  applicationId: z.string().uuid(),
  title: z.string().trim().min(1, "Assessment title is required.").max(200),
  targetLinkUri: z
    .string()
    .trim()
    .min(1, "TAO launch URL is required.")
    .max(2_000),
});

export async function assignTaoAssessmentAction(input: {
  applicationId: string;
  title: string;
  targetLinkUri: string;
}): Promise<AssignAssessmentResult> {
  assertNotDemo();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid assessment.",
    };
  }

  const context = await requireApplicationPermission(
    "candidates:edit",
    parsed.data.applicationId,
  );
  const [row] = await db
    .select({
      applicationId: applications.id,
      candidateId: applications.candidateId,
      registrationId: ltiRegistrations.id,
      oidcInitiationUrl: ltiRegistrations.oidcInitiationUrl,
      ltiEnabled: ltiRegistrations.enabled,
    })
    .from(applications)
    .innerJoin(
      ltiRegistrations,
      eq(ltiRegistrations.workspaceId, applications.workspaceId),
    )
    .where(
      and(
        eq(applications.id, parsed.data.applicationId),
        eq(applications.workspaceId, context.organization.id),
      ),
    )
    .limit(1);

  if (!row?.ltiEnabled) {
    return { ok: false, error: "Connect and enable TAO before assigning an assessment." };
  }

  let targetLinkUri: string;
  try {
    targetLinkUri = validateTaoTargetLink(
      parsed.data.targetLinkUri,
      row.oidcInitiationUrl,
    ).toString();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid TAO launch URL.",
    };
  }

  const [previous] = await db
    .select({ subject: ltiAssessmentAttempts.subject })
    .from(ltiAssessmentAttempts)
    .where(
      and(
        eq(ltiAssessmentAttempts.registrationId, row.registrationId),
        eq(ltiAssessmentAttempts.candidateId, row.candidateId),
      ),
    )
    .orderBy(desc(ltiAssessmentAttempts.createdAt))
    .limit(1);

  const [attempt] = await db
    .insert(ltiAssessmentAttempts)
    .values({
      workspaceId: context.organization.id,
      registrationId: row.registrationId,
      applicationId: row.applicationId,
      candidateId: row.candidateId,
      createdById: context.user.id,
      title: parsed.data.title,
      deliveryId: deliveryIdFromTargetLink(targetLinkUri),
      targetLinkUri,
      subject: previous?.subject ?? randomUUID(),
      status: "assigned",
    })
    .returning({ id: ltiAssessmentAttempts.id });

  if (!attempt) return { ok: false, error: "Could not create the assessment." };

  await db.insert(activityEvents).values({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    entityType: "application",
    entityId: row.applicationId,
    type: "assessment.assigned",
    metadata: { assessmentId: attempt.id, title: parsed.data.title, provider: "tao" },
  });

  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: "assessment.assigned",
    resourceType: "lti_assessment",
    resourceId: attempt.id,
    metadata: { applicationId: row.applicationId, provider: "tao" },
  });

  revalidatePath(`/dashboard/candidates/${row.candidateId}`);
  revalidatePath(`/portal/applications/${row.applicationId}`);
  return { ok: true };
}
