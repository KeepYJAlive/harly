"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, taoLtiSigningKeys, workspaceSettings } from "@harly/db";

import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requirePermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";
import { getTaoToolConfiguration } from "@/lib/lti/config";
import { normalizeTaoInstanceUrl } from "@/lib/lti/validation";
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
  try {
    instanceUrl = normalizeTaoInstanceUrl(parsed.data.instanceUrl);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid TAO URL.",
    };
  }

  const [existing] = await db
    .select({
      instanceUrl: workspaceSettings.taoInstanceUrl,
      clientId: workspaceSettings.taoClientId,
      deploymentId: workspaceSettings.taoDeploymentId,
      lastConnectionStatus: workspaceSettings.taoLastConnectionStatus,
      lastConnectionError: workspaceSettings.taoLastConnectionError,
      lastTestedAt: workspaceSettings.taoLastTestedAt,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, context.organization.id))
    .limit(1);

  const clientId = existing?.clientId ?? `harly-tao-${randomUUID()}`;
  const deploymentId = existing?.deploymentId ?? randomUUID();

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
    taoClientId: clientId,
    taoDeploymentId: deploymentId,
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
      set: {
        ...values,
        taoClientId: sql`COALESCE(${workspaceSettings.taoClientId}, ${clientId})`,
        taoDeploymentId: sql`COALESCE(${workspaceSettings.taoDeploymentId}, ${deploymentId})`,
      },
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
  if (message.startsWith("TAO ")) return message;
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
    const allowPrivate = process.env.HARLY_ALLOW_PRIVATE_TAO === "true";
    const requestInit: RequestInit = {
      headers: { Accept: "application/json, text/html" },
      signal: AbortSignal.timeout(8_000),
    };
    const baseResponse = await safeFetchHttp(
      target,
      { ...requestInit, method: "GET" },
      allowPrivate,
    );
    await baseResponse.body?.cancel();

    if (baseResponse.status < 200 || baseResponse.status >= 400) {
      const error = `TAO base URL returned HTTP ${baseResponse.status}.`;
      await recordConnectionTest(
        context.organization.id,
        target,
        "error",
        error,
      );
      revalidateTaoSettings();
      return {
        ok: false,
        state: "error",
        statusCode: baseResponse.status,
        error,
      };
    }

    const tool = getTaoToolConfiguration(target);
    if (!tool.oidcInitiationUrl || !tool.jwksUrl || !tool.audience) {
      throw new Error("TAO Tool configuration could not be constructed.");
    }
    const oidcResponse = await safeFetchHttp(
      tool.oidcInitiationUrl,
      { ...requestInit, method: "GET" },
      allowPrivate,
    );
    await oidcResponse.body?.cancel();
    if (
      oidcResponse.status === 404 ||
      oidcResponse.status < 200 ||
      oidcResponse.status >= 500
    ) {
      throw new Error(
        `TAO OIDC initiation route returned HTTP ${oidcResponse.status}.`,
      );
    }

    const jwksResponse = await safeFetchHttp(
      tool.jwksUrl,
      { ...requestInit, method: "GET" },
      allowPrivate,
    );
    if (jwksResponse.status < 200 || jwksResponse.status >= 300) {
      await jwksResponse.body?.cancel();
      throw new Error(`TAO JWKS endpoint returned HTTP ${jwksResponse.status}.`);
    }
    let jwks: unknown;
    try {
      jwks = await jwksResponse.json();
    } catch {
      throw new Error("TAO JWKS endpoint returned invalid JSON.");
    }
    const keys =
      jwks && typeof jwks === "object" && "keys" in jwks
        ? (jwks as { keys?: unknown }).keys
        : null;
    const hasPublicRsaKey =
      Array.isArray(keys) &&
      keys.some((key) => {
        if (!key || typeof key !== "object") return false;
        const jwk = key as Record<string, unknown>;
        return (
          jwk.kty === "RSA" &&
          typeof jwk.kid === "string" &&
          typeof jwk.n === "string" &&
          typeof jwk.e === "string" &&
          !("d" in jwk) &&
          (jwk.use === undefined || jwk.use === "sig") &&
          (jwk.alg === undefined || jwk.alg === "RS256")
        );
      });
    if (!hasPublicRsaKey) {
      throw new Error("TAO JWKS response contains no valid public RSA key.");
    }
    new URL(tool.audience);

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
      metadata: { provider: "tao", statusCode: baseResponse.status },
    });
    revalidateTaoSettings();
    return {
      ok: true,
      state: "connected",
      statusCode: baseResponse.status,
    };
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
        taoDeploymentId: null,
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
