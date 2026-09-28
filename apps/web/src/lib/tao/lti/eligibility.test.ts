import { describe, expect, it } from "vitest";

import { assignmentLaunchBlockReason } from "./eligibility";

const now = new Date("2026-09-27T12:00:00Z");

describe("assessment launch eligibility", () => {
  it("allows assigned and started assessments that remain active", () => {
    for (const status of ["assigned", "started"] as const) {
      expect(
        assignmentLaunchBlockReason({
          status,
          activeDefinition: true,
          expiresAt: new Date("2026-09-28T12:00:00Z"),
          now,
        }),
      ).toBeNull();
    }
  });

  it.each(["cancelled", "completed", "error"] as const)(
    "rejects %s assignments",
    (status) => {
      expect(
        assignmentLaunchBlockReason({
          status,
          activeDefinition: true,
          expiresAt: null,
          now,
        }),
      ).toBe("unavailable");
    },
  );

  it("rejects expired assignments", () => {
    expect(
      assignmentLaunchBlockReason({
        status: "assigned",
        activeDefinition: true,
        expiresAt: new Date("2026-09-27T11:59:59Z"),
        now,
      }),
    ).toBe("expired");
  });
});
