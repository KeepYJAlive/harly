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
  hasClientSecret: boolean;
  deploymentId: string | null;
  oidcAuthUrl: string | null;
  oauthTokenUrl: string | null;
  jwksUrl: string | null;
  launchUrl: string | null;
  lastConnectionError: string | null;
  lastTestedAt: string | null;
  encryptionReady: boolean;
  platformIssuer: string;
  platformAuthorizationUrl: string;
  platformJwksUrl: string;
};

export async function getWorkspaceTaoStatus(
  workspaceId: string,
): Promise<WorkspaceTaoStatus> {
  const [row] = await db
    .select({
      enabled: workspaceSettings.taoEnabled,
      instanceUrl: workspaceSettings.taoInstanceUrl,
      clientId: workspaceSettings.taoClientId,
      clientSecretCiphertext: workspaceSettings.taoClientSecretCiphertext,
      deploymentId: workspaceSettings.taoDeploymentId,
      oidcAuthUrl: workspaceSettings.taoOidcAuthUrl,
      oauthTokenUrl: workspaceSettings.taoOauthTokenUrl,
      jwksUrl: workspaceSettings.taoJwksUrl,
      launchUrl: workspaceSettings.taoLaunchUrl,
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
  return {
    enabled: row?.enabled ?? false,
    configured,
    connectionState,
    instanceUrl: row?.instanceUrl ?? null,
    clientId: row?.clientId ?? null,
    hasClientSecret: Boolean(row?.clientSecretCiphertext),
    deploymentId: row?.deploymentId ?? null,
    oidcAuthUrl: row?.oidcAuthUrl ?? null,
    oauthTokenUrl: row?.oauthTokenUrl ?? null,
    jwksUrl: row?.jwksUrl ?? null,
    launchUrl: row?.launchUrl ?? null,
    lastConnectionError: row?.lastConnectionError ?? null,
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    encryptionReady: isEncryptionConfigured(),
    platformIssuer: origin,
    platformAuthorizationUrl: `${origin}/api/integrations/tao/lti/authorize`,
    platformJwksUrl: `${origin}/api/integrations/tao/lti/jwks`,
  };
}
