import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import {
  db,
  workflowDefinitions,
  workflowExternalActionBuckets,
  workflowRunBuckets,
  workflowRuns,
} from "@harly/db";

/** A bounded chain may still span several workflow definitions. */
export const MAX_LINEAGE_EXTERNAL_ACTIONS = 100;

export type ExternalActionReservation =
  | { ok: true }
  | { ok: false; code: "CIRCUIT_OPEN" | "EXTERNAL_RATE_LIMITED" | "LINEAGE_EFFECT_BUDGET_EXHAUSTED" | "WORKFLOW_POLICY_NOT_FOUND" };

class ReservationRejected extends Error {
  constructor(readonly code: Extract<ExternalActionReservation, { ok: false }>['code']) {
    super(code);
  }
}

function minuteBucket(now = new Date()): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
    ),
  );
}

/**
 * Reserve all operational capacity before calling an external provider. The
 * bucket update and root-run budget update are conditional writes, so two
 * workers cannot both be admitted after observing the same old count.
 */
export async function reserveExternalActionPolicy(input: {
  workspaceId: string;
  workflowId: string;
  runId: string;
  database?: typeof db;
  now?: Date;
}): Promise<ExternalActionReservation> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  try {
    return await database.transaction(async (tx) => {
    const [run] = await tx
      .select({ rootRunId: workflowRuns.rootRunId })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workspaceId, input.workspaceId),
          eq(workflowRuns.id, input.runId),
        ),
      )
      .limit(1);
    if (!run) throw new ReservationRejected("WORKFLOW_POLICY_NOT_FOUND");

    const [definition] = await tx
      .select({
        maxExternalActionsPerMinute:
          workflowDefinitions.maxExternalActionsPerMinute,
        circuitOpenUntil: workflowDefinitions.circuitOpenUntil,
      })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspaceId, input.workspaceId),
          eq(workflowDefinitions.id, input.workflowId),
        ),
      )
      .limit(1);
    if (!definition) throw new ReservationRejected("WORKFLOW_POLICY_NOT_FOUND");
    if (definition.circuitOpenUntil && definition.circuitOpenUntil > now) {
      throw new ReservationRejected("CIRCUIT_OPEN");
    }

    const bucketStart = minuteBucket(now);
    const [bucket] = await tx
      .insert(workflowExternalActionBuckets)
      .values({
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        bucketStart,
        reserved: 1,
      })
      .onConflictDoUpdate({
        target: [
          workflowExternalActionBuckets.workspaceId,
          workflowExternalActionBuckets.workflowId,
          workflowExternalActionBuckets.bucketStart,
        ],
        set: {
          reserved: sql`${workflowExternalActionBuckets.reserved} + 1`,
          updatedAt: sql`clock_timestamp()`,
        },
        where: lt(
          workflowExternalActionBuckets.reserved,
          definition.maxExternalActionsPerMinute,
        ),
      })
      .returning({ id: workflowExternalActionBuckets.id });
    if (!bucket) throw new ReservationRejected("EXTERNAL_RATE_LIMITED");
    const rootRunId = run.rootRunId ?? input.runId;
    const [root] = await tx
      .update(workflowRuns)
      .set({
        lineageExternalActions: sql`${workflowRuns.lineageExternalActions} + 1`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowRuns.workspaceId, input.workspaceId),
          eq(workflowRuns.id, rootRunId),
          lt(
            workflowRuns.lineageExternalActions,
            MAX_LINEAGE_EXTERNAL_ACTIONS,
          ),
        ),
      )
      .returning({ id: workflowRuns.id });
    if (!root) throw new ReservationRejected("LINEAGE_EFFECT_BUDGET_EXHAUSTED");
    return { ok: true };
    });
  } catch (error) {
    if (error instanceof ReservationRejected) {
      return { ok: false, code: error.code };
    }
    throw error;
  }
}

/** Update the live circuit after a provider outcome, not at the end of a run. */
export async function recordExternalActionOutcome(input: {
  workspaceId: string;
  workflowId: string;
  outcome: "succeeded" | "failed" | "uncertain";
  database?: typeof db;
}): Promise<void> {
  const database = input.database ?? db;
  await database.transaction(async (tx) => {
    if (input.outcome === "succeeded") {
      await tx
        .update(workflowDefinitions)
        .set({
          consecutiveFailureCount: 0,
          circuitOpenUntil: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(workflowDefinitions.workspaceId, input.workspaceId),
            eq(workflowDefinitions.id, input.workflowId),
          ),
        );
      return;
    }
    const [updated] = await tx
      .update(workflowDefinitions)
      .set({
        consecutiveFailureCount:
          sql`${workflowDefinitions.consecutiveFailureCount} + 1`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowDefinitions.workspaceId, input.workspaceId),
          eq(workflowDefinitions.id, input.workflowId),
        ),
      )
      .returning({
        failures: workflowDefinitions.consecutiveFailureCount,
        threshold: workflowDefinitions.circuitBreakerThreshold,
        cooldown: workflowDefinitions.circuitBreakerCooldownSeconds,
      });
    const failure = updated?.failures ?? 0;
    if (failure < (updated?.threshold ?? Number.MAX_SAFE_INTEGER)) return;
    await tx
      .update(workflowDefinitions)
      .set({
        circuitOpenUntil:
          sql`clock_timestamp() + (${updated!.cooldown} * interval '1 second')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowDefinitions.workspaceId, input.workspaceId),
          eq(workflowDefinitions.id, input.workflowId),
        ),
      );
  });
}

export type RunAdmissionReservation =
  | { ok: true }
  | {
      ok: false;
      code: "CIRCUIT_OPEN" | "RUN_RATE_LIMITED" | "WORKFLOW_POLICY_NOT_FOUND";
      /** Earliest time the caller may retry admission. */
      deferUntil: Date;
    };

/**
 * Atomic per-minute admission for new workflow runs. Unlike the previous
 * soft defer (count then +15s), two workers cannot both admit after seeing
 * the same reserved count — the conditional upsert is the source of truth.
 */
export async function reserveRunAdmissionPolicy(input: {
  workspaceId: string;
  workflowId: string;
  maxRunsPerMinute: number;
  circuitOpenUntil: Date | null;
  database?: typeof db;
  now?: Date;
}): Promise<RunAdmissionReservation> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  if (input.circuitOpenUntil && input.circuitOpenUntil > now) {
    return {
      ok: false,
      code: "CIRCUIT_OPEN",
      deferUntil: input.circuitOpenUntil,
    };
  }
  const bucketStart = minuteBucket(now);
  const nextBucket = new Date(bucketStart.getTime() + 60_000);
  try {
    const [bucket] = await database
      .insert(workflowRunBuckets)
      .values({
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        bucketStart,
        reserved: 1,
      })
      .onConflictDoUpdate({
        target: [
          workflowRunBuckets.workspaceId,
          workflowRunBuckets.workflowId,
          workflowRunBuckets.bucketStart,
        ],
        set: {
          reserved: sql`${workflowRunBuckets.reserved} + 1`,
          updatedAt: sql`clock_timestamp()`,
        },
        where: lt(workflowRunBuckets.reserved, input.maxRunsPerMinute),
      })
      .returning({ id: workflowRunBuckets.id });
    if (!bucket) {
      return {
        ok: false,
        code: "RUN_RATE_LIMITED",
        deferUntil: nextBucket,
      };
    }
    return { ok: true };
  } catch (error) {
    // Surface infra failures to the caller (fail-closed at dispatch).
    throw error;
  }
}

