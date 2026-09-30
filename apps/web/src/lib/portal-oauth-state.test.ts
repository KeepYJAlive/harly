import { describe, expect, it } from "vitest";

import {
  createPortalOAuthState,
  verifyPortalOAuthState,
} from "./portal-oauth-state";

describe("portal OAuth state", () => {
  it("binds the post-login redirect to the workspace", () => {
    const state = createPortalOAuthState("/portal/dashboard", "workspace-a");

    expect(verifyPortalOAuthState(state, state)).toEqual({
      next: "/portal/dashboard",
      workspaceId: "workspace-a",
    });
  });

  it("rejects a state from another login attempt", () => {
    const expected = createPortalOAuthState("/portal/dashboard", "workspace-a");
    const actual = createPortalOAuthState("/portal/dashboard", "workspace-b");

    expect(verifyPortalOAuthState(expected, actual)).toBeNull();
  });

  it("allows the fixed referral continuation without embedding its token", () => {
    const state = createPortalOAuthState("/referral", "workspace-a");

    expect(verifyPortalOAuthState(state, state)).toEqual({
      next: "/referral",
      workspaceId: "workspace-a",
});
  });

  it("rejects referral-like redirects that could expose or redirect a token", () => {
    const state = createPortalOAuthState(
      "/referral/secret-token",
      "workspace-a",
    );

    expect(verifyPortalOAuthState(state, state)).toEqual({
      next: "/portal/dashboard",
      workspaceId: "workspace-a",
    });
  });
});
