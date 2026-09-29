import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getHarlyPublicOrigin } from "@/lib/public-origin";

export const ASSESSMENT_INVITATION_KIND = "assessment.invitation";
export const ASSESSMENT_INVITATION_TEMPLATE_VERSION = 1;

export type AssessmentInvitationPayload = {
  assignmentId: string;
  templateVersion: number;
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
};

export function assessmentInvitationDedupeKey(assignmentId: string) {
  return `assessment-invitation:${assignmentId}`;
}

export function createAssessmentInvitationPayload(
  assignmentId: string,
  rawToken: string,
): AssessmentInvitationPayload {
  const encrypted = encryptSecret(rawToken);
  return {
    assignmentId,
    templateVersion: ASSESSMENT_INVITATION_TEMPLATE_VERSION,
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenTag: encrypted.tag,
  };
}

export function decryptAssessmentInvitationToken(
  payload: AssessmentInvitationPayload,
) {
  return decryptSecret({
    ciphertext: payload.tokenCiphertext,
    iv: payload.tokenIv,
    tag: payload.tokenTag,
  });
}

export function buildCandidateAssessmentUrl(
  rawToken: string,
  origin = getHarlyPublicOrigin(),
) {
  return new URL(
    `/assessment/${encodeURIComponent(rawToken)}`,
    `${origin.replace(/\/+$/, "")}/`,
  ).toString();
}

export function calculateAssessmentExpiry(
  assignedAt: Date,
  deadlineDays: number | null,
) {
  return deadlineDays === null
    ? null
    : new Date(assignedAt.getTime() + deadlineDays * 24 * 60 * 60_000);
}
