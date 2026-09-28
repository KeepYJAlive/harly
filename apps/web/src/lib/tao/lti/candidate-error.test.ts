import { describe, expect, it } from "vitest";

import {
  candidateAssessmentErrorMessage,
  INVALID_ASSESSMENT_MESSAGE,
  RETRYABLE_ASSESSMENT_MESSAGE,
} from "./candidate-error";

describe("candidate-facing TAO errors", () => {
  it("does not expose internal identifiers or provider details", () => {
    for (const message of [
      candidateAssessmentErrorMessage("invalid"),
      candidateAssessmentErrorMessage(undefined),
      candidateAssessmentErrorMessage("configuration"),
    ]) {
      expect(message).not.toMatch(
        /application-123|organization-123|SQL|JWT|client_id/i,
      );
    }
    expect(candidateAssessmentErrorMessage("invalid")).toBe(
      INVALID_ASSESSMENT_MESSAGE,
    );
    expect(candidateAssessmentErrorMessage("provider")).toBe(
      RETRYABLE_ASSESSMENT_MESSAGE,
    );
  });
});
