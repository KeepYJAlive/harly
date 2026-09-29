import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  isEncryptionConfigured: vi.fn(),
  getHarlyPublicOrigin: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => "where") }));
vi.mock("@harly/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.limit })),
      })),
    })),
  },
  workspaceSettings: {
    organizationId: "organizationId",
    taoEnabled: "taoEnabled",
    taoInstanceUrl: "taoInstanceUrl",
    taoClientId: "taoClientId",
    taoDeploymentId: "taoDeploymentId",
    taoLastConnectionStatus: "taoLastConnectionStatus",
    taoLastConnectionError: "taoLastConnectionError",
    taoLastTestedAt: "taoLastTestedAt",
  },
}));
vi.mock("@/lib/crypto", () => ({
  isEncryptionConfigured: mocks.isEncryptionConfigured,
}));
vi.mock("@/lib/public-origin", () => ({
  getHarlyPublicOrigin: mocks.getHarlyPublicOrigin,
}));

import { getTaoToolConfiguration, getWorkspaceTaoStatus } from "./config";

describe("TAO connection status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEncryptionConfigured.mockReturnValue(true);
    mocks.getHarlyPublicOrigin.mockReturnValue("https://harly.example.com");
  });

  it("derives stable TAO Tool endpoints from the configured base origin", () => {
    expect(getTaoToolConfiguration("https://tao.example.com/tenant")).toEqual({
      oidcInitiationUrl:
        "https://tao.example.com/auth-server/lti1p3/oidc/initiation",
      jwksUrl: "https://tao.example.com/auth-server/.well-known/jwks.json",
      audience: "https://tao.example.com/deliver",
      deliveryTargetLinkPattern:
        "https://tao.example.com/deliver/api/v1/auth/launch-lti-1p3/{deliveryId}",
    });
    expect(getTaoToolConfiguration(null)).toEqual({
      oidcInitiationUrl: null,
      jwksUrl: null,
      audience: null,
      deliveryTargetLinkPattern: null,
    });
  });

  it("reports Configured after save but before a successful connection test", async () => {
    mocks.limit.mockResolvedValueOnce([
      {
        enabled: true,
        instanceUrl: "https://tao.example.com",
        clientId: "harly-tao-client-1",
        deploymentId: "deployment-1",
        lastConnectionStatus: null,
        lastConnectionError: null,
        lastTestedAt: null,
      },
    ]);

    await expect(getWorkspaceTaoStatus("workspace-1")).resolves.toMatchObject({
      configured: true,
      connectionState: "configured",
      clientId: "harly-tao-client-1",
      deploymentId: "deployment-1",
      platformIssuer: "https://harly.example.com",
      platformTokenUrl:
        "https://harly.example.com/api/integrations/tao/lti/token",
      platformAgsLineItemPattern:
        "https://harly.example.com/api/integrations/tao/lti/ags/lineitems/{assignmentId}",
      taoOidcInitiationUrl:
        "https://tao.example.com/auth-server/lti1p3/oidc/initiation",
      taoJwksUrl: "https://tao.example.com/auth-server/.well-known/jwks.json",
      taoToolAudience: "https://tao.example.com/deliver",
      taoDeliveryTargetLinkPattern:
        "https://tao.example.com/deliver/api/v1/auth/launch-lti-1p3/{deliveryId}",
    });
  });

  it("only reports Connected after a successful persisted test", async () => {
    mocks.limit.mockResolvedValueOnce([
      {
        enabled: true,
        instanceUrl: "https://tao.example.com",
        clientSecretCiphertext: null,
        lastConnectionStatus: "connected",
        lastConnectionError: null,
        lastTestedAt: new Date("2026-09-27T12:00:00Z"),
      },
    ]);

    await expect(getWorkspaceTaoStatus("workspace-1")).resolves.toMatchObject({
      connectionState: "connected",
      lastTestedAt: "2026-09-27T12:00:00.000Z",
    });
  });
});
