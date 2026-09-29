"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { assessmentDefinitions, db } from "@harly/db";
import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requirePermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";
import { taoDeliveryIdSchema } from "./validation";

const definitionSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Display name is required.").max(200),
  description: z.string().trim().max(2_000).optional(),
  externalId: taoDeliveryIdSchema,
  active: z.boolean().default(true),
});

export type SaveTaoAssessmentDefinitionInput = z.input<typeof definitionSchema>;
type Result = { ok: boolean; error?: string };

function refresh() {
  revalidatePath("/settings/integrations/tao");
}

export async function saveTaoAssessmentDefinitionAction(
  input: SaveTaoAssessmentDefinitionInput,
): Promise<Result> {
  assertNotDemo();
  const context = await requirePermission("integrations:manage");
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid assessment.",
    };
  }

  try {
    if (parsed.data.id) {
      const [updated] = await db
        .update(assessmentDefinitions)
        .set({
          name: parsed.data.name,
          description: parsed.data.description || null,
          externalId: parsed.data.externalId,
          active: parsed.data.active,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(assessmentDefinitions.id, parsed.data.id),
            eq(assessmentDefinitions.organizationId, context.organization.id),
            eq(assessmentDefinitions.provider, "tao"),
          ),
        )
        .returning({ id: assessmentDefinitions.id });
      if (!updated) return { ok: false, error: "Assessment not found." };
      await logAuditEvent({
        workspaceId: context.organization.id,
        actorId: context.user.id,
        actorEmail: context.user.email,
        action: "assessment.definition_updated",
        resourceType: "assessment_definition",
        resourceId: updated.id,
        metadata: { provider: "tao", active: parsed.data.active },
      });
    } else {
      const [created] = await db
        .insert(assessmentDefinitions)
        .values({
          organizationId: context.organization.id,
          provider: "tao",
          name: parsed.data.name,
          description: parsed.data.description || null,
          externalId: parsed.data.externalId,
          active: parsed.data.active,
        })
        .returning({ id: assessmentDefinitions.id });
      await logAuditEvent({
        workspaceId: context.organization.id,
        actorId: context.user.id,
        actorEmail: context.user.email,
        action: "assessment.definition_created",
        resourceType: "assessment_definition",
        resourceId: created?.id,
        metadata: { provider: "tao", active: parsed.data.active },
      });
    }
    refresh();
    return { ok: true };
  } catch (error) {
    const duplicate =
      error instanceof Error &&
      /assessment_definitions_org_provider_external_uidx|duplicate key/i.test(
        error.message,
      );
    return {
      ok: false,
      error: duplicate
        ? "That TAO delivery/resource identifier is already registered."
        : "Could not save the TAO assessment.",
    };
  }
}

export async function setTaoAssessmentActiveAction(input: {
  id: string;
  active: boolean;
}): Promise<Result> {
  assertNotDemo();
  const context = await requirePermission("integrations:manage");
  const parsed = z
    .object({ id: z.uuid(), active: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid assessment." };
  const [updated] = await db
    .update(assessmentDefinitions)
    .set({ active: parsed.data.active, updatedAt: new Date() })
    .where(
      and(
        eq(assessmentDefinitions.id, parsed.data.id),
        eq(assessmentDefinitions.organizationId, context.organization.id),
        eq(assessmentDefinitions.provider, "tao"),
      ),
    )
    .returning({ id: assessmentDefinitions.id });
  if (!updated) return { ok: false, error: "Assessment not found." };
  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: parsed.data.active
      ? "assessment.definition_enabled"
      : "assessment.definition_disabled",
    resourceType: "assessment_definition",
    resourceId: updated.id,
  });
  refresh();
  return { ok: true };
}
