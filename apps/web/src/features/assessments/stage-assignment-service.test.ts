import { beforeEach, describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => ({
  assessmentAssignments: {
    id: "assignment.id",
    assessmentDefinitionId: "assignment.definition",
    providerResourceId: "assignment.providerResourceId",
  },
  assessmentDefinitions: {
    id: "definition.id",
    organizationId: "definition.organizationId",
    provider: "definition.provider",
    active: "definition.active",
  },
  activityEvents: { table: "activity" },
  candidatePortalNotifications: { table: "portal-notification" },
  emailOutbox: {
    table: "email-outbox",
    workspaceId: "outbox.workspaceId",
    dedupeKey: "outbox.dedupeKey",
  },
  jobStages: {
    id: "stage.id",
    workspaceId: "stage.workspaceId",
    jobId: "stage.jobId",
    name: "stage.name",
    assignAssessmentsOnEntry: "stage.assignAssessmentsOnEntry",
  },
  jobStageAssessments: {
    organizationId: "configuration.organizationId",
    jobId: "configuration.jobId",
    stageId: "configuration.stageId",
    assessmentDefinitionId: "configuration.definitionId",
    sendInvitation: "configuration.sendInvitation",
    deadlineDays: "configuration.deadlineDays",
  },
  workspaceSettings: {
    organizationId: "settings.organizationId",
    taoEnabled: "settings.taoEnabled",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values) => values),
  eq: vi.fn((column, value) => ({ column, value })),
}));
vi.mock("@harly/db", () => ({ ...tables, db: { transaction: vi.fn() } }));
vi.mock("@/lib/crypto", () => ({
  isEncryptionConfigured: vi.fn(() => true),
  encryptSecret: vi.fn(() => ({
    ciphertext: "encrypted-token",
    iv: "encrypted-iv",
    tag: "encrypted-tag",
  })),
  decryptSecret: vi.fn(),
}));

import { createStageAssessmentAssignments } from "./stage-assignment-service";

function createTransaction(
  configured: Array<{
    stageName: string;
    assessmentDefinitionId: string;
    providerResourceId: string;
    sendInvitation?: boolean;
    deadlineDays?: number | null;
  }>,
  inserted = configured.map((item, index) => ({
    id: `assignment-${index + 1}`,
    assessmentDefinitionId: item.assessmentDefinitionId,
  })),
) {
  const where = vi.fn().mockResolvedValue(configured);
  const thirdJoin = vi.fn(() => ({ where }));
  const secondJoin = vi.fn(() => ({ innerJoin: thirdJoin }));
  const firstJoin = vi.fn(() => ({ innerJoin: secondJoin }));
  const from = vi.fn(() => ({ innerJoin: firstJoin }));
  const select = vi.fn(() => ({ from }));

  const assignmentValues = vi.fn((values: Array<Record<string, unknown>>) => ({
    submittedValues: values,
    onConflictDoNothing: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(inserted),
    })),
  }));
  const activityValues = vi.fn(async (values: unknown) => {
    void values;
  });
  const notificationValues = vi.fn(async (values: unknown) => {
    void values;
  });
  const outboxConflict = vi.fn().mockResolvedValue(undefined);
  const outboxValues = vi.fn((values: unknown) => {
    void values;
    return { onConflictDoNothing: outboxConflict };
  });
  const insert = vi.fn((table) => {
    if (table === tables.assessmentAssignments) {
      return { values: assignmentValues };
    }
    if (table === tables.activityEvents) return { values: activityValues };
    if (table === tables.candidatePortalNotifications) {
      return { values: notificationValues };
    }
    if (table === tables.emailOutbox) return { values: outboxValues };
    throw new Error("Unexpected table");
  });
  return {
    tx: { select, insert },
    insert,
    assignmentValues,
    activityValues,
    notificationValues,
    outboxValues,
  };
}

const INPUT = {
  organizationId: "organization-a",
  jobId: "job-a",
  applicationId: "application-a",
  candidateId: "candidate-a",
  stageId: "stage-a",
  actorId: "user-a",
};

