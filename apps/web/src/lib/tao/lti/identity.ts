import { createHmac } from "node:crypto";

function identityKey(): Buffer {
  const raw = process.env.AI_ENCRYPTION_KEY;
  if (!raw || Buffer.from(raw, "base64").length !== 32) {
    throw new Error(
      "Harly secret encryption must be configured before LTI launch.",
    );
  }
  return createHmac("sha256", Buffer.from(raw, "base64"))
    .update("harly-tao-lti-identity-v1")
    .digest();
}

function opaqueIdentity(kind: string, values: string[]): string {
  const digest = createHmac("sha256", identityKey())
    .update([kind, ...values].join("\0"), "utf8")
    .digest("base64url");
  return `harly:${kind}:${digest}`;
}

export function createLtiSubject(
  organizationId: string,
  applicationId: string,
): string {
  return opaqueIdentity("application", [organizationId, applicationId]);
}

export function createLtiResourceLinkId(
  organizationId: string,
  assignmentId: string,
): string {
  return opaqueIdentity("assignment", [organizationId, assignmentId]);
}

export function createLtiContextId(
  organizationId: string,
  jobId: string,
): string {
  return opaqueIdentity("job", [organizationId, jobId]);
}
