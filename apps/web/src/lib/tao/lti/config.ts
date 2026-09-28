import "server-only";

import { eq } from "drizzle-orm";
import { db, workspaceSettings } from "@harly/db";

export type TaoLtiPlatformConfig = {
  organizationId: string;
  clientId: string;
  deploymentId: string;
  oidcInitiationUrl: string;
  launchUrl: string;
};

export async function getTaoLtiPlatformConfig(
  organizationId: string,
): Promise<TaoLtiPlatformConfig | null> {
  const [row] = await db
    .select({
      enabled: workspaceSettings.taoEnabled,
      clientId: workspaceSettings.taoClientId,
      deploymentId: workspaceSettings.taoDeploymentId,
      oidcInitiationUrl: workspaceSettings.taoOidcAuthUrl,
      launchUrl: workspaceSettings.taoLaunchUrl,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, organizationId))
    .limit(1);

  if (
    !row?.enabled ||
    !row.clientId ||
    !row.deploymentId ||
    !row.oidcInitiationUrl ||
    !row.launchUrl
  ) {
    return null;
  }

  return {
    organizationId,
    clientId: row.clientId,
    deploymentId: row.deploymentId,
    oidcInitiationUrl: row.oidcInitiationUrl,
    launchUrl: row.launchUrl,
  } as TaoLtiPlatformConfig;
}

export function buildTaoTargetLinkUri(
  configuredLaunchUrl: string,
  externalId: string,
): string {
  const url = new URL(configuredLaunchUrl);
  if (url.search || url.hash) {
    throw new Error(
      "TAO launch URL must not include a query string or fragment.",
    );
  }
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/${encodeURIComponent(externalId)}`;
  return url.toString();
}
