import "server-only";

import { eq } from "drizzle-orm";

import { db, workspaceSettings } from "@harly/db";

import { isEncryptionConfigured } from "@/lib/crypto";
import { getHarlyPublicOrigin } from "@/lib/public-origin";

export type TaoConnectionState =
  | "not_configured"
  | "configured"
  | "connected"
  | "error";

export type WorkspaceTaoStatus = {
  enabled: boolean;
  configured: boolean;
  connectionState: TaoConnectionState;
  instanceUrl: string | null;
  clientId: string | null;
  deploymentId: string | null;
  taoOidcInitiationUrl: string | null;
  taoJwksUrl: string | null;
  taoToolAudience: string | null;
  taoDeliveryTargetLinkPattern: string | null;
  lastConnectionError: string | null;
  lastTestedAt: string | null;
  encryptionReady: boolean;
  platformIssuer: string;
  platformAuthorizationUrl: string;
  platformTokenUrl: string;
  platformJwksUrl: string;
};

export function getTaoToolConfiguration(instanceUrl: string | null) {
  if (!instanceUrl) {
    return {
      oidcInitiationUrl: null,
      jwksUrl: null,
      audience: null,
      deliveryTargetLinkPattern: null,
    };
  }
  const origin = new URL(instanceUrl).origin;
  return {
    oidcInitiationUrl: `${origin}/auth-server/lti1p3/oidc/initiation`,
    jwksUrl: `${origin}/auth-server/.well-known/jwks.json`,
    audience: `${origin}/deliver`,
    deliveryTargetLinkPattern: `${origin}/deliver/api/v1/auth/launch-lti-1p3/{deliveryId}`,
  };
}

export async function getWorkspaceTaoStatus(
  workspaceId: string,
): Promise<WorkspaceTaoStatus> {
  const [row] = await db
    .select({
      enabled: workspaceSettings.taoEnabled,
      instanceUrl: workspaceSettings.taoInstanceUrl,
      clientId: workspaceSettings.taoClientId,
      deploymentId: workspaceSettings.taoDeploymentId,
      lastConnectionStatus: workspaceSettings.taoLastConnectionStatus,
      lastConnectionError: workspaceSettings.taoLastConnectionError,
      lastTestedAt: workspaceSettings.taoLastTestedAt,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, workspaceId))
    .limit(1);

  const configured = Boolean(row?.enabled && row.instanceUrl);
  const connectionState: TaoConnectionState = !configured
    ? "not_configured"
    : row?.lastConnectionStatus === "connected"
      ? "connected"
      : row?.lastConnectionStatus === "error"
        ? "error"
        : "configured";

  const origin = getHarlyPublicOrigin();
  const deploymentId = row?.deploymentId ?? null;
  const tool = getTaoToolConfiguration(row?.instanceUrl ?? null);

  return {
    enabled: row?.enabled ?? false,
    configured,
    connectionState,
    instanceUrl: row?.instanceUrl ?? null,
    clientId: row?.clientId ?? null,
    deploymentId,
    taoOidcInitiationUrl: tool.oidcInitiationUrl,
    taoJwksUrl: tool.jwksUrl,
    taoToolAudience: tool.audience,
    taoDeliveryTargetLinkPattern: tool.deliveryTargetLinkPattern,
    lastConnectionError: row?.lastConnectionError ?? null,
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    encryptionReady: isEncryptionConfigured(),
    platformIssuer: origin,
    platformAuthorizationUrl: `${origin}/api/integrations/tao/lti/authorize`,
    platformTokenUrl: `${origin}/api/integrations/tao/lti/token`,
    platformJwksUrl: `${origin}/api/integrations/tao/lti/jwks`,
  };
}
