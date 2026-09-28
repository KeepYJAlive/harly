export const INVALID_ASSESSMENT_MESSAGE =
  "This assessment link is invalid or no longer available. Please contact the organization that sent it to you.";
export const RETRYABLE_ASSESSMENT_MESSAGE =
  "The assessment provider is temporarily unavailable. Please try this link again shortly or contact the organization that sent it to you.";

export function candidateAssessmentErrorMessage(
  code: "invalid" | "unavailable" | "configuration" | "provider" | undefined,
) {
  return code === "configuration" || code === "provider"
    ? RETRYABLE_ASSESSMENT_MESSAGE
    : INVALID_ASSESSMENT_MESSAGE;
}
