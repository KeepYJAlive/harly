import { normalizeReferralEmail } from "./personal";

export type ReferralAcceptanceDecision =
  | { outcome: "accept" }
  | { outcome: "idempotent" }
  | { outcome: "expire"; error: string }
  | { outcome: "reject"; error: string };

const UNAVAILABLE_ERROR = "This referral is no longer available.";

/**
 * Applies the identity and lifecycle rules for claiming a personal referral.
 * The caller must still lock and update the row transactionally.
 */
export function evaluateReferralAcceptance(input: {
  referralWorkspaceId: string;
  referralCandidateId: string | null;
  referredEmailNormalized: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date | null;
  sessionWorkspaceId: string;
  sessionCandidateId: string;
  sessionEmail: string;
  hasAnotherAcceptedReferral: boolean;
  now?: Date;
}): ReferralAcceptanceDecision {
  if (input.referralWorkspaceId !== input.sessionWorkspaceId) {
    return { outcome: "reject", error: UNAVAILABLE_ERROR };
  }

  if (
    input.status === "accepted" &&
    input.referralCandidateId === input.sessionCandidateId
  ) {
    return { outcome: "idempotent" };
  }

  if (input.status !== "pending") {
    return { outcome: "reject", error: UNAVAILABLE_ERROR };
  }

  const now = input.now ?? new Date();
  if (input.expiresAt && input.expiresAt <= now) {
    return { outcome: "expire", error: UNAVAILABLE_ERROR };
  }

  if (
    !input.referredEmailNormalized ||
    normalizeReferralEmail(input.sessionEmail) !== input.referredEmailNormalized
  ) {
    return {
      outcome: "reject",
      error: "Sign in with the email address that received this referral.",
    };
  }

  if (input.hasAnotherAcceptedReferral) {
    return {
      outcome: "reject",
      error: "This profile already has an accepted referral.",
    };
  }

  return { outcome: "accept" };
}
