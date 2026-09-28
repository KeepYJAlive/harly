import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeManual: vi.fn(),
  authorizeAssignment: vi.fn(),
  createManualForm: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));
vi.mock("@/lib/tao/lti/html", () => ({
  createLtiFormPostHtml: vi.fn(),
}));
vi.mock("@/lib/tao/lti/launch", () => ({
  authorizeTaoLtiLaunch: mocks.authorizeAssignment,
}));
vi.mock("@/lib/tao/lti/manual-launch", () => ({
  MANUAL_TAO_TEST: { messageHint: "manual-test-hint" },
  authorizeManualTaoTestLaunch: mocks.authorizeManual,
  createManualLtiFormPost: mocks.createManualForm,
}));

import { GET } from "./route";

describe("TAO LTI authorize route manual dispatch", () => {
  it("dispatches the protected manual message hint and returns a form_post", async () => {
    mocks.authorizeManual.mockResolvedValueOnce({
      redirectUri: "https://assessment.keepyjalive.org/deliver/launch",
      idToken: "signed-token",
      state: "tool-state",
    });
    mocks.createManualForm.mockReturnValueOnce("<html>manual form</html>");
    const query = new URLSearchParams({
      client_id: "client-id",
      redirect_uri: "https://assessment.keepyjalive.org/deliver/launch",
      login_hint: "login-hint",
      lti_message_hint: "manual-test-hint",
      nonce: "tool-nonce",
      state: "tool-state",
      response_type: "id_token",
      response_mode: "form_post",
      scope: "openid",
      prompt: "none",
    });
    const response = await GET(
      new Request(`https://harly.example/api/integrations/tao/lti/authorize?${query}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.authorizeManual).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-id",
        nonce: "tool-nonce",
        state: "tool-state",
        messageHint: "manual-test-hint",
      }),
    );
    expect(mocks.authorizeAssignment).not.toHaveBeenCalled();
    expect(await response.text()).toContain("manual form");
  });
});
