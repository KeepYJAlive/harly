import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePersonalReferralToken: vi.fn(),
}));

vi.mock("@/features/candidates/referrals/personal-data", () => ({
  resolvePersonalReferralToken: mocks.resolvePersonalReferralToken,
}));

import { GET } from "./route";

function request(token = "opaque-token") {
  return GET(new NextRequest(`https://0.0.0.0:3000/referral/${token}`), {
    params: Promise.resolve({ token }),
  });
}

describe("public personal referral link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HARLY_URL", "https://harly.example");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects through the public origin, stores only minimum referral context, and never authenticates the visitor", async () => {
    mocks.resolvePersonalReferralToken.mockResolvedValue({ status: "pending" });

    const response = await request();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://harly.example/referral",
    );
    expect(response.cookies.get("harly_referral_context")?.value).toBe(
      "opaque-token",
    );
    expect(response.cookies.get("harly_portal_session")).toBeUndefined();
  });

  it.each([null, { status: "revoked" }, { status: "expired" }])(
    "rejects invalid or unavailable referral context safely",
    async (resolved) => {
      mocks.resolvePersonalReferralToken.mockResolvedValue(resolved);

      const response = await request("untrusted-value");

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://harly.example/referral?error=unavailable",
      );
      expect(response.cookies.get("harly_referral_context")?.value).toBe("");
      expect(response.headers.get("location")).not.toContain("untrusted-value");
    },
  );
});
