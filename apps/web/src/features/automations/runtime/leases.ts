import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { workflowRuns, type db } from "@harly/db";

export type RunLease = {
  workspaceId: string;
  runId: string;
  workerId: string;
  fenceToken: number;
  attemptCount: number;
  /** A cancellation-only lease may finalize a run after cancel was requested,
   * but is never allowed to perform provider work. */
  cancellationOnly: boolean;
};

export type ClaimOptions = { allowWaiting?: boolean; allowCancellation?: boolean };
type LeaseClaimInput = Omit<RunLease, "fenceToken" | "attemptCount" | "cancellationOnly"> & {
  cancellationOnly?: boolean;
};

/** Database clock + CAS. Every later write must retain the same live fence. */
export function graphRunLeases(database: Pick<typeof db, "transaction" | "update">) {
  const valid = (lease: RunLease) => and(
    eq(workflowRuns.workspaceId, lease.workspaceId), eq(workflowRuns.id, lease.runId),
    eq(workflowRuns.engineVersion, 2), eq(workflowRuns.logicalStatus, "running"),
    eq(workflowRuns.lockedBy, lease.workerId), eq(workflowRuns.fenceToken, lease.fenceToken),
    gt(workflowRuns.leaseUntil, sql`clock_timestamp()`),
    lease.cancellationOnly ? sql`true` : isNull(workflowRuns.cancelRequestedAt),
  );
  return {
    async claim(
      input: LeaseClaimInput,
      options: ClaimOptions = {},
    ): Promise<RunLease | null> {
      if (!input.workerId.trim()) throw new Error("Worker identity is required");
      return database.transaction(async (tx) => {
        // Lock the candidate before updating it. This makes the one-winner
        // invariant explicit under burst delivery and worker replacement.
        const terminalDocumentWake = sql`(
          "logical_status" = 'waiting'
          and exists (
            select 1 from "workflow_node_executions" executions
            where executions."run_id" = "workflow_runs"."id"
              and executions."status" = 'waiting'
              and executions."waiting_kind" = 'document_package'
              and (
                (
                  coalesce(executions."waiting_resource_type", 'package') = 'package'
                  and exists (
                  select 1 from "document_request_packages" packages
                  where packages."id"::text = executions."waiting_resource_id"
                    and packages."workspace_id" = "workflow_runs"."workspace_id"
                    and packages."status" in ('completed', 'declined', 'expired', 'cancelled')
                  )
                )
                or (
                  (
                    executions."waiting_resource_type" = 'document'
                    or executions."waiting_resource_type" is null
                  )
                  and exists (
                    select 1 from "documents" signed_documents
                    where signed_documents."id"::text = executions."waiting_resource_id"
                      and signed_documents."workspace_id" = "workflow_runs"."workspace_id"
                    and signed_documents."signature_status" in ('signed', 'declined', 'expired')
                  )
                )
              )
          )
        )`;
        const deadlinePredicate = options.allowWaiting
          ? sql`true`
          : sql`(
              ("next_attempt_at" <= clock_timestamp() and ("logical_status" <> 'waiting' or exists (
                select 1 from "workflow_node_executions" executions
                where executions."run_id" = "workflow_runs"."id"
                  and executions."status" = 'waiting'
                  and executions."deadline_at" <= clock_timestamp()
              )))
              or ${terminalDocumentWake}
            )`;
        const eligiblePredicate = options.allowCancellation
          ? sql`("cancel_requested_at" is not null or ${deadlinePredicate})`
          : deadlinePredicate;
        const [row] = await tx.execute(sql`
          with candidate as (
            select "id"
            from "workflow_runs"
            where "workspace_id" = ${input.workspaceId}
              and "id" = ${input.runId}
              and "engine_version" = 2
              and "logical_status" in ('queued', 'retrying', 'running', 'waiting')
              and ${options.allowCancellation ? sql`true` : sql`"cancel_requested_at" is null`}
              and ${eligiblePredicate}
              and ("locked_by" is null or "lease_until" <= clock_timestamp())
              and exists (
                select 1 from "workflow_definition_versions" versions
                where versions."id" = "workflow_runs"."version_id"
                  and versions."workspace_id" = "workflow_runs"."workspace_id"
                  and versions."workflow_id" = "workflow_runs"."workflow_id"
                  and versions."schema_version" = 2
                  and versions."published_at" is not null
              )
            for update skip locked
            limit 1
          )
          update "workflow_runs" as runs
          set "attempt_count" = runs."attempt_count" + 1,
              "logical_status" = 'running',
              "locked_by" = ${input.workerId},
              "locked_at" = clock_timestamp(),
              "heartbeat_at" = clock_timestamp(),
              "lease_until" = clock_timestamp() + interval '60 seconds',
              "fence_token" = runs."fence_token" + 1,
              "updated_at" = clock_timestamp()
          from candidate
          where runs."id" = candidate."id"
          returning runs."fence_token" as "fenceToken", runs."attempt_count" as "attemptCount",
                    runs."cancel_requested_at" as "cancelRequestedAt"
        `) as unknown as Array<{ fenceToken: number; attemptCount: number; cancelRequestedAt: Date | null }>;
        return row
          ? {
            ...input,
            fenceToken: Number(row.fenceToken),
            attemptCount: Number(row.attemptCount),
            cancellationOnly: Boolean(row.cancelRequestedAt),
          }
          : null;
      });
    },
    async renew(lease: RunLease): Promise<boolean> {
      const rows = await database.update(workflowRuns).set({
        heartbeatAt: sql`clock_timestamp()`, leaseUntil: sql`clock_timestamp() + interval '60 seconds'`, updatedAt: sql`clock_timestamp()`,
      }).where(valid(lease)).returning({ id: workflowRuns.id });
      return rows.length === 1;
    },
    async release(lease: RunLease, status: "queued" | "waiting" | "retrying"): Promise<boolean> {
      const rows = await database.update(workflowRuns).set({
        logicalStatus: status, lockedBy: null, lockedAt: null, leaseUntil: null, updatedAt: sql`clock_timestamp()`,
      }).where(valid(lease)).returning({ id: workflowRuns.id });
      return rows.length === 1;
    },
  };
}
