import { describe, expect, it } from "vitest";

import {
  createOpaqueToken,
  hashOpaqueToken,
  isPlausibleOpaqueToken,
  tokenHashMatches,
} from "./tokens";

describe("TAO launch tokens", () => {
  it("creates opaque tokens and persists only a one-way SHA-256 value", () => {
    const raw = createOpaqueToken();
    const hash = hashOpaqueToken(raw);
    expect(raw).not.toBe(hash);
    expect(raw).toHaveLength(43);
    expect(hash).toHaveLength(43);
    expect(isPlausibleOpaqueToken(raw)).toBe(true);
    expect(tokenHashMatches(raw, hash)).toBe(true);
    expect(tokenHashMatches(createOpaqueToken(), hash)).toBe(false);
  });

  it("invalidates the old URL when a replacement hash is stored", () => {
    const oldToken = createOpaqueToken();
    const replacement = createOpaqueToken();
    const storedHash = hashOpaqueToken(replacement);
    expect(tokenHashMatches(oldToken, storedHash)).toBe(false);
    expect(tokenHashMatches(replacement, storedHash)).toBe(true);
  });
});
