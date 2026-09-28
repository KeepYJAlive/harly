import { describe, expect, it } from "vitest";

import {
  validateOidcAuthorizationInput,
  validateStoredLaunchState,
} from "./state";

const valid = {
  clientId: "client",
  redirectUri: "https://tao.example/launch/delivery",
  loginHint: "a".repeat(43),
  messageHint: "00000000-0000-4000-8000-000000000000",
  nonce: "nonce-value-with-enough-entropy",
  state: "state-value-with-enough-entropy",
  responseType: "id_token",
  responseMode: "form_post",
  scope: "openid",
  prompt: "none",
};

describe("LTI OIDC state", () => {
  it("accepts the verified form_post request shape", () => {
    expect(validateOidcAuthorizationInput(valid)).toBeNull();
  });

  it("rejects missing nonce, weak state, or a non-form_post response", () => {
    expect(validateOidcAuthorizationInput({ ...valid, nonce: "" })).toMatch(
      /nonce/,
    );
    expect(
      validateOidcAuthorizationInput({ ...valid, state: "short" }),
    ).toMatch(/state/);
    expect(
      validateOidcAuthorizationInput({ ...valid, responseMode: "query" }),
    ).toMatch(/response_mode/);
  });

  it("rejects expired and replayed stored state", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    expect(
      validateStoredLaunchState({
        consumedAt: null,
        expiresAt: new Date("2026-09-27T11:59:59Z"),
        now,
        loginHintMatches: true,
      }),
    ).toMatch(/expired/);
    expect(
      validateStoredLaunchState({
        consumedAt: new Date("2026-09-27T11:59:00Z"),
        expiresAt: new Date("2026-09-27T12:05:00Z"),
        now,
        loginHintMatches: true,
      }),
    ).toMatch(/already been used/);
  });
});
