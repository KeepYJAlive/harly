import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const tables = vi.hoisted(() => ({
  activityEvents: { table: "activity-events" },
  applications: {
    id: "applications.id",
    workspaceId: "applications.workspaceId",
    jobId: "applications.jobId",
  },
  assessmentAssignments: {
    id: "assignments.id",
    organizationId: "assignments.organizationId",
    applicationId: "assignments.applicationId",
    jobId: "assignments.jobId",
    status: "assignments.status",
    startedAt: "assignments.startedAt",
    completedAt: "assignments.completedAt",
    resultReceivedAt: "assignments.resultReceivedAt",
    providerResultTimestamp: "assignments.providerResultTimestamp",
  },
  taoLtiSigningKeys: {
    organizationId: "keys.organizationId",
    kid: "keys.kid",
    publicJwk: "keys.publicJwk",
  },
  workspaceSettings: {
    organizationId: "settings.organizationId",
    taoClientId: "settings.taoClientId",
    taoEnabled: "settings.taoEnabled",
  },
}));

const mocks = vi.hoisted(() => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => conditions),
  eq: vi.fn((column, value) => ({ column, value })),
  isNull: vi.fn((column) => ({ column, isNull: true })),
  lt: vi.fn((column, value) => ({ column, value, operator: "lt" })),
  or: vi.fn((...conditions) => conditions),
}));
vi.mock("@harly/db", () => ({ ...tables, db: {} }));
vi.mock("@/lib/public-origin", () => ({
  getHarlyPublicOrigin: () => "https://harly.example",
}));
vi.mock("@/lib/audit-log", () => ({
  logAuditEvent: mocks.logAuditEvent,
}));

import {
  recordTaoAgsScore,
  taoAgsScoreSchema,
  TaoAgsError,
  verifyTaoAgsAccessToken,
} from "./ags";
import { LTI_AGS_SCORE_SCOPE } from "./claims";
import { createLtiSubject } from "./identity";

const previousEncryptionKey = process.env.AI_ENCRYPTION_KEY;
const CLIENT_ID = "tao-client";
const ORGANIZATION_ID = "organization-a";
const APPLICATION_ID = "application-a";

async function createAccessToken(options?: {
  clientId?: string;
  scope?: string;
}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: "harly-key-1",
    use: "sig",
    alg: "RS256",
  };
  const token = await new SignJWT({
    scope: options?.scope ?? LTI_AGS_SCORE_SCOPE,
    client_id: options?.clientId ?? CLIENT_ID,
  })
    .setProtectedHeader({ alg: "RS256", kid: "harly-key-1", typ: "JWT" })
    .setIssuer("https://harly.example")
    .setAudience("https://harly.example")
    .setSubject(options?.clientId ?? CLIENT_ID)
    .setJti("access-token-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, publicJwk };
}

function createDatabase(input: {
  publicJwk: Record<string, unknown>;
  assignment?: {
    id: string;
    applicationId: string;
    status: "assigned" | "started" | "completed";
    startedAt: Date | null;
    completedAt: Date | null;
    resultReceivedAt?: Date | null;
  } | null;
  updateAccepted?: boolean;
}) {
  const selectRows = [
    [
      {
        organizationId: ORGANIZATION_ID,
        clientId: CLIENT_ID,
        enabled: true,
      },
    ],
    [{ publicJwk: input.publicJwk }],
    input.assignment === null
      ? []
      : [
          input.assignment ?? {
            id: "assignment-a",
            applicationId: APPLICATION_ID,
            status: "started",
            startedAt: new Date("2026-09-29T11:00:00.000Z"),
            completedAt: null,
            resultReceivedAt: null,
          },
        ],
  ];
  let selectIndex = 0;
  const select = vi.fn(() => {
    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn(async () => selectRows[selectIndex++] ?? []),
    };
    return query;
  });
  const updateSet = vi.fn();
  const returning = vi
    .fn()
    .mockResolvedValue(
      input.updateAccepted === false ? [] : [{ id: "assignment-a" }],
    );
  const update = vi.fn(() => ({
    set: vi.fn((values) => {
      updateSet(values);
      return { where: vi.fn(() => ({ returning })) };
    }),
  }));
  const activityValues = vi.fn().mockResolvedValue(undefined);
  const transaction = vi.fn(async (callback) =>
    callback({
      update,
      insert: vi.fn((table) => {
        if (table !== tables.activityEvents)
          throw new Error("Unexpected table");
        return { values: activityValues };
      }),
    }),
  );
  return {
    database: { select, transaction },
    updateSet,
    activityValues,
  };
}

function validScore(userId: string) {
  return {
    userId,
    scoreGiven: 0,
    scoreMaximum: 100,
    timestamp: "2026-09-28T12:00:00.000Z",
    activityProgress: "Completed",
    gradingProgress: "FullyGraded",
    submission: {
      startedAt: "2026-09-28T11:00:00.000Z",
      submittedAt: "2026-09-28T11:55:00.000Z",
    },
  };
}

