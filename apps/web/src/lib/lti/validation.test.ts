import { describe, expect, it } from "vitest";

import {
  normalizeOptionalTaoEndpoint,
  normalizeTaoInstanceUrl,
} from "./validation";

describe("TAO URL validation", () => {
  it("normalizes the instance URL without inventing an endpoint path", () => {
    expect(
      normalizeTaoInstanceUrl(" https://tao.example.com/tenant/// ", {
        production: true,
      }),
    ).toBe("https://tao.example.com/tenant");
  });

  it("requires HTTPS in production", () => {
    expect(() =>
      normalizeTaoInstanceUrl("http://tao.example.com", { production: true }),
    ).toThrow("must use HTTPS in production");
  });

  it("rejects credentials and query strings on the instance URL", () => {
    expect(() =>
      normalizeTaoInstanceUrl("https://admin:secret@tao.example.com", {
        production: true,
      }),
    ).toThrow("cannot contain credentials");
    expect(() =>
      normalizeTaoInstanceUrl("https://tao.example.com?tenant=one", {
        production: true,
      }),
    ).toThrow("cannot contain a query string");
  });

  it("keeps explicitly configured endpoint paths and queries", () => {
    expect(
      normalizeOptionalTaoEndpoint(
        "https://tao.example.com/custom/oauth?tenant=one",
        "TAO OAuth/token URL",
        { production: true },
      ),
    ).toBe("https://tao.example.com/custom/oauth?tenant=one");
  });
});
