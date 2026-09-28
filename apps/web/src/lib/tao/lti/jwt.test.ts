import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";

vi.mock("@harly/db", () => ({ db: {}, taoLtiSigningKeys: {} }));

import { LTI_CLAIM, LTI_LEARNER_ROLE } from "./claims";
import {
  signManualTaoLtiLaunchWithKey,
  signTaoLtiLaunchWithKey,
} from "./jwt";
import { generateTaoSigningKeyMaterial } from "./keys";

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

  it("keeps generated private key material out of the public JWKS value", async () => {
    const material = await generateTaoSigningKeyMaterial();

    expect(material.publicJwk).toMatchObject({
      kty: "RSA",
      kid: material.kid,
      use: "sig",
      alg: "RS256",
    });
    expect(material.publicJwk).toHaveProperty("n");
    expect(material.publicJwk).toHaveProperty("e");
    expect(material.publicJwk).not.toHaveProperty("d");
    expect(material.privatePkcs8).toContain("BEGIN PRIVATE KEY");
    expect(JSON.stringify(material.publicJwk)).not.toContain(
      material.privatePkcs8,
    );
  });

  it("signs the manual Production Test as an LTI Resource Link launch", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const publicJwk = {
      ...(await exportJWK(publicKey)),
      kid: "manual-key-1",
      alg: "RS256",
      use: "sig",
    };
    const token = await signManualTaoLtiLaunchWithKey(
      {
        organizationId: "org-1",
        clientId: "harly-tao-f3695cee-3122-4e89-a2ce-c0c4ef364718",
        deploymentId: "f0d717d2-02ff-468e-bfea-e59c65ce4e75",
        nonce: "nonce-issued-by-tao",
        targetLinkUri:
          "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3/9ddca443197e",
        returnUrl: "https://opportunities.keepyjalive.org/settings/integrations/tao",
        tenantId: "1",
        deliveryId: "9ddca443197e",
        assessmentName: "Production Test",
      },
      {
        kid: "manual-key-1",
        privateKey,
        issuer: "https://opportunities.keepyjalive.org",
      },
    );
    const { payload, protectedHeader } = await jwtVerify(
      token,
      await importJWK(publicJwk, "RS256"),
      {
        issuer: "https://opportunities.keepyjalive.org",
        audience: "harly-tao-f3695cee-3122-4e89-a2ce-c0c4ef364718",
      },
    );

    expect(protectedHeader).toMatchObject({
      alg: "RS256",
      kid: "manual-key-1",
    });
    expect(payload.nonce).toBe("nonce-issued-by-tao");
    expect(payload.tenant_id).toBe("1");
    expect(payload[LTI_CLAIM.deploymentId]).toBe(
      "f0d717d2-02ff-468e-bfea-e59c65ce4e75",
    );
    expect(payload[LTI_CLAIM.messageType]).toBe("LtiResourceLinkRequest");
    expect(payload[LTI_CLAIM.version]).toBe("1.3.0");
    expect(payload[LTI_CLAIM.targetLinkUri]).toBe(
      "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3/9ddca443197e",
    );
    expect(payload[LTI_CLAIM.roles]).toEqual([LTI_LEARNER_ROLE]);
    expect(payload[LTI_CLAIM.resourceLink]).toMatchObject({
      title: "Production Test",
    });
    expect(payload[LTI_CLAIM.context]).toMatchObject({
      label: "Harly manual TAO test",
    });
    expect(payload.sub).toMatch(/^harly:application:/);
    expect(Object.keys(payload).join(" ")).not.toContain("ags");
  });
});
