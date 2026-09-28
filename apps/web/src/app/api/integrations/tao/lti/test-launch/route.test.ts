import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertNotDemo: vi.fn(),
  requirePermission: vi.fn(),
  beginManualTaoTestLaunch: vi.fn(),
  isManualTaoTestLaunchEnabled: vi.fn(),
}));

vi.mock("@/features/demo/assert-not-demo", () => ({
  assertNotDemo: mocks.assertNotDemo,
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/tao/lti/manual-launch", () => ({
  beginManualTaoTestLaunch: mocks.beginManualTaoTestLaunch,
  isManualTaoTestLaunchEnabled: mocks.isManualTaoTestLaunchEnabled,
}));

import { GET } from "./route";

describe("manual TAO test-launch route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isManualTaoTestLaunchEnabled.mockReturnValue(true);
    mocks.requirePermission.mockResolvedValue({
      organization: { id: "org-1" },
      user: { id: "user-1" },
    });
    mocks.beginManualTaoTestLaunch.mockResolvedValue(
      "https://assessment.keepyjalive.org/auth-server/lti1p3/oidc/initiation?test=1",
    );
  });

  it("requires integrations:manage and redirects an authorized administrator", async () => {
    const response = await GET();
    expect(mocks.requirePermission).toHaveBeenCalledWith("integrations:manage");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain(
      "assessment.keepyjalive.org/auth-server/lti1p3/oidc/initiation",
    );
  });

  it("rejects callers without integration management permission", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.beginManualTaoTestLaunch).not.toHaveBeenCalled();
  });

  it("is unavailable when the manual test gate is disabled", async () => {
    mocks.isManualTaoTestLaunchEnabled.mockReturnValueOnce(false);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });
});
