import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  insertReturning: vi.fn(),
  selectProjections: [] as Array<Record<string, unknown>>,
  toHarlyPublicUrl: vi.fn((path: string) => `https://harly.example.test${path}`),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((column, value) => ({ column, value })),
  gt: vi.fn((column, value) => ({ column, value })),
  inArray: vi.fn((column, values) => ({ column, values })),
  isNull: vi.fn((column) => ({ column, isNull: true })),
}));

vi.mock("@harly/db", () => ({
  db: {
    select: (projection: Record<string, unknown>) => {
      mocks.selectProjections.push(projection);
      const query: Record<string, unknown> = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        limit: mocks.selectLimit,
      };
      return query;
    },
    insert: () => ({
      values: () => ({ returning: mocks.insertReturning }),
    }),
  },
  applications: {
    id: "application.id",
    workspaceId: "application.workspaceId",
    candidateId: "application.candidateId",
    jobId: "application.jobId",
  },
  assessmentAssignments: {
    id: "assignment.id",
    organizationId: "assignment.organizationId",
    applicationId: "assignment.applicationId",
    assessmentDefinitionId: "assignment.definitionId",
    status: "assignment.status",
    expiresAt: "assignment.expiresAt",
    startedAt: "assignment.startedAt",
    providerResourceId: "assignment.providerResourceId",
    launchTokenHash: "assignment.launchTokenHash",
  },
  assessmentDefinitions: {
    id: "definition.id",
    organizationId: "definition.organizationId",
    active: "definition.active",
    name: "definition.name",
    externalId: "definition.externalId",
  },
  assessmentLtiLaunches: {
    id: "launch.id",
    assignmentId: "launch.assignmentId",
    loginHintHash: "launch.loginHintHash",
    returnTokenHash: "launch.returnTokenHash",
    expiresAt: "launch.expiresAt",
    returnExpiresAt: "launch.returnExpiresAt",
  },
  workspaceSettings: {
    taoEnabled: "settings.taoEnabled",
    organizationId: "settings.organizationId",
    taoClientId: "settings.taoClientId",
    taoDeploymentId: "settings.taoDeploymentId",
    taoInstanceUrl: "settings.taoInstanceUrl",
  },
}));
vi.mock("@/lib/public-origin", () => ({
  toHarlyPublicUrl: mocks.toHarlyPublicUrl,
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}));

import {
  beginTaoPortalAssignmentLaunch,
  CandidateLaunchError,
} from "./launch";

const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000001";
const DELIVERY_ID = "delivery-from-assessment-definition";

describe("assignment-backed TAO portal launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectProjections.length = 0;
    mocks.selectLimit
      .mockResolvedValueOnce([
        {
          assignmentId: ASSIGNMENT_ID,
          organizationId: "organization-a",
          applicationId: "application-a",
          status: "assigned",
          expiresAt: null,
          definitionId: "definition-a",
          assessmentName: "Production Test",
          externalId: DELIVERY_ID,
          definitionActive: true,
          jobId: "job-a",
        },
      ])
      .mockResolvedValueOnce([
        {
          enabled: true,
          clientId: "harly-client-a",
          deploymentId: "harly-deployment-a",
          instanceUrl: "https://tao.example.test/tenant",
        },
      ]);
    mocks.insertReturning.mockResolvedValueOnce([{ id: "launch-session-a" }]);
  });

  it("derives target_link_uri from the assigned definition and configured TAO origin", async () => {
    const initiationUrl = await beginTaoPortalAssignmentLaunch({
      assignmentId: ASSIGNMENT_ID,
      organizationId: "organization-a",
      candidateId: "candidate-a",
    });
    const url = new URL(initiationUrl);

    expect(url.origin).toBe("https://tao.example.test");
    expect(url.pathname).toBe("/auth-server/lti1p3/oidc/initiation");
    expect(url.searchParams.get("target_link_uri")).toBe(
      "https://tao.example.test/deliver/api/v1/auth/launch-lti-1p3/delivery-from-assessment-definition",
    );
    expect(url.searchParams.get("target_link_uri")).not.toContain(
      "tenant/attacker",
    );
    expect(url.searchParams.get("client_id")).toBe("harly-client-a");
    expect(url.searchParams.get("lti_deployment_id")).toBe(
      "harly-deployment-a",
    );
    expect(mocks.selectProjections[0]?.externalId).toBe(
      "assignment.providerResourceId",
    );
  });

  it("refuses an assignment outside the authenticated candidate and organization scope", async () => {
    mocks.selectLimit.mockReset().mockResolvedValueOnce([]);

    await expect(
      beginTaoPortalAssignmentLaunch({
        assignmentId: ASSIGNMENT_ID,
        organizationId: "another-organization",
        candidateId: "another-candidate",
      }),
    ).rejects.toBeInstanceOf(CandidateLaunchError);
    expect(mocks.insertReturning).not.toHaveBeenCalled();
  });
});