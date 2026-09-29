import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  getHarlyPublicOrigin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: mocks.encryptSecret,
  decryptSecret: mocks.decryptSecret,
}));
vi.mock("@/lib/public-origin", () => ({
  getHarlyPublicOrigin: mocks.getHarlyPublicOrigin,
}));

import {
  assessmentInvitationDedupeKey,
  buildCandidateAssessmentUrl,
  calculateAssessmentExpiry,
  createAssessmentInvitationPayload,
  decryptAssessmentInvitationToken,
} from "./invitation";

describe("assessment invitation links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHarlyPublicOrigin.mockReturnValue("https://harly.example");
    mocks.encryptSecret.mockReturnValue({
      ciphertext: "ciphertext",
      iv: "iv",
      tag: "tag",
    });
    mocks.decryptSecret.mockReturnValue("opaque-token");
  });

  it("stores an encrypted token payload and can decrypt it only in the worker", () => {
    const payload = createAssessmentInvitationPayload(
      "assignment-1",
      "opaque-token",
    );

    expect(mocks.encryptSecret).toHaveBeenCalledWith("opaque-token");
    expect(payload).toEqual({
      assignmentId: "assignment-1",
      templateVersion: 1,
      tokenCiphertext: "ciphertext",
      tokenIv: "iv",
      tokenTag: "tag",
    });
    expect(JSON.stringify(payload)).not.toContain("opaque-token");
    expect(decryptAssessmentInvitationToken(payload)).toBe("opaque-token");
  });

  it("builds a candidate-facing Harly URL without exposing assignment data", () => {
    expect(buildCandidateAssessmentUrl("opaque/token value")).toBe(
      "https://harly.example/assessment/opaque%2Ftoken%20value",
    );
    expect(assessmentInvitationDedupeKey("assignment-1")).toBe(
      "assessment-invitation:assignment-1",
    );
  });

  it("calculates an optional stage-configured deadline", () => {
    const assignedAt = new Date("2026-09-29T12:00:00.000Z");
    expect(calculateAssessmentExpiry(assignedAt, 7)?.toISOString()).toBe(
      "2026-10-06T12:00:00.000Z",
    );
    expect(calculateAssessmentExpiry(assignedAt, null)).toBeNull();
  });
});