describe("TAO AGS score passback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
  });

  afterEach(() => {
    if (previousEncryptionKey === undefined)
      delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previousEncryptionKey;
  });

  it("requires official progress values and a maximum for a numeric score", () => {
    expect(
      taoAgsScoreSchema.safeParse({
        ...validScore("user"),
        scoreMaximum: undefined,
      }).success,
    ).toBe(false);
    expect(
      taoAgsScoreSchema.safeParse({
        ...validScore("user"),
        activityProgress: "Passed",
      }).success,
    ).toBe(false);
  });

  it("accepts only a valid Harly-issued RS256 score-scope token", async () => {
    const { token, publicJwk } = await createAccessToken();
    const { database } = createDatabase({ publicJwk });

    await expect(
      verifyTaoAgsAccessToken(token, database as never),
    ).resolves.toEqual({
      organizationId: ORGANIZATION_ID,
      clientId: CLIENT_ID,
    });
    const invalidDatabase = createDatabase({ publicJwk });
    await expect(
      verifyTaoAgsAccessToken(
        `${token}broken`,
        invalidDatabase.database as never,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a missing score scope and a different TAO client", async () => {
    const wrongScope = await createAccessToken({
      scope: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
    });
    await expect(
      verifyTaoAgsAccessToken(
        wrongScope.token,
        createDatabase({ publicJwk: wrongScope.publicJwk }).database as never,
      ),
    ).rejects.toMatchObject({ status: 401 });

    const wrongClient = await createAccessToken({ clientId: "another-client" });
    await expect(
      verifyTaoAgsAccessToken(
        wrongClient.token,
        createDatabase({ publicJwk: wrongClient.publicJwk }).database as never,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("records a zero score distinctly from missing data and marks completion", async () => {
    const { token, publicJwk } = await createAccessToken();
    const { database, updateSet, activityValues } = createDatabase({
      publicJwk,
    });
    const userId = createLtiSubject(ORGANIZATION_ID, APPLICATION_ID);

    await expect(
      recordTaoAgsScore({
        assignmentId: "assignment-a",
        accessToken: token,
        score: validScore(userId),
        database: database as never,
      }),
    ).resolves.toEqual({ updated: true });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 0,
        maxScore: 100,
        status: "completed",
        activityProgress: "Completed",
        gradingProgress: "FullyGraded",
        completedAt: new Date("2026-09-28T11:55:00.000Z"),
      }),
    );
    expect(activityValues).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: APPLICATION_ID,
        type: "assessment.result_received",
      }),
    );
  });

  it("rejects a score whose opaque LTI user does not match the assignment", async () => {
    const { token, publicJwk } = await createAccessToken();
    const { database, updateSet } = createDatabase({ publicJwk });

    await expect(
      recordTaoAgsScore({
        assignmentId: "assignment-a",
        accessToken: token,
        score: validScore("a-different-user"),
        database: database as never,
      }),
    ).rejects.toBeInstanceOf(TaoAgsError);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("does not resolve an assignment outside the token's organization", async () => {
    const { token, publicJwk } = await createAccessToken();
    const { database, updateSet } = createDatabase({
      publicJwk,
      assignment: null,
    });

    await expect(
      recordTaoAgsScore({
        assignmentId: "foreign-assignment",
        accessToken: token,
        score: validScore(createLtiSubject(ORGANIZATION_ID, APPLICATION_ID)),
        database: database as never,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("accepts a later fully graded update after a pending completion", async () => {
    const { token, publicJwk } = await createAccessToken();
    const { database, updateSet } = createDatabase({ publicJwk });
    const userId = createLtiSubject(ORGANIZATION_ID, APPLICATION_ID);

    await recordTaoAgsScore({
      assignmentId: "assignment-a",
      accessToken: token,
      score: {
        ...validScore(userId),
        timestamp: "2026-09-28T12:05:00.000Z",
        scoreGiven: 84,
        gradingProgress: "FullyGraded",
      },
      database: database as never,
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 84,
        maxScore: 100,
        gradingProgress: "FullyGraded",
      }),
    );
  });

  it("treats an older or replayed timestamp as an idempotent no-op", async () => {
    const { token, publicJwk } = await createAccessToken();
    const { database, activityValues } = createDatabase({
      publicJwk,
      updateAccepted: false,
    });
    const userId = createLtiSubject(ORGANIZATION_ID, APPLICATION_ID);

    await expect(
      recordTaoAgsScore({
        assignmentId: "assignment-a",
        accessToken: token,
        score: validScore(userId),
        database: database as never,
      }),
    ).resolves.toEqual({ updated: false });
    expect(activityValues).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a far-future provider timestamp that could block later updates", async () => {
    const { token, publicJwk } = await createAccessToken();
    const { database, updateSet } = createDatabase({ publicJwk });
    const userId = createLtiSubject(ORGANIZATION_ID, APPLICATION_ID);

    await expect(
      recordTaoAgsScore({
        assignmentId: "assignment-a",
        accessToken: token,
        score: {
          ...validScore(userId),
          timestamp: "2099-09-29T12:00:00.000Z",
        },
        database: database as never,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateSet).not.toHaveBeenCalled();
  });
});
