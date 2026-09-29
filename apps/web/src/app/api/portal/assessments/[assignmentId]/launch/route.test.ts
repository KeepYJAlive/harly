import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  resolvePortalSession: vi.fn(),
  beginTaoPortalAssignmentLaunch: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/portal-auth", () => ({
  PORTAL_SESSION_COOKIE: "harly_portal_session",
  resolvePortalSession: mocks.resolvePortalSession,
}));
vi.mock("@/lib/tao/lti/launch", () => ({
  CandidateLaunchError: class CandidateLaunchError extends Error {},
  beginTaoPortalAssignmentLaunch: mocks.beginTaoPortalAssignmentLaunch,
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}));

import { GET } from "./route";

const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000001";

describe("portal assessment launch route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: "portal-token" })),
    });
    mocks.resolvePortalSession.mockResolvedValue({
      workspaceId: "organization-a",
      candidateId: "candidate-a",
    });
    mocks.beginTaoPortalAssignmentLaunch.mockResolvedValue(
      "https://assessment.example/auth-server/lti1p3/oidc/initiation",
    );
  });

  it("uses only authenticated scope and assignment ID, ignoring delivery substitution", async () => {
    const response = await GET(
      new Request(
        `https://harly.example/api/portal/assessments/${ASSIGNMENT_ID}/launch?deliveryId=attacker-delivery`,
      ),
      { params: Promise.resolve({ assignmentId: ASSIGNMENT_ID }) },
    );

    expect(mocks.beginTaoPortalAssignmentLaunch).toHaveBeenCalledWith({
      assignmentId: ASSIGNMENT_ID,
      organizationId: "organization-a",
      candidateId: "candidate-a",
    });
    expect(response.headers.get("location")).toBe(
      "https://assessment.example/auth-server/lti1p3/oidc/initiation",
    );
  });

  it("returns a generic safe location for an invalid assignment reference", async () => {
    const response = await GET(
      new Request(
        "https://harly.example/api/portal/assessments/not-a-uuid/launch",
      ),
      { params: Promise.resolve({ assignmentId: "not-a-uuid" }) },
    );
    expect(mocks.beginTaoPortalAssignmentLaunch).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://harly.example/portal/assessments/unavailable",
    );
  });
});
