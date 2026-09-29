import "server-only";

import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { CryptoKey } from "jose";

import { getHarlyPublicOrigin } from "@/lib/public-origin";
import {
  createLtiContextId,
  createLtiResourceLinkId,
  createLtiSubject,
} from "./identity";
import {
  LTI_CLAIM,
  LTI_AGS_SCORE_SCOPE,
  LTI_LEARNER_ROLE,
  LTI_MESSAGE_TYPE,
  LTI_VERSION,
} from "./claims";
import { ensureTaoSigningKey } from "./keys";

export type TaoLaunchClaimsInput = {
  organizationId: string;
  applicationId: string;
  assignmentId: string;
  jobId: string;
  assessmentName: string;
  clientId: string;
  deploymentId: string;
  nonce: string;
  targetLinkUri: string;
  returnUrl: string;
  lineItemUrl: string;
};

export type ManualTaoLaunchClaimsInput = {
  organizationId: string;
  clientId: string;
  deploymentId: string;
  nonce: string;
  targetLinkUri: string;
  returnUrl: string;
  tenantId: string;
  deliveryId: string;
  assessmentName: string;
};

export function createTaoLtiLaunchClaims(input: TaoLaunchClaimsInput) {
  return {
    nonce: input.nonce,
    [LTI_CLAIM.version]: LTI_VERSION,
    [LTI_CLAIM.messageType]: LTI_MESSAGE_TYPE,
    [LTI_CLAIM.deploymentId]: input.deploymentId,
    [LTI_CLAIM.targetLinkUri]: input.targetLinkUri,
    [LTI_CLAIM.resourceLink]: {
      id: createLtiResourceLinkId(input.organizationId, input.assignmentId),
      title: input.assessmentName,
    },
    [LTI_CLAIM.roles]: [LTI_LEARNER_ROLE],
    [LTI_CLAIM.context]: {
      id: createLtiContextId(input.organizationId, input.jobId),
    },
    [LTI_CLAIM.launchPresentation]: {
      document_target: "window",
      return_url: input.returnUrl,
      locale: "en-US",
    },
    [LTI_CLAIM.agsEndpoint]: {
      scope: [LTI_AGS_SCORE_SCOPE],
      lineitem: input.lineItemUrl,
    },
  };
}

export async function signTaoLtiLaunchWithKey(
  input: TaoLaunchClaimsInput,
  signing: { kid: string; privateKey: CryptoKey; issuer: string },
) {
  return new SignJWT(createTaoLtiLaunchClaims(input))
    .setProtectedHeader({ alg: "RS256", kid: signing.kid, typ: "JWT" })
    .setIssuer(signing.issuer)
    .setAudience(input.clientId)
    .setSubject(createLtiSubject(input.organizationId, input.applicationId))
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(signing.privateKey);
}

export async function signTaoLtiLaunch(input: TaoLaunchClaimsInput) {
  const issuer = getHarlyPublicOrigin();
  const key = await ensureTaoSigningKey(input.organizationId);
  return signTaoLtiLaunchWithKey(input, {
    kid: key.kid,
    privateKey: key.privateKey,
    issuer,
  });
}

export function createManualTaoLtiLaunchClaims(
  input: ManualTaoLaunchClaimsInput,
) {
  return {
    nonce: input.nonce,
    tenant_id: input.tenantId,
    [LTI_CLAIM.version]: LTI_VERSION,
    [LTI_CLAIM.messageType]: LTI_MESSAGE_TYPE,
    [LTI_CLAIM.deploymentId]: input.deploymentId,
    [LTI_CLAIM.targetLinkUri]: input.targetLinkUri,
    [LTI_CLAIM.resourceLink]: {
      id: createLtiResourceLinkId(
        input.organizationId,
        `manual:${input.deliveryId}`,
      ),
      title: input.assessmentName,
    },
    [LTI_CLAIM.roles]: [LTI_LEARNER_ROLE],
    [LTI_CLAIM.context]: {
      id: createLtiContextId(input.organizationId, "manual-tao-test"),
      label: "Harly manual TAO test",
      title: "Harly manual TAO test",
    },
    [LTI_CLAIM.launchPresentation]: {
      document_target: "window",
      return_url: input.returnUrl,
      locale: "en-US",
    },
  };
}

export async function signManualTaoLtiLaunchWithKey(
  input: ManualTaoLaunchClaimsInput,
  signing: { kid: string; privateKey: CryptoKey; issuer: string },
) {
  return new SignJWT(createManualTaoLtiLaunchClaims(input))
    .setProtectedHeader({ alg: "RS256", kid: signing.kid, typ: "JWT" })
    .setIssuer(signing.issuer)
    .setAudience(input.clientId)
    .setSubject(
      createLtiSubject(input.organizationId, "manual-tao-production-test-user"),
    )
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(signing.privateKey);
}

export async function signManualTaoLtiLaunch(
  input: ManualTaoLaunchClaimsInput,
) {
  const issuer = getHarlyPublicOrigin();
  const key = await ensureTaoSigningKey(input.organizationId);
  return signManualTaoLtiLaunchWithKey(input, {
    kid: key.kid,
    privateKey: key.privateKey,
    issuer,
  });
}
