import "server-only";
import { and, eq, exists, inArray, ne, or, sql } from "drizzle-orm";
import { db, interviews, interviewParticipants, member, user } from "@harly/db";
import { lockInterviewerSchedule } from "./booking-lock";
import type { InterviewParticipant } from "./scheduling-shared";

export class InterviewTeamConflictError extends Error {}

type Executor = Pick<typeof db, "select" | "execute">;

export async function validateInterviewTeam(
  workspaceId: string,
  team: InterviewParticipant[],
  executor: Pick<typeof db, "select"> = db,
) {
  const ids = [...new Set(team.map((p) => p.userId))];
  if (!ids.length) return;
  const members = await executor
    .select({ id: member.userId })
    .from(member)
    .where(
      and(eq(member.organizationId, workspaceId), inArray(member.userId, ids)),
    );
  if (members.length !== ids.length)
    throw new Error("Interview participants must belong to this workspace.");
}

export function participantCondition(userIds: string[]) {
  return or(
    inArray(interviews.interviewerId, userIds),
    exists(
      db
        .select({ id: interviewParticipants.id })
        .from(interviewParticipants)
        .where(
          and(
            eq(interviewParticipants.interviewId, interviews.id),
            inArray(interviewParticipants.userId, userIds),
          ),
        ),
    ),
  );
}

export async function lockAndCheckTeam(
  executor: Executor,
  input: {
    workspaceId: string;
    userIds: string[];
    when: Date;
    durationMins: number;
    excludeInterviewId?: string;
  },
) {
  const ids = [...new Set(input.userIds)].sort();
  for (const id of ids)
    await lockInterviewerSchedule(executor, input.workspaceId, id);
  if (!ids.length) return;
  const [conflict] = await executor
    .select({ id: interviews.id })
    .from(interviews)
    .where(
      and(
        eq(interviews.workspaceId, input.workspaceId),
        eq(interviews.status, "scheduled"),
        participantCondition(ids),
        input.excludeInterviewId
          ? ne(interviews.id, input.excludeInterviewId)
          : undefined,
        sql`${interviews.scheduledAt} < ${new Date(input.when.getTime() + input.durationMins * 60_000).toISOString()}`,
        sql`${interviews.scheduledAt} + (${interviews.durationMins} * interval '1 minute') > ${input.when.toISOString()}`,
      ),
    )
    .limit(1);
  if (conflict)
    throw new InterviewTeamConflictError(
      "An interview participant already has an overlapping interview.",
    );
}

export async function getInterviewTeam(
  interviewId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  return executor
    .select({
      userId: interviewParticipants.userId,
      role: interviewParticipants.role,
    })
    .from(interviewParticipants)
    .where(eq(interviewParticipants.interviewId, interviewId));
}

export async function participantEmails(
  interviewId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  const rows = await executor
    .select({ email: user.email })
    .from(interviewParticipants)
    .innerJoin(user, eq(user.id, interviewParticipants.userId))
    .where(eq(interviewParticipants.interviewId, interviewId));
  return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
}
