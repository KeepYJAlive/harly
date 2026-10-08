import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@harly/auth/cookies", () => ({ getSessionCookie: () => null }));
vi.mock("@/lib/two-factor", () => ({ mustSetUp2fa: vi.fn() }));
vi.mock("@/server/security/policy", () => ({
  detectSuspiciousSession: vi.fn(),
  getTrustedClientIp: vi.fn(),
  isEmailDomainAllowed: vi.fn(),
  isIpAllowed: vi.fn(),
}));
import { proxy } from "./proxy";
describe("RemoteSource ingress", () => {
  it("lets the vocabulary GET route perform Basic authentication without a staff session", async () => {
    const response = await proxy(
      new NextRequest("https://harly.test/api/plugins/tao/remote-lists/topics"),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
  });
  it("keeps integration configuration behind staff sign-in", async () => {
    const response = await proxy(
      new NextRequest("https://harly.test/settings/integrations/tao"),
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
});
