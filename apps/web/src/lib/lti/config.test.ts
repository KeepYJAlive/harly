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
    taoClientSecretCiphertext: "taoClientSecretCiphertext",
    taoDeploymentId: "taoDeploymentId",
    taoOidcAuthUrl: "taoOidcAuthUrl",
    taoOauthTokenUrl: "taoOauthTokenUrl",
    taoJwksUrl: "taoJwksUrl",
    taoLaunchUrl: "taoLaunchUrl",
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

import { getWorkspaceTaoStatus } from "./config";

describe("TAO connection status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEncryptionConfigured.mockReturnValue(true);
    mocks.getHarlyPublicOrigin.mockReturnValue("https://harly.example.com");
  });

  it("reports Configured after save but before a successful connection test", async () => {
    mocks.limit.mockResolvedValueOnce([
      {
        enabled: true,
        instanceUrl: "https://tao.example.com",
        clientId: "client-1",
        clientSecretCiphertext: "encrypted",
        deploymentId: "deployment-1",
        oidcAuthUrl: null,
        oauthTokenUrl: null,
        jwksUrl: null,
        launchUrl: null,
        lastConnectionStatus: null,
        lastConnectionError: null,
        lastTestedAt: null,
      },
    ]);

    await expect(getWorkspaceTaoStatus("workspace-1")).resolves.toMatchObject({
      configured: true,
      connectionState: "configured",
      hasClientSecret: true,
      platformIssuer: "https://harly.example.com",
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
