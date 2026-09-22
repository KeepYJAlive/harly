import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  reserved: 0,
  max: 2,
  fail: false,
};

vi.mock("@harly/db", () => ({
  db: {},
  workflowDefinitions: {},
  workflowExternalActionBuckets: {},
  workflowRunBuckets: {
    workspaceId: "workspaceId",
    workflowId: "workflowId",
    bucketStart: "bucketStart",
    reserved: "reserved",
    id: "id",
  },
  workflowRuns: {},
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    sql: actual.sql,
    lt: actual.lt,
    and: actual.and,
    eq: actual.eq,
  };
});

import { reserveRunAdmissionPolicy } from "./operational-policy";

function mockDb() {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            if (state.fail) throw new Error("database unavailable");
            if (state.reserved >= state.max) return [];
            state.reserved += 1;
            return [{ id: `bucket-${state.reserved}` }];
          },
        }),
      }),
    }),
  };
}

describe("reserveRunAdmissionPolicy", () => {
  beforeEach(() => {
    state.reserved = 0;
    state.max = 2;
    state.fail = false;
  });

  it("admits until the per-minute ceiling, then hard-defers to the next bucket", async () => {
    const database = mockDb() as never;
    const now = new Date("2026-09-22T12:00:30.000Z");
    await expect(
      reserveRunAdmissionPolicy({
        workspaceId: "ws",
        workflowId: "wf",
        maxRunsPerMinute: 2,
        circuitOpenUntil: null,
        database,
        now,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      reserveRunAdmissionPolicy({
        workspaceId: "ws",
        workflowId: "wf",
        maxRunsPerMinute: 2,
        circuitOpenUntil: null,
        database,
        now,
      }),
    ).resolves.toEqual({ ok: true });
    const limited = await reserveRunAdmissionPolicy({
      workspaceId: "ws",
      workflowId: "wf",
      maxRunsPerMinute: 2,
      circuitOpenUntil: null,
      database,
      now,
    });
    expect(limited).toMatchObject({
      ok: false,
      code: "RUN_RATE_LIMITED",
    });
    if (limited.ok) throw new Error("expected limit");
    expect(limited.deferUntil.toISOString()).toBe("2026-09-22T12:01:00.000Z");
  });

  it("defers to circuitOpenUntil when the circuit is open", async () => {
    const until = new Date("2026-09-22T12:05:00.000Z");
    await expect(
      reserveRunAdmissionPolicy({
        workspaceId: "ws",
        workflowId: "wf",
        maxRunsPerMinute: 10,
        circuitOpenUntil: until,
        database: mockDb() as never,
        now: new Date("2026-09-22T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, code: "CIRCUIT_OPEN", deferUntil: until });
  });
});
