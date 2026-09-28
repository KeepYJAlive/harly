import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from "jose";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  registrationLimit: vi.fn(),
  delete: vi.fn(),
  deleteWhere: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  safeFetchHttp: vi.fn(),
  ensureTaoSigningKey: vi.fn(),
  getHarlyPublicOrigin: vi.fn(),
  eq: vi.fn((field, value) => ({ field, value })),
  lt: vi.fn((field, value) => ({ field, value })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, lt: mocks.lt }));
vi.mock("@harly/db", () => ({
  db: {
    select: mocks.select,
    delete: mocks.delete,
    insert: mocks.insert,
  },
  taoLtiClientAssertions: {
    id: "assertion.id",
    expiresAt: "assertion.expiresAt",
  },
  workspaceSettings: {
    organizationId: "settings.organizationId",
    taoClientId: "settings.taoClientId",
    taoInstanceUrl: "settings.taoInstanceUrl",
    taoEnabled: "settings.taoEnabled",
  },
}));
vi.mock("@/lib/public-origin", () => ({
  getHarlyPublicOrigin: mocks.getHarlyPublicOrigin,
}));
vi.mock("@/lib/ssrf", () => ({ safeFetchHttp: mocks.safeFetchHttp }));
vi.mock("@/lib/tao/lti/keys", () => ({
  ensureTaoSigningKey: mocks.ensureTaoSigningKey,
}));

import { POST } from "./route";

const CLIENT_ID = "harly-tao-client-1";
const TOKEN_URL = "https://harly.example.com/api/integrations/tao/lti/token";
const SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
const ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

let taoPrivateKey: CryptoKey;
let taoPublicJwk: Awaited<ReturnType<typeof exportJWK>>;
let harlyPrivateKey: CryptoKey;
let harlyPublicJwk: Awaited<ReturnType<typeof exportJWK>>;

beforeEach(async () => {
  vi.clearAllMocks();
  const taoKeys = await generateKeyPair("RS256");
  taoPrivateKey = taoKeys.privateKey;
  taoPublicJwk = {
    ...(await exportJWK(taoKeys.publicKey)),
    kid: "tao-test-key",
    use: "sig",
    alg: "RS256",
  };
  const harlyKeys = await generateKeyPair("RS256");
  harlyPrivateKey = harlyKeys.privateKey;
  harlyPublicJwk = await exportJWK(harlyKeys.publicKey);

  mocks.getHarlyPublicOrigin.mockReturnValue("https://harly.example.com");
  mocks.select.mockReturnValue({
    from: () => ({
      where: () => ({ limit: mocks.registrationLimit }),
    }),
  });
  mocks.registrationLimit.mockResolvedValue([
    {
      organizationId: "workspace-1",
      clientId: CLIENT_ID,
      instanceUrl: "https://assessment.example.test",
      enabled: true,
    },
  ]);
  mocks.delete.mockReturnValue({ where: mocks.deleteWhere });
  mocks.deleteWhere.mockResolvedValue(undefined);
  mocks.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.insertValues.mockReturnValue({
    onConflictDoNothing: () => ({ returning: mocks.insertReturning }),
  });
  mocks.insertReturning.mockResolvedValue([{ id: "assertion-1" }]);
  mocks.safeFetchHttp.mockImplementation(async () =>
    Response.json({ keys: [taoPublicJwk] }),
  );
  mocks.ensureTaoSigningKey.mockResolvedValue({
    kid: "harly-test-key",
    privateKey: harlyPrivateKey,
  });
});

async function createAssertion(options: {
  jti?: string;
  issuer?: string;
  subject?: string;
  audience?: string;
  privateKey?: CryptoKey;
  expiresAt?: number;
} = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "tao-test-key", typ: "JWT" })
    .setIssuer(options.issuer ?? CLIENT_ID)
    .setSubject(options.subject ?? CLIENT_ID)
    .setAudience(options.audience ?? TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(options.expiresAt ?? now + 120)
    .setJti(options.jti ?? "assertion-jti-1")
    .sign(options.privateKey ?? taoPrivateKey);
}

async function requestToken(options: {
  scope?: string;
  assertion?: string;
  contentType?: string;
} = {}) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_assertion_type: ASSERTION_TYPE,
    client_assertion:
      options.assertion ?? (await createAssertion()),
    scope: options.scope ?? SCORE_SCOPE,
  });
  return POST(
    new Request(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type":
          options.contentType ?? "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }),
  );
}

describe("TAO LTI OAuth token endpoint", () => {
  it("validates TAO's client assertion and issues a short-lived score token", async () => {
    const response = await requestToken();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      token_type: "Bearer",
      expires_in: 300,
      scope: SCORE_SCOPE,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const verified = await jwtVerify(body.access_token, async () =>
      (await import("jose")).importJWK(harlyPublicJwk, "RS256"),
    );
    expect(verified.payload).toMatchObject({
      iss: "https://harly.example.com",
      aud: "https://harly.example.com",
      sub: CLIENT_ID,
      scope: SCORE_SCOPE,
    });
    expect(mocks.safeFetchHttp).toHaveBeenCalledWith(
      "https://assessment.example.test/auth-server/.well-known/jwks.json",
      expect.any(Object),
      false,
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, jti: "assertion-jti-1" }),
    );
  });

  it("rejects unsupported scopes before contacting TAO", async () => {
    const response = await requestToken({
      scope: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_scope" });
    expect(mocks.safeFetchHttp).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "wrong signature",
      options: {},
      useWrongSigningKey: true,
    },
    {
      label: "wrong issuer",
      options: { issuer: "another-client" },
      useWrongSigningKey: false,
    },
    {
      label: "wrong subject",
      options: { subject: "another-client" },
      useWrongSigningKey: false,
    },
    {
      label: "wrong audience",
      options: { audience: "https://wrong.example/token" },
      useWrongSigningKey: false,
    },
  ])("rejects a client assertion with $label", async (testCase) => {
    const signingKey = testCase.useWrongSigningKey
      ? (await generateKeyPair("RS256")).privateKey
      : taoPrivateKey;
    const assertion = await createAssertion({
      ...testCase.options,
      privateKey: signingKey,
    });
    const response = await requestToken({ assertion });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects an expired assertion", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const assertion = await createAssertion({ expiresAt: now - 30 });
    const response = await requestToken({ assertion });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a replayed assertion jti", async () => {
    mocks.insertReturning
      .mockResolvedValueOnce([{ id: "first-use" }])
      .mockResolvedValueOnce([]);
    const assertion = await createAssertion({ jti: "same-jti" });

    expect((await requestToken({ assertion })).status).toBe(200);
    const replay = await requestToken({ assertion });

    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: "invalid_client" });
  });
});