import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertNotDemo: vi.fn(),
  requirePermission: vi.fn(),
  logAuditEvent: vi.fn(),
  safeFetchHttp: vi.fn(),
  warn: vi.fn(),
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
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "where"),
  sql: vi.fn(() => "sql"),
}));
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
    taoDeploymentId: "taoDeploymentId",
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
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ warn: mocks.warn }),
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

  it("generates distinct Harly registration IDs and persists them", async () => {
    const result = await saveTaoSettingsAction(validInput);

    expect(result).toEqual({ ok: true });
    const stored = mocks.insertValues.mock.calls[0]?.[0];
    expect(stored).toEqual(
      expect.objectContaining({
        organizationId: "workspace-1",
        taoInstanceUrl: "https://tao.example.com",
        taoClientId: expect.stringMatching(/^harly-tao-[0-9a-f-]{36}$/),
        taoDeploymentId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
    expect(stored.taoClientId).not.toBe(stored.taoDeploymentId);
  });

  it("preserves existing generated IDs on subsequent saves", async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      {
        instanceUrl: "https://tao.example.com",
        clientId: "harly-tao-stable-id",
        deploymentId: "stable-deployment-id",
        lastConnectionStatus: "connected",
        lastConnectionError: null,
        lastTestedAt: new Date("2026-09-27T12:00:00Z"),
      },
    ]);

    await saveTaoSettingsAction(validInput);

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        taoClientId: "harly-tao-stable-id",
        taoDeploymentId: "stable-deployment-id",
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
      error: "TAO base URL returned HTTP 503.",
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        taoLastConnectionStatus: "error",
        taoLastConnectionError: "TAO base URL returned HTTP 503.",
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

  it("checks the derived OIDC route and validates TAO's public JWKS", async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      { instanceUrl: "https://tao.example.com" },
    ]);
    mocks.safeFetchHttp
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(
        Response.json({
          keys: [
            {
              kty: "RSA",
              kid: "tao-signing-key",
              n: "public-modulus",
              e: "AQAB",
              use: "sig",
            },
          ],
        }),
      );

    const result = await testTaoConnectionAction({
      instanceUrl: "https://tao.example.com",
    });
    expect(result).toEqual({
      ok: true,
      state: "connected",
      statusCode: 200,
    });
    expect(mocks.safeFetchHttp.mock.calls.map(([url]) => url)).toEqual([
      "https://tao.example.com",
      "https://tao.example.com/auth-server/lti1p3/oidc/initiation",
      "https://tao.example.com/auth-server/.well-known/jwks.json",
    ]);
  });

  it("rejects a TAO JWKS that contains no valid public signing key", async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      { instanceUrl: "https://tao.example.com" },
    ]);
    mocks.safeFetchHttp
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(
        Response.json({
          keys: [
            {
              kty: "RSA",
              kid: "private-key-leak",
              n: "modulus",
              e: "AQAB",
              d: "private-exponent",
            },
          ],
        }),
      );

    await expect(
      testTaoConnectionAction({ instanceUrl: "https://tao.example.com" }),
    ).resolves.toMatchObject({
      ok: false,
      state: "error",
      error: "TAO JWKS response contains no valid public RSA key.",
    });
  });

  it("clears TAO registration values on Disconnect", async () => {
    await expect(disconnectTaoAction()).resolves.toEqual({ ok: true });

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        taoEnabled: false,
        taoInstanceUrl: null,
        taoClientId: null,
        taoDeploymentId: null,
        taoLastConnectionStatus: null,
        taoLastConnectionError: null,
        taoLastTestedAt: null,
      }),
    );
  });
});
