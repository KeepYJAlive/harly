"use server";

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  taoRemoteLists as lists,
  taoRemoteListEntries as entries,
  workspaceSettings,
} from "@harly/db";
import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requirePermission } from "@/features/workspaces/permissions-server";
import {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
} from "@/lib/crypto";
import { parseImport, previewImport } from "@/lib/tao/remote-lists/import";
import { getHarlyPublicOrigin } from "@/lib/public-origin";
import { remoteListSourceUrl } from "@/lib/tao/remote-lists/connection";
import { logAuditEvent } from "@/lib/audit-log";

const path = "/settings/integrations/tao";
const targetSchema = z.object({
  id: z.string().uuid().nullable(),
  revision: z.number().int().positive().nullable(),
});
type Target = z.infer<typeof targetSchema>;
const proofSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
});

async function admin() {
  assertNotDemo();
  return requirePermission("integrations:manage");
}
function errorMessage(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues[0]?.message ?? "Invalid input.";
  if (error instanceof Error && !("query" in error)) return error.message;
  return "Could not save the vocabulary. Its key may already exist; refresh and try again.";
}
async function audit(
  context: Awaited<ReturnType<typeof admin>>,
  action: string,
  id: string,
) {
  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    action,
    resourceType: "tao_remote_list",
    resourceId: id,
  });
  revalidatePath(path);
}

