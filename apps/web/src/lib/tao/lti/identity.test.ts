import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLtiSubject } from "./identity";

describe("LTI subject", () => {
  const previous = process.env.AI_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previous;
  });

  it("is stable for the same application and does not contain internal IDs", () => {
    const first = createLtiSubject("org-private", "application-private");
    expect(createLtiSubject("org-private", "application-private")).toBe(first);
    expect(first).not.toContain("org-private");
    expect(first).not.toContain("application-private");
  });

  it("differs across applications", () => {
    expect(createLtiSubject("org", "application-a")).not.toBe(
      createLtiSubject("org", "application-b"),
    );
  });
});
