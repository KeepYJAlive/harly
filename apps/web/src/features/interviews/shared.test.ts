import { describe, expect, it } from "vitest";

import { getBrowserTimeZone, parseScheduledAt } from "./shared";

describe("interview date handling", () => {
  it("resolves a naive wall-clock value with the supplied IANA timezone", () => {
    expect(
      parseScheduledAt("2099-08-01T10:00", "America/Santiago").toISOString(),
    ).toBe("2099-08-01T14:00:00.000Z");
  });

  it("rejects a naive wall-clock value without an explicit timezone", () => {
    expect(() => parseScheduledAt("2099-08-01T10:00")).toThrow(
      /timezone/i,
    );
  });

  it("returns an IANA timezone in a browser runtime", () => {
    expect(getBrowserTimeZone()).toMatch(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/);
  });
});


describe("DST-safe scheduling", () => {
  it("converts both sides of the Los Angeles spring transition", () => {
    expect(
      parseScheduledAt("2027-03-14T01:30", "America/Los_Angeles").toISOString(),
    ).toBe("2027-03-14T09:30:00.000Z");
    expect(
      parseScheduledAt("2027-03-14T03:30", "America/Los_Angeles").toISOString(),
    ).toBe("2027-03-14T10:30:00.000Z");
  });
  it("rejects nonexistent and ambiguous wall-clock times", () => {
    expect(() =>
      parseScheduledAt("2027-03-14T02:30", "America/Los_Angeles"),
    ).toThrow(/daylight saving/);
    expect(() =>
      parseScheduledAt("2027-11-07T01:30", "America/Los_Angeles"),
    ).toThrow(/ambiguous/);
    expect(
      parseScheduledAt(
        "2027-11-07T01:30:00-08:00",
        "America/Los_Angeles",
      ).toISOString(),
    ).toBe("2027-11-07T09:30:00.000Z");
  });
});
