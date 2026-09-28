import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  assertNotDemo: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => conditions),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("drizzle-orm", () => ({ and: mocks.and, eq: mocks.eq }));
vi.mock("@harly/db", () => ({
  db: { update: mocks.update },
  assessmentDefinitions: {
    id: "id",
    organizationId: "organizationId",
    provider: "provider",
  },
}));
vi.mock("@/features/demo/assert-not-demo", () => ({
  assertNotDemo: mocks.assertNotDemo,
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: vi.fn() }));

import { saveTaoAssessmentDefinitionAction } from "./definition-actions";

describe("TAO assessment definition actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({
      organization: { id: "organization-a" },
      user: { id: "user-1", email: "owner@example.com" },
    });
    mocks.updateReturning.mockResolvedValue([]);
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.update.mockReturnValue({ set: mocks.updateSet });
  });

  it("requires integrations:manage", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      saveTaoAssessmentDefinitionAction({
        id: "00000000-0000-4000-8000-000000000001",
        name: "Assessment",
        externalId: "delivery-1",
        active: true,
      }),
    ).rejects.toThrow("forbidden");
    expect(mocks.requirePermission).toHaveBeenCalledWith("integrations:manage");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects an assessment outside the trusted organization scope", async () => {
    const result = await saveTaoAssessmentDefinitionAction({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Assessment",
      externalId: "delivery-1",
      active: true,
    });
    expect(result).toEqual({ ok: false, error: "Assessment not found." });
    expect(mocks.eq).toHaveBeenCalledWith("organizationId", "organization-a");
  });
});
