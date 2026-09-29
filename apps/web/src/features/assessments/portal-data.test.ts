import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((column, value) => ({ column, value })),
  where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => conditions),
  eq: mocks.eq,
}));
vi.mock("@harly/db", () => ({
  applications: {
    id: "application.id",
    workspaceId: "application.workspaceId",
    candidateId: "application.candidateId",
  },
  assessmentAssignments: {
    id: "assignment.id",
    organizationId: "assignment.organizationId",
    applicationId: "assignment.applicationId",
    assessmentDefinitionId: "assignment.definitionId",
    status: "assignment.status",
    expiresAt: "assignment.expiresAt",
  },
  assessmentDefinitions: {
    id: "definition.id",
    organizationId: "definition.organizationId",
    name: "definition.name",
    active: "definition.active",
  },
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          innerJoin: vi.fn(() => ({ where: mocks.where })),
        })),
      })),
    })),
  },
}));

import { getPortalAssessmentAssignment } from "./portal-data";

describe("candidate portal assessment isolation", () => {
  it("requires the assignment organization and authenticated candidate", async () => {
    await getPortalAssessmentAssignment({
      assignmentId: "assignment-a",
      organizationId: "organization-a",
      candidateId: "candidate-a",
    });

    expect(mocks.eq).toHaveBeenCalledWith(
      "assignment.organizationId",
      "organization-a",
    );
    expect(mocks.eq).toHaveBeenCalledWith(
      "application.candidateId",
      "candidate-a",
    );
    expect(mocks.eq).toHaveBeenCalledWith("assignment.id", "assignment-a");
  });
});
