import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertNotDemo: vi.fn(),
  requireJobPermission: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((column, value) => ({ column, value })),
  inArray: vi.fn((column, values) => ({ column, values })),
}));
vi.mock("@harly/db", () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
  assessmentDefinitions: {
    id: "definition.id",
    organizationId: "definition.organizationId",
    provider: "definition.provider",
    active: "definition.active",
  },
  jobStages: {
    id: "stage.id",
    jobId: "stage.jobId",
    workspaceId: "stage.workspaceId",
  },
  pipelineStageAssessments: {
    organizationId: "configuration.organizationId",
    stageId: "configuration.stageId",
    assessmentDefinitionId: "configuration.definitionId",
  },
  workspaceSettings: {
    organizationId: "settings.organizationId",
    taoEnabled: "settings.taoEnabled",
  },
}));
vi.mock("@/features/demo/assert-not-demo", () => ({
  assertNotDemo: mocks.assertNotDemo,
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requireJobPermission: mocks.requireJobPermission,
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: mocks.logAuditEvent }));

import { saveStageAssessmentConfigurationAction } from "./stage-actions";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const STAGE_ID = "00000000-0000-4000-8000-000000000002";
const DEFINITION_A = "00000000-0000-4000-8000-000000000003";
const DEFINITION_B = "00000000-0000-4000-8000-000000000004";

function limited(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
    })),
  };
}

function rows(rowsValue: unknown[]) {
  return {
    from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rowsValue) })),
  };
}

function prepareQueries(input: {
  integrationEnabled: boolean;
  definitions?: Array<{ id: string; active: boolean }>;
  existingIds?: string[];
}) {
  mocks.select
    .mockReturnValueOnce(limited([{ id: STAGE_ID }]))
    .mockReturnValueOnce(limited([{ enabled: input.integrationEnabled }]))
    .mockReturnValueOnce(rows(input.definitions ?? []))
    .mockReturnValueOnce(
      rows(
        (input.existingIds ?? []).map((assessmentDefinitionId) => ({
          assessmentDefinitionId,
        })),
      ),
    );
}

describe("pipeline stage assessment configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireJobPermission.mockResolvedValue({
      organization: { id: "organization-a" },
      user: { id: "user-a", email: "owner@example.com" },
    });
  });

  it("requires jobs:edit permission for the selected job", async () => {
    mocks.requireJobPermission.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      saveStageAssessmentConfigurationAction({
        jobId: JOB_ID,
        stageId: STAGE_ID,
        enabled: true,
        assessmentDefinitionIds: [DEFINITION_A],
      }),
    ).rejects.toThrow("forbidden");
    expect(mocks.requireJobPermission).toHaveBeenCalledWith(
      "jobs:edit",
      JOB_ID,
    );
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("prevents new configuration while the TAO integration is disabled", async () => {
    prepareQueries({
      integrationEnabled: false,
      definitions: [{ id: DEFINITION_A, active: true }],
    });
    const result = await saveStageAssessmentConfigurationAction({
      jobId: JOB_ID,
      stageId: STAGE_ID,
      enabled: true,
      assessmentDefinitionIds: [DEFINITION_A],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Enable the TAO integration");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a newly selected inactive or foreign assessment", async () => {
    prepareQueries({
      integrationEnabled: true,
      definitions: [{ id: DEFINITION_A, active: false }],
    });
    const result = await saveStageAssessmentConfigurationAction({
      jobId: JOB_ID,
      stageId: STAGE_ID,
      enabled: true,
      assessmentDefinitionIds: [DEFINITION_A],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("active TAO assessments");
  });

  it("saves multiple active assessments and scopes every write", async () => {
    prepareQueries({
      integrationEnabled: true,
      definitions: [
        { id: DEFINITION_A, active: true },
        { id: DEFINITION_B, active: true },
      ],
    });
    const insertedValues = vi.fn().mockResolvedValue(undefined);
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      insert: vi.fn(() => ({ values: insertedValues })),
    };
    mocks.transaction.mockImplementationOnce(async (callback) => callback(tx));

    const result = await saveStageAssessmentConfigurationAction({
      jobId: JOB_ID,
      stageId: STAGE_ID,
      enabled: true,
      assessmentDefinitionIds: [DEFINITION_A, DEFINITION_B],
    });
    expect(result).toEqual({ ok: true });
    expect(insertedValues).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: "organization-a",
        stageId: STAGE_ID,
        assessmentDefinitionId: DEFINITION_A,
      }),
      expect.objectContaining({ assessmentDefinitionId: DEFINITION_B }),
    ]);
  });

  it("preserves an already configured inactive definition on edit", async () => {
    prepareQueries({
      integrationEnabled: true,
      definitions: [{ id: DEFINITION_A, active: false }],
      existingIds: [DEFINITION_A],
    });
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    };
    mocks.transaction.mockImplementationOnce(async (callback) => callback(tx));
    await expect(
      saveStageAssessmentConfigurationAction({
        jobId: JOB_ID,
        stageId: STAGE_ID,
        enabled: true,
        assessmentDefinitionIds: [DEFINITION_A],
      }),
    ).resolves.toEqual({ ok: true });
  });
});
