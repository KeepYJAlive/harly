import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  applications,
  candidates,
  db,
  interviewSchedulingRequests as requests,
  interviewSchedulingSlots as slots,
  jobs,
} from "@harly/db";
import { getWorkspaceContext } from "@/features/workspaces/context";
import { requireApplicationPermission } from "@/features/workspaces/permissions-server";
import type { PortalSession } from "@/lib/portal-auth";

async function listRequests(
  workspaceId: string,
  candidateId?: string,
  applicationId?: string,
) {
  const rows = await db
    .select({
      request: requests,
      candidateName: candidates.firstName,
      candidateTimeZone: candidates.timezone,
      jobTitle: jobs.title,
      department: jobs.department,
    })
    .from(requests)
    .innerJoin(
      applications,
      and(
        eq(applications.id, requests.applicationId),
        eq(applications.workspaceId, workspaceId),
      ),
    )
    .innerJoin(
      candidates,
      and(
        eq(candidates.id, applications.candidateId),
        eq(candidates.workspaceId, workspaceId),
        isNull(candidates.deletedAt),
      ),
    )
    .innerJoin(
      jobs,
      and(
        eq(jobs.id, applications.jobId),
        eq(jobs.workspaceId, workspaceId),
        isNull(jobs.deletedAt),
      ),
    )
    .where(
      and(
        eq(requests.workspaceId, workspaceId),
        candidateId ? eq(candidates.id, candidateId) : undefined,
        applicationId ? eq(applications.id, applicationId) : undefined,
      ),
    )
    .orderBy(asc(requests.createdAt));
  const allSlots = rows.length
    ? await db
        .select()
        .from(slots)
        .where(
          inArray(
            slots.requestId,
            rows.map((r) => r.request.id),
          ),
        )
        .orderBy(asc(slots.scheduledAt))
    : [];
  return rows.map(({ request, ...context }) => ({
    ...context,
    id: request.id,
    applicationId: request.applicationId,
    title: request.title,
    type: request.type,
    mode: request.mode,
    durationMins: request.durationMins,
    timeZone: request.timeZone,
    status:
      request.expiresAt < new Date() &&
      ["awaiting_candidate", "pending_review", "needs_rescheduling"].includes(
        request.status,
      )
        ? ("expired" as const)
        : request.status,
    slots: allSlots
      .filter((s) => s.requestId === request.id)
      .map((s) => ({
        id: s.id,
        scheduledAt: s.scheduledAt.toISOString(),
        status: s.status,
        proposedBy: s.proposedBy,
      })),
  }));
}
export type SchedulingRequestItem = Awaited<
  ReturnType<typeof listRequests>
>[number];
export async function listPortalSchedulingRequests(
  session: PortalSession,
  applicationId: string,
) {
  return listRequests(session.workspaceId, session.candidateId, applicationId);
}
export async function listWorkspaceSchedulingRequests() {
  const { organization } = await getWorkspaceContext();
  const rows = await listRequests(organization.id);
  const allowed = await Promise.all(
    rows.map(async (row) => {
      try {
        await requireApplicationPermission(
          "interviews:manage",
          row.applicationId,
        );
        return row;
      } catch {
        return null;
      }
    }),
  );
  return allowed.filter((r): r is SchedulingRequestItem => r !== null);
}
