import { describe, expect, it } from "vitest";

import {
  buildTaoLaunchResponseUri,
  buildTaoTargetLinkUri,
  isTrustedTaoLaunchResponseUri,
  isTrustedTaoTargetLinkUri,
} from "./config";

const taoOrigin = "https://assessment.keepyjalive.org";
const launchResponseUri =
  "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3";
const deliveryId = "9ddca443197e";
const targetLinkUri = `${launchResponseUri}/${deliveryId}`;

describe("TAO LTI launch URLs", () => {
  it("derives and accepts only the fixed launch response endpoint", () => {
    expect(buildTaoLaunchResponseUri(taoOrigin)).toBe(launchResponseUri);
    expect(
      isTrustedTaoLaunchResponseUri(launchResponseUri, taoOrigin),
    ).toBe(true);
  });

  it.each([
    "https://evil.example/deliver/api/v1/auth/launch-lti-1p3",
    "https://assessment.keepyjalive.org.evil.example/deliver/api/v1/auth/launch-lti-1p3",
    "http://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3",
    "https://assessment.keepyjalive.org/other/path",
    "https://user:pass@assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3",
    "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3?delivery=9ddca443197e",
    "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3#fragment",
    targetLinkUri,
  ])("rejects an untrusted launch response URI: %s", (candidate) => {
    expect(isTrustedTaoLaunchResponseUri(candidate, taoOrigin)).toBe(false);
  });

  it("builds and validates the delivery-specific target separately", () => {
    expect(buildTaoTargetLinkUri(launchResponseUri, deliveryId)).toBe(
      targetLinkUri,
    );
    expect(
      isTrustedTaoTargetLinkUri(
        targetLinkUri,
        launchResponseUri,
        deliveryId,
      ),
    ).toBe(true);
  });

  it.each([
    launchResponseUri,
    `${launchResponseUri}/other-delivery`,
    `${targetLinkUri}/extra`,
    `${targetLinkUri}?unexpected=true`,
    `${targetLinkUri}#unexpected`,
    `https://evil.example/deliver/api/v1/auth/launch-lti-1p3/${deliveryId}`,
  ])("rejects an invalid delivery-specific target: %s", (candidate) => {
    expect(
      isTrustedTaoTargetLinkUri(
        candidate,
        launchResponseUri,
        deliveryId,
      ),
    ).toBe(false);
  });

  it("rejects invalid configured launch endpoints and delivery IDs", () => {
    expect(() =>
      buildTaoTargetLinkUri(`${launchResponseUri}/wrong-base`, deliveryId),
    ).toThrow("unexpected path");
    expect(() =>
      buildTaoTargetLinkUri(launchResponseUri, ` ${deliveryId}`),
    ).toThrow("delivery ID is invalid");
  });
});
