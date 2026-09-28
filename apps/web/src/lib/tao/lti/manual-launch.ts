import "server-only";

import { and, eq } from "drizzle-orm";
import { db, workspaceSettings } from "@harly/db";

import { getWorkspaceContextOrNull } from "@/features/workspaces/context";
import { requireActorPermission } from "@/features/workspaces/permissions-server";
import { logAuditEvent } from "@/lib/audit-log";
import { getHarlyPublicOrigin, toHarlyPublicUrl } from "@/lib/public-origin";
import {
  createOauthStateNonce,
  verifyAndConsumeOauthStateNonce,
} from "@/server/oauth-state";
import { createLtiFormPostHtml } from "./html";
import { signManualTaoLtiLaunch } from "./jwt";
import type { OidcAuthorizationInput } from "./state";

export const MANUAL_TAO_TEST = {
  issuer: "https://opportunities.keepyjalive.org",
  clientId: "harly-tao-f3695cee-3122-4e89-a2ce-c0c4ef364718",
  deploymentId: "f0d717d2-02ff-468e-bfea-e59c65ce4e75",
  taoOrigin: "https://assessment.keepyjalive.org",
  oidcInitiationUrl:
    "https://assessment.keepyjalive.org/auth-server/lti1p3/oidc/initiation",
  deliveryId: "9ddca443197e",
  targetLinkUri:
    "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3/9ddca443197e",
  assessmentName: "Production Test",
  tenantId: "1",
  messageHint: "harly-tao-manual-production-test-v1",
  stateProvider: "tao-lti-manual-production-test",
} as const;

type ManualRegistration = {
  organizationId: string;
  clientId: string;
  deploymentId: string;
  instanceUrl: string;
};

export class ManualTaoLaunchError extends Error {}

export function isManualTaoTestLaunchEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.HARLY_TAO_MANUAL_TEST_LAUNCH === "true"
  );
}

export function validateManualTaoRegistration(input: {
  enabled: boolean;
  clientId: string | null;
  deploymentId: string | null;
  instanceUrl: string | null;
  publicOrigin: string;
}): string | null {
  if (!input.enabled) return "The TAO integration is disabled.";
  if (input.clientId !== MANUAL_TAO_TEST.clientId) {
    return "The configured TAO client ID does not match the manual test registration.";
  }
  if (input.deploymentId !== MANUAL_TAO_TEST.deploymentId) {
    return "The configured TAO deployment ID does not match the manual test registration.";
  }
  if (!input.instanceUrl) return "The TAO base URL is not configured.";
  let configuredOrigin: string;
  try {
    configuredOrigin = new URL(input.instanceUrl).origin;
  } catch {
    return "The configured TAO base URL is invalid.";
  }
  if (configuredOrigin !== MANUAL_TAO_TEST.taoOrigin) {
    return "The configured TAO origin does not match the manual test target.";
  }
  if (input.publicOrigin !== MANUAL_TAO_TEST.issuer) {
    return "HARLY_URL does not match the issuer registered in TAO for this test.";
  }
  return null;
}

export function validateManualTaoAuthorizationRequest(
  input: OidcAuthorizationInput,
  registration: ManualRegistration,
): string | null {
  if (input.clientId !== registration.clientId) return "Invalid client_id.";
  if (input.clientId !== MANUAL_TAO_TEST.clientId) return "Invalid client_id.";
  if (input.messageHint !== MANUAL_TAO_TEST.messageHint) {
    return "Invalid lti_message_hint.";
  }
  if (input.redirectUri !== MANUAL_TAO_TEST.targetLinkUri) {
    return "Untrusted redirect_uri.";
  }
  let redirect: URL;
  let configured: URL;
  try {
    redirect = new URL(input.redirectUri);
    configured = new URL(registration.instanceUrl);
  } catch {
    return "Invalid redirect_uri.";
  }
  if (
    redirect.origin !== configured.origin ||
    redirect.origin !== MANUAL_TAO_TEST.taoOrigin ||
    redirect.protocol !== "https:"
  ) {
    return "Untrusted redirect_uri.";
  }
  if (input.responseType !== "id_token") return "Unsupported response_type.";
  if (input.responseMode !== "form_post") return "Unsupported response_mode.";
  if (!input.scope.split(/\s+/).includes("openid")) {
    return "openid scope is required.";
  }
  if (input.prompt && input.prompt !== "none") return "Unsupported prompt.";
  if (input.state.length < 16 || input.state.length > 2_000) {
    return "Invalid state.";
  }
  if (input.nonce.length < 16 || input.nonce.length > 2_000) {
    return "Invalid nonce.";
  }
  if (input.loginHint.length < 40 || input.loginHint.length > 4_000) {
    return "Invalid login_hint.";
  }
  return null;
}

