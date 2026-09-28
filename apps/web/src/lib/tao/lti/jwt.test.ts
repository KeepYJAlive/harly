import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";

import { LTI_CLAIM, LTI_LEARNER_ROLE } from "./claims";
import { signTaoLtiLaunchWithKey } from "./jwt";

describe("TAO LTI launch JWT", () => {
  const previous = process.env.AI_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previous;
  });

  it("is RS256 signed and its JWKS key validates the required launch claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const publicJwk = {
      ...(await exportJWK(publicKey)),
      kid: "key-1",
      alg: "RS256",
      use: "sig",
    };
    const token = await signTaoLtiLaunchWithKey(
      {
        organizationId: "org-1",
        applicationId: "application-1",
        assignmentId: "assignment-1",
        jobId: "job-1",
        assessmentName: "Knowledge assessment",
        clientId: "tao-client",
        deploymentId: "tao-deployment",
        nonce: "nonce-from-tao",
        targetLinkUri: "https://tao.example/launch/delivery-1",
        returnUrl: "https://harly.example/assessments/complete/opaque",
      },
      { kid: "key-1", privateKey, issuer: "https://harly.example" },
    );
    const verificationKey = await importJWK(publicJwk, "RS256");
    const { payload, protectedHeader } = await jwtVerify(
      token,
      verificationKey,
      {
        issuer: "https://harly.example",
        audience: "tao-client",
      },
    );
    expect(protectedHeader).toMatchObject({ alg: "RS256", kid: "key-1" });
    expect(payload.nonce).toBe("nonce-from-tao");
    expect(payload[LTI_CLAIM.deploymentId]).toBe("tao-deployment");
    expect(payload[LTI_CLAIM.roles]).toEqual([LTI_LEARNER_ROLE]);
    expect(payload[LTI_CLAIM.targetLinkUri]).toBe(
      "https://tao.example/launch/delivery-1",
    );
  });
});
