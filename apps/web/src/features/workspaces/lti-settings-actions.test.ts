import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertNotDemo: vi.fn(),
  requirePermission: vi.fn(),
  logAuditEvent: vi.fn(),
  encryptSecret: vi.fn(),
  safeFetchHttp: vi.fn(),
  selectLimit: vi.fn(),
  insertValues: vi.fn(),
  insertOnConflict: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  revalidatePath: vi.fn(),
  ensureTaoSigningKey: vi.fn(),
  deleteWhere: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => "where") }));
vi.mock("@harly/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
    insert: vi.fn(() => ({ values: mocks.insertValues })),
    update: vi.fn(() => ({ set: mocks.updateSet })),
    delete: vi.fn(() => ({ where: mocks.deleteWhere })),
    transaction: vi.fn(async (callback) =>
      callback({
        update: vi.fn(() => ({ set: mocks.updateSet })),
        delete: vi.fn(() => ({ where: mocks.deleteWhere })),
      }),
    ),
  },
  taoLtiSigningKeys: { organizationId: "organizationId" },
  workspaceSettings: {
    organizationId: "organizationId",
    taoEnabled: "taoEnabled",
    taoInstanceUrl: "taoInstanceUrl",
    taoClientId: "taoClientId",
    taoClientSecretCiphertext: "taoClientSecretCiphertext",
    taoClientSecretIv: "taoClientSecretIv",
    taoClientSecretTag: "taoClientSecretTag",
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
vi.mock("@/features/demo/assert-not-demo", () => ({
  assertNotDemo: mocks.assertNotDemo,
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock("@/lib/crypto", () => ({ encryptSecret: mocks.encryptSecret }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));
vi.mock("@/lib/ssrf", () => ({ safeFetchHttp: mocks.safeFetchHttp }));
vi.mock("@/lib/tao/lti/keys", () => ({
  ensureTaoSigningKey: mocks.ensureTaoSigningKey,
}));

import {
  disconnectTaoAction,
  saveTaoSettingsAction,
  testTaoConnectionAction,
} from "./lti-settings-actions";

const validInput = {
  instanceUrl: "https://tao.example.com/",
  clientId: "client-1",
  clientSecret: "",
  deploymentId: "deployment-1",
  oidcAuthUrl: "https://tao.example.com/custom/authorize",
  oauthTokenUrl: "https://tao.example.com/custom/token",
  jwksUrl: "https://tao.example.com/custom/jwks",
  launchUrl: "https://tao.example.com/custom/launch",
};

describe("TAO settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HARLY_ALLOW_PRIVATE_TAO;
    mocks.requirePermission.mockResolvedValue({
      organization: { id: "workspace-1" },
      user: { id: "user-1", email: "owner@example.com" },
    });
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.ensureTaoSigningKey.mockResolvedValue({ kid: "key-1" });
    mocks.selectLimit.mockResolvedValue([]);
    mocks.insertOnConflict.mockResolvedValue([]);
    mocks.insertValues.mockReturnValue({
      onConflictDoUpdate: mocks.insertOnConflict,
    });
    mocks.updateWhere.mockResolvedValue([]);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.deleteWhere.mockResolvedValue([]);
    mocks.encryptSecret.mockReturnValue({
      ciphertext: "encrypted-secret",
      iv: "encrypted-iv",
      tag: "encrypted-tag",
    });
  });

  it.each([
    ["Save", () => saveTaoSettingsAction(validInput)],
    [
      "Test connection",
      () => testTaoConnectionAction({ instanceUrl: validInput.instanceUrl }),
    ],
    ["Disconnect", () => disconnectTaoAction()],
  ])("requires integrations:manage for %s", async (_label, mutate) => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("forbidden"));

    await expect(mutate()).rejects.toThrow("forbidden");
    expect(mocks.requirePermission).toHaveBeenCalledWith("integrations:manage");
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("validates settings and normalizes URLs before storage", async () => {
    const result = await saveTaoSettingsAction(validInput);

    expect(result).toEqual({ ok: true });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "workspace-1",
        taoInstanceUrl: "https://tao.example.com",
        taoOidcAuthUrl: "https://tao.example.com/custom/authorize",
        taoOauthTokenUrl: "https://tao.example.com/custom/token",
        taoJwksUrl: "https://tao.example.com/custom/jwks",
        taoLaunchUrl: "https://tao.example.com/custom/launch",
      }),
    );
  });

  it("encrypts a supplied credential and never stores its plaintext", async () => {
    await saveTaoSettingsAction({ ...validInput, clientSecret: "top-secret" });

    expect(mocks.encryptSecret).toHaveBeenCalledWith("top-secret");
    const stored = mocks.insertValues.mock.calls[0]?.[0];
    expect(stored).toEqual(
      expect.objectContaining({
        taoClientSecretCiphertext: "encrypted-secret",
        taoClientSecretIv: "encrypted-iv",
        taoClientSecretTag: "encrypted-tag",
      }),
    );
    expect(JSON.stringify(stored)).not.toContain("top-secret");
  });

  it("preserves an existing encrypted credential when the edit field is blank", async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      {
        instanceUrl: "https://tao.example.com",
        clientSecretCiphertext: "stored-ciphertext",
        clientSecretIv: "stored-iv",
        clientSecretTag: "stored-tag",
        lastConnectionStatus: "connected",
        lastConnectionError: null,
        lastTestedAt: new Date("2026-09-27T12:00:00Z"),
      },
    ]);

    await saveTaoSettingsAction(validInput);

    expect(mocks.encryptSecret).not.toHaveBeenCalled();
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        taoClientSecretCiphertext: "stored-ciphertext",
        taoClientSecretIv: "stored-iv",
        taoClientSecretTag: "stored-tag",
        taoLastConnectionStatus: "connected",
      }),
    );
  });

  it("rejects an unsafe/private connection destination", async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      { instanceUrl: "https://127.0.0.1" },
    ]);
    mocks.safeFetchHttp.mockRejectedValueOnce(
      new Error("URL points to a blocked host."),
    );

    const result = await testTaoConnectionAction({
      instanceUrl: "https://127.0.0.1",
    });

    expect(result).toEqual({
      ok: false,
      state: "error",
      error: "The TAO URL resolves to an unsafe or private destination.",
    });
    expect(mocks.safeFetchHttp).toHaveBeenCalledWith(
      "https://127.0.0.1",
      expect.objectContaining({ method: "GET" }),
      false,
    );
  });

  it("returns and records an unexpected HTTP response", async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      { instanceUrl: "https://tao.example.com" },
    ]);
    mocks.safeFetchHttp.mockResolvedValueOnce(
      new Response(null, { status: 503 }),
    );

    const result = await testTaoConnectionAction({
      instanceUrl: "https://tao.example.com",
    });

    expect(result).toEqual({
      ok: false,
      state: "error",
      statusCode: 503,
      error:
        "TAO returned HTTP 503; expected a successful response or redirect.",
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        taoLastConnectionStatus: "error",
        taoLastConnectionError:
          "TAO returned HTTP 503; expected a successful response or redirect.",
      }),
    );
  });

  it.each([
    [
      "DNS failure",
      Object.assign(new Error("getaddrinfo failed"), { code: "ENOTFOUND" }),
      "The TAO hostname could not be resolved.",
    ],
    [
      "connection timeout",
      Object.assign(new Error("request aborted"), { name: "AbortError" }),
      "The TAO server did not respond within 8 seconds.",
    ],
    [
      "TLS failure",
      Object.assign(new Error("unable to verify certificate"), {
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      }),
      "The TAO server's TLS certificate could not be verified.",
    ],
  ])(
    "returns and records a useful %s message",
    async (_label, failure, message) => {
      mocks.selectLimit.mockResolvedValueOnce([
        { instanceUrl: "https://tao.example.com" },
      ]);
      mocks.safeFetchHttp.mockRejectedValueOnce(failure);

      const result = await testTaoConnectionAction({
        instanceUrl: "https://tao.example.com",
      });

      expect(result).toEqual({ ok: false, state: "error", error: message });
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          taoLastConnectionStatus: "error",
          taoLastConnectionError: message,
        }),
      );
    },
  );

  it("clears all TAO configuration and encrypted credentials on Disconnect", async () => {
    await expect(disconnectTaoAction()).resolves.toEqual({ ok: true });

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
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
      }),
    );
  });
});