// A short-lived, authenticated preview receipt binds commit to precisely the JSON,
// workspace, actor, list and revision reviewed. A client cannot skip the preview.
export async function previewRemoteListAction(json: string, target: Target) {
  const context = await admin();
  try {
    target = targetSchema.parse(target);
    const incoming = parseImport(json);
    const [list] = await db
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.organizationId, context.organization.id),
          target.id ? eq(lists.id, target.id) : eq(lists.key, incoming.key),
        ),
      );
    if (!target.id && list)
      throw new Error(
        "This list key already exists. Open that list to update it.",
      );
    if (target.id && (!list || list.revision !== target.revision))
      throw new Error("The list changed. Refresh and preview again.");
    if (list && list.key !== incoming.key)
      throw new Error("List keys cannot be renamed.");
    const previous = list
      ? await db
          .select({
            id: entries.externalKey,
            label: entries.label,
            enabled: entries.enabled,
          })
          .from(entries)
          .where(eq(entries.remoteListId, list.id))
          .orderBy(entries.position)
      : [];
    const diff = previewImport(incoming, previous);
    const digest = createHmac("sha256", context.organization.id)
      .update(json)
      .digest("hex");
    const receipt = encryptSecret(
      JSON.stringify({
        ...target,
        organizationId: context.organization.id,
        actorId: context.user.id,
        digest,
        expires: Date.now() + 15 * 60_000,
      }),
    );
    return { ok: true as const, diff, receipt };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function commitRemoteListAction(
  json: string,
  target: Target,
  receipt: z.infer<typeof proofSchema>,
) {
  const context = await admin();
  try {
    target = targetSchema.parse(target);
    const incoming = parseImport(json);
    const proof = JSON.parse(decryptSecret(proofSchema.parse(receipt)));
    const digest = createHmac("sha256", context.organization.id)
      .update(json)
      .digest("hex");
    if (
      proof.organizationId !== context.organization.id ||
      proof.actorId !== context.user.id ||
      proof.id !== target.id ||
      proof.revision !== target.revision ||
      proof.expires < Date.now() ||
      typeof proof.digest !== "string" ||
      proof.digest.length !== digest.length ||
      !timingSafeEqual(Buffer.from(proof.digest), Buffer.from(digest))
    )
      throw new Error("Preview expired or changed. Preview the import again.");
    const id = await db.transaction(async (tx) => {
      let list;
      if (target.id) {
        [list] = await tx
          .select()
          .from(lists)
          .where(
            and(
              eq(lists.id, target.id),
              eq(lists.organizationId, context.organization.id),
            ),
          )
          .for("update");
        if (!list || list.revision !== target.revision)
          throw new Error("The list changed. Refresh and preview again.");
        if (list.key !== incoming.key)
          throw new Error("List keys cannot be renamed.");
      } else {
        [list] = await tx
          .insert(lists)
          .values({
            organizationId: context.organization.id,
            key: incoming.key,
            name: incoming.name,
            description: incoming.description,
          })
          .returning();
      }
      const previous = await tx
        .select({
          id: entries.externalKey,
          label: entries.label,
          enabled: entries.enabled,
        })
        .from(entries)
        .where(eq(entries.remoteListId, list.id))
        .orderBy(entries.position);
      const diff = previewImport(incoming, previous);
      // Upsert by stable external key. Never delete missing entries or replace IDs.
      if (diff.values.length)
        await tx
          .insert(entries)
          .values(
            diff.values.map((entry, position) => ({
              remoteListId: list.id,
              externalKey: entry.id,
              label: entry.label,
              enabled: entry.enabled,
              position,
            })),
          )
          .onConflictDoUpdate({
            target: [entries.remoteListId, entries.externalKey],
            set: {
              label: sql`excluded.label`,
              enabled: sql`excluded.enabled`,
              position: sql`excluded.position`,
              updatedAt: new Date(),
            },
          });
      await tx
        .update(lists)
        .set({
          name: incoming.name,
          description: incoming.description,
          revision: sql`${lists.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(lists.id, list.id));
      return list.id;
    });
    await audit(context, "integrations.tao_remote_list_imported", id);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function changeRemoteListAction(input: {
  id: string;
  revision: number;
  action: "enable" | "disable" | "delete";
}) {
  const context = await admin();
  try {
    const parsed = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
        action: z.enum(["enable", "disable", "delete"]),
      })
      .parse(input);
    await db.transaction(async (tx) => {
      const [list] = await tx
        .select()
        .from(lists)
        .where(
          and(
            eq(lists.id, parsed.id),
            eq(lists.organizationId, context.organization.id),
          ),
        )
        .for("update");
      if (!list || list.revision !== parsed.revision)
        throw new Error("The list changed. Refresh and try again.");
      if (parsed.action === "delete") {
        const [entry] = await tx
          .select({ id: entries.id })
          .from(entries)
          .where(eq(entries.remoteListId, list.id))
          .limit(1);
        if (entry)
          throw new Error(
            "Cannot delete a nonempty list: TAO owns usage information. Disable it to stop synchronization; existing TAO values are preserved.",
          );
        await tx.delete(lists).where(eq(lists.id, list.id));
      } else {
        await tx
          .update(lists)
          .set({
            enabled: parsed.action === "enable",
            revision: sql`${lists.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(lists.id, list.id));
      }
    });
    await audit(
      context,
      `integrations.tao_remote_list_${parsed.action}`,
      parsed.id,
    );
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function rotateRemoteListTokenAction() {
  const context = await admin();
  if (!isEncryptionConfigured())
    return {
      ok: false as const,
      error: "Server encryption must be configured first.",
    };
  const token = randomBytes(32).toString("base64url");
  const secret = encryptSecret(token);
  const columns = {
    taoRemoteListTokenCiphertext: secret.ciphertext,
    taoRemoteListTokenIv: secret.iv,
    taoRemoteListTokenTag: secret.tag,
  };
  await db
    .insert(workspaceSettings)
    .values({ organizationId: context.organization.id, ...columns })
    .onConflictDoUpdate({
      target: workspaceSettings.organizationId,
      set: columns,
    });
  await audit(
    context,
    "integrations.tao_remote_list_token_rotated",
    context.organization.id,
  );
  return { ok: true as const };
}

export async function getRemoteListConnectionAction(id: string) {
  const context = await admin();
  try {
    const [list] = await db
      .select({ key: lists.key })
      .from(lists)
      .where(
        and(
          eq(lists.id, z.string().uuid().parse(id)),
          eq(lists.organizationId, context.organization.id),
        ),
      );
    if (!list) throw new Error("List not found.");
    const [config] = await db
      .select({
        ciphertext: workspaceSettings.taoRemoteListTokenCiphertext,
        iv: workspaceSettings.taoRemoteListTokenIv,
        tag: workspaceSettings.taoRemoteListTokenTag,
      })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.organizationId, context.organization.id));
    if (!config?.ciphertext || !config.iv || !config.tag)
      throw new Error("Generate a read token first.");
    const token = decryptSecret({
      ciphertext: config.ciphertext,
      iv: config.iv,
      tag: config.tag,
    });
    const sourceUrl = remoteListSourceUrl(
      getHarlyPublicOrigin(),
      context.organization.id,
      list.key,
      token,
    );
    await audit(context, "integrations.tao_remote_list_connection_viewed", id);
    return { ok: true as const, sourceUrl };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}
