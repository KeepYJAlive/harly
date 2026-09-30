import { describe, expect, it } from "vitest";

import { evaluateReferralAcceptance } from "./personal-policy";

const NOW = new Date("2026-09-29T12:00:00.000Z");

function decide(
  overrides: Partial<Parameters<typeof evaluateReferralAcceptance>[0]> = {},
) {
  return evaluateReferralAcceptance({
    referralWorkspaceId: "workspace-a",
    referralCandidateId: null,
    referredEmailNormalized: "alex@example.com",
    status: "pending",
    expiresAt: null,
    sessionWorkspaceId: "workspace-a",
    sessionCandidateId: "candidate-a",
    sessionEmail: "Alex@Example.com",
    hasAnotherAcceptedReferral: false,
    now: NOW,
    ...overrides,
  });
}

describe("personal referral acceptance policy", () => {
  it("accepts the intended candidate using normalized verified session email", () => {
    expect(decide()).toEqual({ outcome: "accept" });
  });

  it("rejects cross-organization claims without exposing identity details", () => {
    expect(decide({ sessionWorkspaceId: "workspace-b" })).toEqual({
      outcome: "reject",
      error: "This referral is no longer available.",
    });
  });

  it("prevents another authenticated email from stealing the referral", () => {
    expect(decide({ sessionEmail: "mallory@example.com" })).toEqual({
      outcome: "reject",
      error: "Sign in with the email address that received this referral.",
    });
  });

  it.each(["revoked", "expired"] as const)(
    "rejects a %s referral",
    (status) => {
      expect(decide({ status })).toEqual({
        outcome: "reject",
        error: "This referral is no longer available.",
      });
    },
  );

  it("marks a time-expired pending referral for an atomic expiry transition", () => {
    expect(decide({ expiresAt: NOW })).toEqual({
      outcome: "expire",
      error: "This referral is no longer available.",
    });
  });

  it("makes repeat acceptance by the same candidate idempotent", () => {
    expect(
      decide({
        status: "accepted",
        referralCandidateId: "candidate-a",
        hasAnotherAcceptedReferral: true,
      }),
    ).toEqual({ outcome: "idempotent" });
  });

  it("does not silently merge a second accepted referral", () => {
    expect(decide({ hasAnotherAcceptedReferral: true })).toEqual({
      outcome: "reject",
      error: "This profile already has an accepted referral.",
    });
  });
});
