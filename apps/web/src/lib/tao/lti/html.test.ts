import { describe, expect, it } from "vitest";

import { createLtiFormPostHtml } from "./html";

describe("LTI form post", () => {
  it("posts only id_token and state to the exact configured target", () => {
    const html = createLtiFormPostHtml({
      target: "https://tao.example/launch/delivery",
      idToken: "signed.jwt.value",
      state: "opaque-state",
    });
    expect(html).toContain('action="https://tao.example/launch/delivery"');
    expect(html).toContain('name="id_token"');
    expect(html).toContain('name="state"');
    expect(html).not.toContain("candidate@example.com");
  });
});
