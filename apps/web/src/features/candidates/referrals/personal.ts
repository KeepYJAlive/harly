import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getHarlyPublicOrigin } from "@/lib/public-origin";

export const PERSONAL_REFERRAL_EMAIL_KIND = "referral.invitation";
export const PERSONAL_REFERRAL_TEMPLATE_VERSION = 1;
export const PERSONAL_REFERRAL_MAX_USES = 3;
export const PERSONAL_REFERRAL_COOKIE = "harly_referral_context";

export type PersonalReferralInvitationPayload = {
  referralId: string;
  templateVersion: number;
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
};

export function normalizeReferralEmail(value: string) {
  return value.trim().toLowerCase();
}

export function createReferralToken() {
  return randomBytes(32).toString("base64url");
}

export function hashReferralToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function createPersonalReferralInvitationPayload(
  referralId: string,
  rawToken: string,
): PersonalReferralInvitationPayload {
  const encrypted = encryptSecret(rawToken);
  return {
    referralId,
    templateVersion: PERSONAL_REFERRAL_TEMPLATE_VERSION,
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenTag: encrypted.tag,
  };
}

export function decryptPersonalReferralToken(
  payload: PersonalReferralInvitationPayload,
) {
  return decryptSecret({
    ciphertext: payload.tokenCiphertext,
    iv: payload.tokenIv,
    tag: payload.tokenTag,
  });
}

export function personalReferralDedupeKey(referralId: string) {
  return `referral-invitation:${referralId}`;
}

export function buildPersonalReferralUrl(
  rawToken: string,
  origin = getHarlyPublicOrigin(),
) {
  return new URL(
    `/referral/${encodeURIComponent(rawToken)}`,
    `${origin.replace(/\/+$/, "")}/`,
  ).toString();
}

export function buildPersonalReferralLoginPath(
  workspaceSlug: string,
  options: { emailMismatch?: boolean } = {},
) {
  const params = new URLSearchParams({
    workspace: workspaceSlug,
    next: "/referral",
  });
  if (options.emailMismatch) params.set("error", "referral_email");
  return `/portal/login?${params.toString()}`;
}

export function isSafePortalNext(value: string | null | undefined) {
  if (!value) return false;
  return value.startsWith("/portal/") || value === "/referral";
}
