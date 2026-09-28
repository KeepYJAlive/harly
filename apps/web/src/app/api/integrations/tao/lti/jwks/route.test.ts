import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listActiveTaoPublicKeys: vi.fn() }));

vi.mock("@/lib/tao/lti/keys", () => ({
  listActiveTaoPublicKeys: mocks.listActiveTaoPublicKeys,
}));

import { GET } from "./route";

describe("Harly LTI JWKS endpoint", () => {
  it("publishes valid public signing keys without private material", async () => {
    mocks.listActiveTaoPublicKeys.mockResolvedValueOnce([
      {
        kty: "RSA",
        kid: "harly-key-1",
        use: "sig",
        alg: "RS256",
        n: "public-modulus",
        e: "AQAB",
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      kty: "RSA",
      kid: "harly-key-1",
      use: "sig",
      alg: "RS256",
      n: "public-modulus",
      e: "AQAB",
    });
    expect(body.keys[0]).not.toHaveProperty("d");
    expect(JSON.stringify(body)).not.toMatch(/privateKey|private_key|ciphertext/i);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
  });
});