"use server";

import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  type JsonWebKey,
} from "node:crypto";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, ltiRegistrations } from "@harly/db";

import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requirePermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";
import { encryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { normalizeLtiUrl } from "@/lib/lti/url";

export type LtiSettingsActionResult = { ok: boolean; error?: string };

const saveSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().trim().min(1, "Client ID is required.").max(500),
  toolAudience: z.string().trim().max(500).optional(),
  oidcInitiationUrl: z
    .string()
    .trim()
    .min(1, "OIDC initiation URL is required.")
    .max(2_000),
  jwksUrl: z.string().trim().min(1, "TAO JWKS URL is required.").max(2_000),
});

function normalizedEndpoint(raw: string): string {
  return normalizeLtiUrl(raw).toString();
}

function generatePlatformKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const keyId = randomUUID();
  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" }) as JsonWebKey;
  return {
    keyId,
    privateKey,
    publicJwk: {
      ...publicJwk,
      alg: "RS256",
      kid: keyId,
      use: "sig",
    } as Record<string, unknown>,
  };
}

export async function saveLtiSettingsAction(input: {
  enabled: boolean;
  clientId: string;
  toolAudience?: string;
  oidcInitiationUrl: string;
  jwksUrl: string;
}): Promise<LtiSettingsActionResult> {
  assertNotDemo();
  const context = await requirePermission("integrations:manage");
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error: "Configure AI_ENCRYPTION_KEY before enabling LTI signing keys.",
    };
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid LTI settings.",
    };
  }

  let oidcInitiationUrl: string;
  let jwksUrl: string;
  try {
    oidcInitiationUrl = normalizedEndpoint(parsed.data.oidcInitiationUrl);
    jwksUrl = normalizedEndpoint(parsed.data.jwksUrl);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid endpoint URL.",
    };
  }

  const [existing] = await db
    .select({
      id: ltiRegistrations.id,
      deploymentId: ltiRegistrations.deploymentId,
      keyId: ltiRegistrations.keyId,
      publicJwk: ltiRegistrations.publicJwk,
      privateKeyCiphertext: ltiRegistrations.privateKeyCiphertext,
      privateKeyIv: ltiRegistrations.privateKeyIv,
      privateKeyTag: ltiRegistrations.privateKeyTag,
    })
    .from(ltiRegistrations)
    .where(eq(ltiRegistrations.workspaceId, context.organization.id))
    .limit(1);

  const keyMaterial = existing
    ? {
        keyId: existing.keyId,
        publicJwk: existing.publicJwk,
        privateKeyCiphertext: existing.privateKeyCiphertext,
        privateKeyIv: existing.privateKeyIv,
        privateKeyTag: existing.privateKeyTag,
      }
    : (() => {
        const pair = generatePlatformKeyPair();
        const encrypted = encryptSecret(pair.privateKey);
        return {
          keyId: pair.keyId,
          publicJwk: pair.publicJwk,
          privateKeyCiphertext: encrypted.ciphertext,
          privateKeyIv: encrypted.iv,
          privateKeyTag: encrypted.tag,
        };
      })();

  const values = {
    workspaceId: context.organization.id,
    enabled: parsed.data.enabled,
    toolName: "TAO",
    clientId: parsed.data.clientId,
    deploymentId: existing?.deploymentId ?? randomUUID(),
    toolAudience: parsed.data.toolAudience || null,
    oidcInitiationUrl,
    jwksUrl,
    ...keyMaterial,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(ltiRegistrations)
      .values(values)
      .onConflictDoUpdate({
        target: ltiRegistrations.workspaceId,
        set: values,
      });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("client_id") || error.message.includes("unique"))
    ) {
      return { ok: false, error: "That TAO client ID is already registered." };
    }
    throw error;
  }

  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: existing ? "integrations.lti_updated" : "integrations.lti_connected",
    resourceType: "lti_registration",
    resourceId: existing?.id,
    metadata: { enabled: parsed.data.enabled, provider: "tao" },
  });

  revalidatePath("/settings/integrations");
  revalidatePath("/settings/integrations/tao");
  return { ok: true };
}

export async function disconnectLtiAction(): Promise<LtiSettingsActionResult> {
  assertNotDemo();
  const context = await requirePermission("integrations:manage");
  await db
    .update(ltiRegistrations)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(ltiRegistrations.workspaceId, context.organization.id));

  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: "integrations.lti_disconnected",
    resourceType: "lti_registration",
  });
  revalidatePath("/settings/integrations");
  revalidatePath("/settings/integrations/tao");
  return { ok: true };
}