async function readManualRegistration(
  organizationId: string,
): Promise<ManualRegistration> {
  const [row] = await db
    .select({
      organizationId: workspaceSettings.organizationId,
      enabled: workspaceSettings.taoEnabled,
      clientId: workspaceSettings.taoClientId,
      deploymentId: workspaceSettings.taoDeploymentId,
      instanceUrl: workspaceSettings.taoInstanceUrl,
    })
    .from(workspaceSettings)
    .where(
      and(
        eq(workspaceSettings.organizationId, organizationId),
        eq(workspaceSettings.taoEnabled, true),
      ),
    )
    .limit(1);

  const error = validateManualTaoRegistration({
    enabled: row?.enabled ?? false,
    clientId: row?.clientId ?? null,
    deploymentId: row?.deploymentId ?? null,
    instanceUrl: row?.instanceUrl ?? null,
    publicOrigin: getHarlyPublicOrigin(),
  });
  if (error || !row?.clientId || !row.deploymentId || !row.instanceUrl) {
    throw new ManualTaoLaunchError(error ?? "TAO registration is incomplete.");
  }
  return {
    organizationId,
    clientId: row.clientId,
    deploymentId: row.deploymentId,
    instanceUrl: row.instanceUrl,
  };
}

export async function beginManualTaoTestLaunch(input: {
  organizationId: string;
  userId: string;
}) {
  if (!isManualTaoTestLaunchEnabled()) {
    throw new ManualTaoLaunchError("Manual TAO test launch is disabled.");
  }
  const registration = await readManualRegistration(input.organizationId);
  const loginHint = await createOauthStateNonce({
    userId: input.userId,
    workspaceId: input.organizationId,
    provider: MANUAL_TAO_TEST.stateProvider,
  });
  const url = new URL(MANUAL_TAO_TEST.oidcInitiationUrl);
  url.searchParams.set("iss", MANUAL_TAO_TEST.issuer);
  url.searchParams.set("login_hint", loginHint);
  url.searchParams.set("target_link_uri", MANUAL_TAO_TEST.targetLinkUri);
  url.searchParams.set("lti_message_hint", MANUAL_TAO_TEST.messageHint);
  url.searchParams.set("client_id", registration.clientId);
  url.searchParams.set("lti_deployment_id", registration.deploymentId);
  return url.toString();
}

export async function authorizeManualTaoTestLaunch(
  input: OidcAuthorizationInput,
) {
  if (!isManualTaoTestLaunchEnabled()) {
    throw new ManualTaoLaunchError("Manual TAO test launch is disabled.");
  }
  const context = await getWorkspaceContextOrNull();
  if (!context) throw new ManualTaoLaunchError("The test session is unavailable.");
  await requireActorPermission(
    context.organization.id,
    context.user.id,
    "integrations:manage",
  );
  const registration = await readManualRegistration(context.organization.id);
  const requestError = validateManualTaoAuthorizationRequest(input, registration);
  if (requestError) throw new ManualTaoLaunchError(requestError);

  const stateCheck = await verifyAndConsumeOauthStateNonce({
    state: input.loginHint,
    userId: context.user.id,
    workspaceId: context.organization.id,
    provider: MANUAL_TAO_TEST.stateProvider,
  });
  if (!stateCheck.ok) {
    throw new ManualTaoLaunchError("The manual launch state is invalid or expired.");
  }

  const idToken = await signManualTaoLtiLaunch({
    organizationId: context.organization.id,
    clientId: registration.clientId,
    deploymentId: registration.deploymentId,
    nonce: input.nonce,
    targetLinkUri: MANUAL_TAO_TEST.targetLinkUri,
    returnUrl: toHarlyPublicUrl("/settings/integrations/tao"),
    tenantId: MANUAL_TAO_TEST.tenantId,
    deliveryId: MANUAL_TAO_TEST.deliveryId,
    assessmentName: MANUAL_TAO_TEST.assessmentName,
  });
  await logAuditEvent({
    workspaceId: context.organization.id,
    actorId: context.user.id,
    actorEmail: context.user.email,
    action: "integrations.tao_manual_test_launched",
    resourceType: "workspace_integration",
    resourceId: context.organization.id,
    metadata: {
      provider: "tao",
      deliveryId: MANUAL_TAO_TEST.deliveryId,
    },
  });
  return {
    redirectUri: MANUAL_TAO_TEST.targetLinkUri,
    idToken,
    state: input.state,
  };
}

export function createManualLtiFormPost(input: {
  redirectUri: string;
  idToken: string;
  state: string;
}) {
  return createLtiFormPostHtml({
    target: input.redirectUri,
    idToken: input.idToken,
    state: input.state,
  });
}
