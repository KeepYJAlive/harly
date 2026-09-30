import { beforeAll, describe, expect, it } from "vitest";

import {
  buildPersonalReferralLoginPath,
  buildPersonalReferralUrl,
  createPersonalReferralInvitationPayload,
  createReferralToken,
  decryptPersonalReferralToken,
  hashReferralToken,
  isSafePortalNext,
  normalizeReferralEmail,
} from "./personal";

describe("personal referral tokens", () => {
  beforeAll(() => {
    process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("normalizes identity email consistently", () => {
    expect(normalizeReferralEmail("  Alex.Smith@Example.COM ")).toBe(
      "alex.smith@example.com",
    );
  });

  it("generates an opaque high-entropy token and stores a one-way hash", () => {
    const raw = createReferralToken();
    const hash = hashReferralToken(raw);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(raw);
    expect(createReferralToken()).not.toBe(raw);
  });

  it("persists only an encrypted delivery envelope for the worker", () => {
    const raw = createReferralToken();
    const payload = createPersonalReferralInvitationPayload("referral-1", raw);
    expect(JSON.stringify(payload)).not.toContain(raw);
    expect(decryptPersonalReferralToken(payload)).toBe(raw);
  });

  it("builds a link containing only the opaque token", () => {
    const url = buildPersonalReferralUrl(
      "opaque-token",
      "https://opportunities.example",
    );
    expect(url).toBe("https://opportunities.example/referral/opaque-token");
    expect(url).not.toContain("candidate");
    expect(url).not.toContain("email");
  });

  it("builds the fixed referral login return path", () => {
    expect(buildPersonalReferralLoginPath("keepyjalive")).toBe(
      "/portal/login?workspace=keepyjalive&next=%2Freferral",
    );
  });

  it("allows only portal paths and the fixed referral return path", () => {
    expect(isSafePortalNext("/referral")).toBe(true);
    expect(isSafePortalNext("/portal/dashboard")).toBe(true);
    expect(isSafePortalNext("https://evil.example/referral")).toBe(false);
    expect(isSafePortalNext("//evil.example")).toBe(false);
  });
});
