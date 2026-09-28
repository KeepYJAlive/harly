"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, taoLtiSigningKeys, workspaceSettings } from "@harly/db";

import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requirePermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";
import { encryptSecret } from "@/lib/crypto";
import {
  normalizeOptionalTaoEndpoint,
  normalizeTaoInstanceUrl,
} from "@/lib/lti/validation";
import { createLogger } from "@/lib/logger";
import { safeFetchHttp } from "@/lib/ssrf";
import { ensureTaoSigningKey } from "@/lib/tao/lti/keys";

const log = createLogger("workspace-tao-settings");
const SETTINGS_PATH = "/settings/integrations";
const DETAIL_PATH = "/settings/integrations/tao";

export type TaoSettingsActionResult = { ok: boolean; error?: string };
export type TaoConnectionTestResult = TaoSettingsActionResult & {
  state?: "connected" | "error";
  statusCode?: number;
};

const saveSchema = z.object({
  instanceUrl: z
    .string()
    .trim()
    .min(1, "TAO instance URL is required.")
    .max(2_000),
  clientId: z.string().trim().max(500).optional(),
  clientSecret: z.string().max(4_000).optional(),
  deploymentId: z.string().trim().max(500).optional(),
  oidcAuthUrl: z.string().trim().max(2_000).optional(),
  oauthTokenUrl: z.string().trim().max(2_000).optional(),
  jwksUrl: z.string().trim().max(2_000).optional(),
  launchUrl: z.string().trim().max(2_000).optional(),
});

export type SaveTaoSettingsInput = z.input<typeof saveSchema>;

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid TAO settings.";
}

function revalidateTaoSettings() {
  revalidatePath(SETTINGS_PATH);
  revalidatePath(DETAIL_PATH);
}

export async function saveTaoSettingsAction(
  input: SaveTaoSettingsInput,
): Promise<TaoSettingsActionResult> {
  assertNotDemo();
  const context = await requirePermission("integrations:manage");
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  let instanceUrl: string;
  let oidcAuthUrl: string | null;
  let oauthTokenUrl: string | null;
  let jwksUrl: string | null;
  let launchUrl: string | null;
  try {
    instanceUrl = normalizeTaoInstanceUrl(parsed.data.instanceUrl);
    oidcAuthUrl = normalizeOptionalTaoEndpoint(
      parsed.data.oidcAuthUrl,
      "TAO OIDC authentication URL",
    );
    oauthTokenUrl = normalizeOptionalTaoEndpoint(
      parsed.data.oauthTokenUrl,
      "TAO OAuth/token URL",
    );
    jwksUrl = normalizeOptionalTaoEndpoint(parsed.data.jwksUrl, "TAO JWKS URL");
    launchUrl = normalizeOptionalTaoEndpoint(
      parsed.data.launchUrl,
      "TAO LTI launch/target URL",
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid TAO URL.",
    };
  }

  const [existing] = await db
    .select({
      instanceUrl: workspaceSettings.taoInstanceUrl,
      clientSecretCiphertext: workspaceSettings.taoClientSecretCiphertext,
      clientSecretIv: workspaceSettings.taoClientSecretIv,
      clientSecretTag: workspaceSettings.taoClientSecretTag,
      lastConnectionStatus: workspaceSettings.taoLastConnectionStatus,
      lastConnectionError: workspaceSettings.taoLastConnectionError,
      lastTestedAt: workspaceSettings.taoLastTestedAt,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, context.organization.id))
    .limit(1);

  let encryptedSecret = {
    ciphertext: existing?.clientSecretCiphertext ?? null,
    iv: existing?.clientSecretIv ?? null,
    tag: existing?.clientSecretTag ?? null,
  };
  if (parsed.data.clientSecret) {
    try {
      encryptedSecret = encryptSecret(parsed.data.clientSecret);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not encrypt the client secret.",
      };
    }
  }

  const instanceChanged = existing?.instanceUrl !== instanceUrl;
  try {
    await ensureTaoSigningKey(context.organization.id);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not provision the LTI signing key.",
    };
  }
  const values = {
    taoEnabled: true,
    taoInstanceUrl: instanceUrl,
    taoClientId: parsed.data.clientId || null,
    taoClientSecretCiphertext: encryptedSecret.ciphertext,
    taoClientSecretIv: encryptedSecret.iv,
    taoClientSecretTag: encryptedSecret.tag,
    taoDeploymentId: parsed.data.deploymentId || null,
    taoOidcAuthUrl: oidcAuthUrl,
    taoOauthTokenUrl: oauthTokenUrl,
    taoJwksUrl: jwksUrl,
    taoLaunchUrl: launchUrl,
    taoLastConnectionStatus: instanceChanged
      ? null
      : (existing?.lastConnectionStatus ?? null),
    taoLastConnectionError: instanceChanged
      ? null
      : (existing?.lastConnectionError ?? null),
    taoLastTestedAt: instanceChanged ? null : (existing?.lastTestedAt ?? null),
    updatedAt: new Date(),
  };

  await db
    .insert(workspaceSettings)
    .values({ organizationId: context.organization.id, ...values })
    .onConflictDoUpdate({
      target: workspaceSettings.organizationId,
      set: values,
    });

  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: existing?.instanceUrl
      ? "integrations.tao_updated"
      : "integrations.tao_configured",
    resourceType: "workspace_integration",
    resourceId: context.organization.id,
    metadata: { provider: "tao", instanceUrl },
  });

  revalidateTaoSettings();
  return { ok: true };
}

function nestedErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function connectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const code = nestedErrorCode(error);
  if (
    message.includes("blocked host") ||
    message.includes("blocked network") ||
    message.includes("URL points to")
  ) {
    return "The TAO URL resolves to an unsafe or private destination.";
  }
  if (
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    code === "ABORT_ERR" ||
    code === "ETIMEDOUT"
  ) {
    return "The TAO server did not respond within 8 seconds.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "The TAO hostname could not be resolved.";
  }
  if (
    code?.startsWith("ERR_SSL_") ||
    code?.startsWith("ERR_TLS_") ||
    code === "EPROTO" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "CERT_NOT_YET_VALID" ||
    code === "CERT_UNTRUSTED" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_GET_ISSUER_CERT" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    /\b(?:certificate|ssl|tls)\b/i.test(message)
  ) {
    return "The TAO server's TLS certificate could not be verified.";
  }
  if (code === "ECONNREFUSED") return "The TAO server refused the connection.";
  if (code === "ECONNRESET")
    return "The TAO server closed the connection unexpectedly.";
  return "Harly could not reach the TAO server.";
}

async function recordConnectionTest(
  workspaceId: string,
  target: string,
  status: "connected" | "error",
  error: string | null,
) {
  const [stored] = await db
    .select({ instanceUrl: workspaceSettings.taoInstanceUrl })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, workspaceId))
    .limit(1);
  if (stored?.instanceUrl !== target) return;
  await db
    .update(workspaceSettings)
    .set({
      taoLastConnectionStatus: status,
      taoLastConnectionError: error,
      taoLastTestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workspaceSettings.organizationId, workspaceId));
}

export async function testTaoConnectionAction(input: {
  instanceUrl?: string;
}): Promise<TaoConnectionTestResult> {
  assertNotDemo();
  const context = await requirePermission("integrations:manage");

  let rawUrl = input.instanceUrl?.trim();
  if (!rawUrl) {
    const [stored] = await db
      .select({ instanceUrl: workspaceSettings.taoInstanceUrl })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.organizationId, context.organization.id))
      .limit(1);
    rawUrl = stored?.instanceUrl ?? "";
  }

  let target: string;
  try {
    target = normalizeTaoInstanceUrl(rawUrl);
  } catch (error) {
    return {
      ok: false,
      state: "error",
      error:
        error instanceof Error ? error.message : "Invalid TAO instance URL.",
    };
  }

  try {
    const response = await safeFetchHttp(
      target,
      {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml,application/json" },
        signal: AbortSignal.timeout(8_000),
      },
      process.env.HARLY_ALLOW_PRIVATE_TAO === "true",
    );
    await response.body?.cancel();

    if (response.status < 200 || response.status >= 400) {
      const error = `TAO returned HTTP ${response.status}; expected a successful response or redirect.`;
      await recordConnectionTest(
        context.organization.id,
        target,
        "error",
        error,
      );
      revalidateTaoSettings();
      return { ok: false, state: "error", statusCode: response.status, error };
    }

    await recordConnectionTest(
      context.organization.id,
      target,
      "connected",
      null,
    );
    await logAuditEvent({
      workspaceId: context.organization.id,
      actorId: context.user.id,
      actorEmail: context.user.email,
      action: "integrations.tao_connection_tested",
      resourceType: "workspace_integration",
      resourceId: context.organization.id,
      metadata: { provider: "tao", statusCode: response.status },
    });
    revalidateTaoSettings();
    return { ok: true, state: "connected", statusCode: response.status };
  } catch (error) {
    log.warn({ error }, "TAO connection test failed");
    const message = connectionErrorMessage(error);
    await recordConnectionTest(
      context.organization.id,
      target,
      "error",
      message,
    );
    revalidateTaoSettings();
    return { ok: false, state: "error", error: message };
  }
}

export async function disconnectTaoAction(): Promise<TaoSettingsActionResult> {
  assertNotDemo();
  const context = await requirePermission("integrations:manage");
  await db.transaction(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({
        taoEnabled: false,
        taoInstanceUrl: null,
        taoClientId: null,
        taoClientSecretCiphertext: null,
        taoClientSecretIv: null,
        taoClientSecretTag: null,
        taoDeploymentId: null,
        taoOidcAuthUrl: null,
        taoOauthTokenUrl: null,
        taoJwksUrl: null,
        taoLaunchUrl: null,
        taoLastConnectionStatus: null,
        taoLastConnectionError: null,
        taoLastTestedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(workspaceSettings.organizationId, context.organization.id));
    await tx
      .delete(taoLtiSigningKeys)
      .where(eq(taoLtiSigningKeys.organizationId, context.organization.id));
  });

  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: "integrations.tao_disconnected",
    resourceType: "workspace_integration",
    resourceId: context.organization.id,
    metadata: { provider: "tao" },
  });
  revalidateTaoSettings();
  return { ok: true };
}
