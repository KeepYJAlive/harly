import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertNotDemo: vi.fn(),
  requireApplicationPermission: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}));
vi.mock("@harly/db", () => ({
  db: {},
  activityEvents: {},
  applications: {},
  assessmentAssignments: {},
  assessmentDefinitions: {},
  workspaceSettings: {},
}));
vi.mock("@/features/demo/assert-not-demo", () => ({
  assertNotDemo: mocks.assertNotDemo,
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requireApplicationPermission: mocks.requireApplicationPermission,
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/public-origin", () => ({ toHarlyPublicUrl: vi.fn() }));

import { assignAssessmentAction } from "./assignment-actions";

describe("assessment assignment authorization", () => {
  it("rejects cross-organization applications before reading assessment configuration", async () => {
    mocks.requireApplicationPermission.mockRejectedValueOnce(
      new Error("Application not found."),
    );
    await expect(
      assignAssessmentAction({
        applicationId: "00000000-0000-4000-8000-000000000001",
        assessmentDefinitionId: "00000000-0000-4000-8000-000000000002",
        expiresAt: "2026-10-05T00:00:00.000Z",
      }),
    ).rejects.toThrow("Application not found.");
    expect(mocks.requireApplicationPermission).toHaveBeenCalledWith(
      "candidates:edit",
      "00000000-0000-4000-8000-000000000001",
    );
  });
});
