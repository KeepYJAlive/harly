import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  db,
  interviews,
  interviewRequestParticipants,
  type interviewSchedulingRequests,
  type interviewSchedulingSlots,
} from "@harly/db";
import { participantCondition } from "./participants";
import { overlapsReservation } from "./availability-calendar";

/** Return choices only; never send workspace calendar event details to the portal. */
export async function availablePortalSlots(
  request: typeof interviewSchedulingRequests.$inferSelect,
  slots: (typeof interviewSchedulingSlots.$inferSelect)[],
) {
  const offered = slots.filter(
    (s) => s.status === "offered" && s.scheduledAt > new Date(),
  );
  if (!offered.length) return slots.filter((s) => s.status !== "offered");
  const team = await db
    .select({ userId: interviewRequestParticipants.userId })
    .from(interviewRequestParticipants)
    .where(eq(interviewRequestParticipants.requestId, request.id));
  const ids = [
    ...new Set([
      ...team.map((p) => p.userId),
      ...(request.interviewerId ? [request.interviewerId] : []),
    ]),
  ];
  const start = new Date(
    Math.min(...offered.map((s) => s.scheduledAt.getTime())),
  );
  const end = new Date(
    Math.max(...offered.map((s) => s.scheduledAt.getTime())) +
      request.durationMins * 60_000,
  );
  const reservations = ids.length
    ? await db
        .select({
          id: interviews.id,
          scheduledAt: interviews.scheduledAt,
          durationMins: interviews.durationMins,
        })
        .from(interviews)
        .where(
          and(
            eq(interviews.workspaceId, request.workspaceId),
            eq(interviews.status, "scheduled"),
            participantCondition(ids),
            lt(interviews.scheduledAt, end),
            sql`${interviews.scheduledAt} + (${interviews.durationMins} * interval '1 minute') > ${start.toISOString()}`,
          ),
        )
    : [];
  return slots.filter(
    (slot) =>
      slot.status !== "offered" ||
      (slot.scheduledAt > new Date() &&
        !overlapsReservation(
          slot.scheduledAt.toISOString(),
          request.durationMins,
          reservations.filter((r) => r.id !== request.interviewId),
        )),
  );
}