describe("automatic stage assessment assignments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when a stage has no configured active assessments", async () => {
    const { tx, insert } = createTransaction([]);
    await expect(
      createStageAssessmentAssignments(tx as never, INPUT),
    ).resolves.toEqual([]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates multiple local assignments without contacting TAO", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const configured = [
      {
        stageName: "Assessment",
        assessmentDefinitionId: "definition-a",
        providerResourceId: "delivery-a",
      },
      {
        stageName: "Assessment",
        assessmentDefinitionId: "definition-b",
        providerResourceId: "delivery-b",
      },
    ];
    const { tx, assignmentValues, activityValues, notificationValues } =
      createTransaction(configured);

    const result = await createStageAssessmentAssignments(tx as never, INPUT);
    expect(result).toHaveLength(2);
    const values = assignmentValues.mock.calls[0]![0];
    expect(values).toHaveLength(2);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: INPUT.organizationId,
          applicationId: INPUT.applicationId,
          assessmentDefinitionId: "definition-a",
          providerResourceId: "delivery-a",
          sourceStageId: INPUT.stageId,
        }),
        expect.objectContaining({
          assessmentDefinitionId: "definition-b",
          providerResourceId: "delivery-b",
        }),
      ]),
    );
    expect(values[0].launchTokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values[0].launchTokenHash).not.toBe(values[1].launchTokenHash);
    expect(activityValues).toHaveBeenCalledOnce();
    expect(notificationValues).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("treats a uniqueness conflict as an idempotent retry", async () => {
    const configured = [
      {
        stageName: "Assessment",
        assessmentDefinitionId: "definition-a",
        providerResourceId: "delivery-a",
      },
    ];
    const { tx, activityValues, notificationValues, outboxValues } =
      createTransaction(configured, []);
    await expect(
      createStageAssessmentAssignments(tx as never, INPUT),
    ).resolves.toEqual([]);
    expect(activityValues).not.toHaveBeenCalled();
    expect(notificationValues).not.toHaveBeenCalled();
    expect(outboxValues).not.toHaveBeenCalled();
  });

  it("queues one encrypted invitation with the configured deadline", async () => {
    const configured = [
      {
        stageName: "Assessment",
        assessmentDefinitionId: "definition-a",
        providerResourceId: "delivery-a",
        sendInvitation: true,
        deadlineDays: 7,
      },
    ];
    const { tx, assignmentValues, outboxValues, activityValues } =
      createTransaction(configured);

    await createStageAssessmentAssignments(tx as never, INPUT);

    const assignment = assignmentValues.mock.calls[0]![0][0];
    expect(assignment.expiresAt).toBeInstanceOf(Date);
    expect(
      (assignment.expiresAt as Date).getTime() -
        (assignment.assignedAt as Date).getTime(),
    ).toBe(7 * 24 * 60 * 60_000);
    expect(assignment.launchTokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(outboxValues).toHaveBeenCalledWith([
      expect.objectContaining({
        workspaceId: INPUT.organizationId,
        kind: "assessment.invitation",
        dedupeKey: "assessment-invitation:assignment-1",
        payload: expect.objectContaining({
          assignmentId: "assignment-1",
          tokenCiphertext: "encrypted-token",
        }),
      }),
    ]);
    expect(JSON.stringify(outboxValues.mock.calls[0]![0])).not.toContain(
      assignment.launchTokenHash as string,
    );
    expect(activityValues.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "assessment.invitation_queued" }),
      ]),
    );
  });

  it("keeps assessment selection isolated for jobs with the same logical stage", async () => {
    const jobA = createTransaction([
      {
        stageName: "Assessment",
        assessmentDefinitionId: "volunteer-sjt",
        providerResourceId: "delivery-sjt",
      },
      {
        stageName: "Assessment",
        assessmentDefinitionId: "digital-artist",
        providerResourceId: "delivery-artist",
      },
    ]);
    const jobB = createTransaction([
      {
        stageName: "Assessment",
        assessmentDefinitionId: "volunteer-sjt",
        providerResourceId: "delivery-sjt",
      },
      {
        stageName: "Assessment",
        assessmentDefinitionId: "video-editor",
        providerResourceId: "delivery-video",
      },
    ]);

    await createStageAssessmentAssignments(jobA.tx as never, {
      ...INPUT,
      jobId: "job-a",
      stageId: "job-a-assessment-stage",
    });
    await createStageAssessmentAssignments(jobB.tx as never, {
      ...INPUT,
      jobId: "job-b",
      applicationId: "application-b",
      candidateId: "candidate-b",
      stageId: "job-b-assessment-stage",
    });

    expect(jobA.assignmentValues.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: "job-a",
          assessmentDefinitionId: "digital-artist",
        }),
      ]),
    );
    expect(jobA.assignmentValues.mock.calls[0]![0]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assessmentDefinitionId: "video-editor" }),
      ]),
    );
    expect(jobB.assignmentValues.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: "job-b",
          assessmentDefinitionId: "video-editor",
        }),
      ]),
    );
  });

  it("treats the same assessment at two stages as separate intentions", async () => {
    const configured = [
      {
        stageName: "Assessment",
        assessmentDefinitionId: "volunteer-sjt",
        providerResourceId: "delivery-sjt",
      },
    ];
    const firstStage = createTransaction(configured);
    const secondStage = createTransaction(configured);

    await createStageAssessmentAssignments(firstStage.tx as never, {
      ...INPUT,
      stageId: "screening-stage",
    });
    await createStageAssessmentAssignments(secondStage.tx as never, {
      ...INPUT,
      stageId: "assessment-stage",
    });

    expect(firstStage.assignmentValues.mock.calls[0]![0][0]).toEqual(
      expect.objectContaining({ sourceStageId: "screening-stage" }),
    );
    expect(secondStage.assignmentValues.mock.calls[0]![0][0]).toEqual(
      expect.objectContaining({ sourceStageId: "assessment-stage" }),
    );
  });
});
