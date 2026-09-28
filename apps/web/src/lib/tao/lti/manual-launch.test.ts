import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  getWorkspaceContextOrNull: vi.fn(),
  createOauthStateNonce: vi.fn(),
  verifyAndConsumeOauthStateNonce: vi.fn(),
  signManualTaoLtiLaunch: vi.fn(),
  logAuditEvent: vi.fn(),
  requireActorPermission: vi.fn(),
}));

vi.mock("@harly/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
  },
  workspaceSettings: {
    organizationId: "organizationId",
    taoEnabled: "taoEnabled",
    taoClientId: "taoClientId",
    taoDeploymentId: "taoDeploymentId",
    taoInstanceUrl: "taoInstanceUrl",
  },
}));
vi.mock("@/features/workspaces/context", () => ({
  getWorkspaceContextOrNull: mocks.getWorkspaceContextOrNull,
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requireActorPermission: mocks.requireActorPermission,
}));
vi.mock("@/lib/audit-log", () => ({
  logAuditEvent: mocks.logAuditEvent,
}));
vi.mock("@/lib/public-origin", () => ({
  getHarlyPublicOrigin: () => "https://opportunities.keepyjalive.org",
  toHarlyPublicUrl: (path: string) =>
    `https://opportunities.keepyjalive.org${path}`,
}));
vi.mock("@/server/oauth-state", () => ({
  createOauthStateNonce: mocks.createOauthStateNonce,
  verifyAndConsumeOauthStateNonce: mocks.verifyAndConsumeOauthStateNonce,
}));
vi.mock("./jwt", () => ({
  signManualTaoLtiLaunch: mocks.signManualTaoLtiLaunch,
}));

import {
  authorizeManualTaoTestLaunch,
  beginManualTaoTestLaunch,
  MANUAL_TAO_TEST,
  validateManualTaoAuthorizationRequest,
  validateManualTaoRegistration,
} from "./manual-launch";

const registration = {
  organizationId: "org-1",
  clientId: MANUAL_TAO_TEST.clientId,
  deploymentId: MANUAL_TAO_TEST.deploymentId,
  instanceUrl: MANUAL_TAO_TEST.taoOrigin,
};

const authorization = {
  clientId: MANUAL_TAO_TEST.clientId,
  redirectUri: MANUAL_TAO_TEST.targetLinkUri,
  loginHint: "signed-login-hint-" + "a".repeat(50),
  messageHint: MANUAL_TAO_TEST.messageHint,
  nonce: "nonce-issued-by-tao-with-entropy",
  state: "state-issued-by-tao-with-entropy",
  responseType: "id_token",
  responseMode: "form_post",
  scope: "openid",
  prompt: "none",
};

describe("manual TAO Production Test launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectLimit.mockResolvedValue([
      {
        organizationId: "org-1",
        enabled: true,
        clientId: MANUAL_TAO_TEST.clientId,
        deploymentId: MANUAL_TAO_TEST.deploymentId,
        instanceUrl: MANUAL_TAO_TEST.taoOrigin,
      },
    ]);
    mocks.getWorkspaceContextOrNull.mockResolvedValue({
      organization: { id: "org-1" },
      user: { id: "user-1", email: "owner@example.com" },
    });
    mocks.createOauthStateNonce.mockResolvedValue(authorization.loginHint);
    mocks.verifyAndConsumeOauthStateNonce.mockResolvedValue({
      ok: true,
      workspaceId: "org-1",
    });
    mocks.signManualTaoLtiLaunch.mockResolvedValue("signed-id-token");
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.requireActorPermission.mockResolvedValue(["integrations:manage"]);
  });

  it("builds the exact TAO OIDC initiation request", async () => {
    const destination = await beginManualTaoTestLaunch({
      organizationId: "org-1",
      userId: "user-1",
    });
    const url = new URL(destination);
    expect(url.origin + url.pathname).toBe(MANUAL_TAO_TEST.oidcInitiationUrl);
    expect(url.searchParams.get("iss")).toBe(MANUAL_TAO_TEST.issuer);
    expect(url.searchParams.get("client_id")).toBe(MANUAL_TAO_TEST.clientId);
    expect(url.searchParams.get("lti_deployment_id")).toBe(
      MANUAL_TAO_TEST.deploymentId,
    );
    expect(url.searchParams.get("target_link_uri")).toBe(
      MANUAL_TAO_TEST.targetLinkUri,
    );
    expect(url.searchParams.get("login_hint")).toBe(authorization.loginHint);
  });

  it("rejects an invalid client ID", () => {
    expect(
      validateManualTaoAuthorizationRequest(
        { ...authorization, clientId: "attacker-client" },
        registration,
      ),
    ).toBe("Invalid client_id.");
  });

  it.each([
    "https://evil.example/deliver/api/v1/auth/launch-lti-1p3/9ddca443197e",
    "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3/other",
    "http://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3/9ddca443197e",
  ])("rejects an untrusted target/redirect URI: %s", (redirectUri) => {
    expect(
      validateManualTaoAuthorizationRequest(
        { ...authorization, redirectUri },
        registration,
      ),
    ).toBe("Untrusted redirect_uri.");
  });

  it("validates configured issuer, client, deployment, and TAO origin", () => {
    expect(
      validateManualTaoRegistration({
        enabled: true,
        clientId: MANUAL_TAO_TEST.clientId,
        deploymentId: MANUAL_TAO_TEST.deploymentId,
        instanceUrl: MANUAL_TAO_TEST.taoOrigin,
        publicOrigin: MANUAL_TAO_TEST.issuer,
      }),
    ).toBeNull();
    expect(
      validateManualTaoRegistration({
        enabled: true,
        clientId: MANUAL_TAO_TEST.clientId,
        deploymentId: MANUAL_TAO_TEST.deploymentId,
        instanceUrl: "https://evil.example",
        publicOrigin: MANUAL_TAO_TEST.issuer,
      }),
    ).toMatch(/origin/);
  });

  it("consumes the Harly login state once and propagates TAO's nonce", async () => {
    const result = await authorizeManualTaoTestLaunch(authorization);
    expect(mocks.verifyAndConsumeOauthStateNonce).toHaveBeenCalledWith({
      state: authorization.loginHint,
      userId: "user-1",
      workspaceId: "org-1",
      provider: MANUAL_TAO_TEST.stateProvider,
    });
    expect(mocks.requireActorPermission).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      "integrations:manage",
    );
    expect(mocks.signManualTaoLtiLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: authorization.nonce,
        clientId: MANUAL_TAO_TEST.clientId,
        deploymentId: MANUAL_TAO_TEST.deploymentId,
        targetLinkUri: MANUAL_TAO_TEST.targetLinkUri,
        tenantId: "1",
        deliveryId: MANUAL_TAO_TEST.deliveryId,
        assessmentName: MANUAL_TAO_TEST.assessmentName,
      }),
    );
    expect(result).toEqual({
      redirectUri: MANUAL_TAO_TEST.targetLinkUri,
      idToken: "signed-id-token",
      state: authorization.state,
    });
  });
});
