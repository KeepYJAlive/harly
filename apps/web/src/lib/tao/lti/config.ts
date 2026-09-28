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

export const TAO_LTI_LAUNCH_RESPONSE_PATH =
  "/deliver/api/v1/auth/launch-lti-1p3";

function parseStrictTaoUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${label} must not contain a query string or fragment.`);
  }
  return url;
}

/** The fixed TAO endpoint to which the platform posts its OIDC response. */
export function buildTaoLaunchResponseUri(configuredTaoUrl: string): string {
  const configured = parseStrictTaoUrl(configuredTaoUrl, "TAO URL");
  const response = new URL(configured.origin);
  response.pathname = TAO_LTI_LAUNCH_RESPONSE_PATH;
  return response.toString();
}

export function isTrustedTaoLaunchResponseUri(
  receivedRedirectUri: string,
  configuredTaoUrl: string,
): boolean {
  try {
    const received = parseStrictTaoUrl(receivedRedirectUri, "redirect_uri");
    return received.toString() === buildTaoLaunchResponseUri(configuredTaoUrl);
  } catch {
    return false;
  }
}

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
  const configured = parseStrictTaoUrl(
    configuredLaunchUrl,
    "TAO launch URL",
  );
  if (
    configured.pathname.replace(/\/+$/, "") !==
    TAO_LTI_LAUNCH_RESPONSE_PATH
  ) {
    throw new Error("TAO launch URL has an unexpected path.");
  }
  if (!externalId || externalId !== externalId.trim()) {
    throw new Error("TAO delivery ID is invalid.");
  }
  const url = new URL(buildTaoLaunchResponseUri(configuredLaunchUrl));
  url.pathname = `${TAO_LTI_LAUNCH_RESPONSE_PATH}/${encodeURIComponent(externalId)}`;
  return url.toString();
}

export function isTrustedTaoTargetLinkUri(
  receivedTargetLinkUri: string,
  configuredLaunchUrl: string,
  externalId: string,
): boolean {
  try {
    const received = parseStrictTaoUrl(
      receivedTargetLinkUri,
      "target_link_uri",
    );
    return (
      received.toString() ===
      buildTaoTargetLinkUri(configuredLaunchUrl, externalId)
    );
  } catch {
    return false;
  }
}
