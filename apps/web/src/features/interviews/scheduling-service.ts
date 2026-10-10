import "server-only";
import { and, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  applications,
  candidates,
  db,
  interviews,
  interviewParticipants,
  interviewRequestParticipants,
  interviewSchedulingRequests as requests,
  interviewSchedulingSlots as slots,
  jobs,
  candidatePortalNotifications,
  activityEvents,
} from "@harly/db";
import { z } from "zod";
import {
  normalizeTeam,
  parseSlots,
  slotsSchema,
  teamSchema,
  timeZoneSchema,
} from "./scheduling-shared";
import {
  getInterviewTeam,
  lockAndCheckTeam,
  validateInterviewTeam,
} from "./participants";
import { deriveMeetLink } from "./shared";
import {
  runApiInterviewSideEffects,
  interviewPortalNotification,
  type ApiMeetingProvider,
} from "./api-side-effects";
import {
  persistDomainEvent,
  publishPersistedDomainEvents,
} from "@/server/events/emit";
import {
  confirmedSyncProviders,
  existingSyncProviders,
  persistSyncIntents,
} from "./sync-intent";
import { serializeInterview } from "./service";

export const requestSchema = z.object({
  applicationId: z.string().uuid(),
  interviewId: z.string().uuid().optional(),
  interviewerId: z.string().nullable().optional(),
  participants: teamSchema,
  title: z.string().trim().max(120).nullable().optional(),
  type: z.enum(["screening", "culture_fit", "technical", "onsite", "final"]),
  mode: z.enum(["video", "phone", "onsite"]),
  durationMins: z.number().int().min(5).max(480),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  meetingProvider: z
    .enum(["auto", "google_meet", "zoom", "teams", "jitsi", "external"])
    .default("auto"),
  timeZone: timeZoneSchema,
  slots: slotsSchema,
});
export type SchedulingRequestInput = z.input<typeof requestSchema>;
export type SchedulingActor =
  | { workspaceId: string; userId: string }
  | { workspaceId: string; candidateId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applicationContext(
  tx: Pick<typeof db, "select">,
  workspaceId: string,
  applicationId: string,
  candidateId?: string,
) {
  const [application] = await tx
    .select({
      id: applications.id,
      candidateId: applications.candidateId,
      timeZone: candidates.timezone,
      jobId: applications.jobId,
    })
    .from(applications)
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
        eq(applications.id, applicationId),
        eq(applications.workspaceId, workspaceId),
        candidateId ? eq(applications.candidateId, candidateId) : undefined,
      ),
    )
    .limit(1);
  if (!application) throw new Error("Application not found.");
  return application;
}

async function lockedRequest(
  tx: Tx,
  actor: SchedulingActor,
  requestId: string,
) {
  const [request] = await tx
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.id, requestId),
        eq(requests.workspaceId, actor.workspaceId),
      ),
    )
    .for("update");
  if (!request) throw new Error("Scheduling request not found.");
  const application = await applicationContext(
    tx,
    actor.workspaceId,
    request.applicationId,
    "candidateId" in actor ? actor.candidateId : undefined,
  );
  return { request, application };
}
function assertOpen(request: typeof requests.$inferSelect) {
  if (
    !["awaiting_candidate", "pending_review", "needs_rescheduling"].includes(
      request.status,
    )
  )
    throw new Error("This request is no longer open.");
  if (request.expiresAt <= new Date())
    throw new Error(
      "This request has expired. Ask the interview team for new times.",
    );
}

export async function createSchedulingRequest(
  actor: { workspaceId: string; userId: string },
  input: SchedulingRequestInput,
) {
  const values = requestSchema.parse(input);
  const proposed = parseSlots(values.slots, values.timeZone);
  return db.transaction(async (tx) => {
    const application = await applicationContext(
      tx,
      actor.workspaceId,
      values.applicationId,
    );
    let team = normalizeTeam(values.interviewerId, values.participants);
    let details = {
      interviewerId: values.interviewerId,
      title: values.title,
      type: values.type,
      mode: values.mode,
      durationMins: values.durationMins,
      location: values.location,
      notes: values.notes,
    };
    if (values.interviewId) {
      const [existing] = await tx
        .select()
        .from(interviews)
        .where(
          and(
            eq(interviews.id, values.interviewId),
            eq(interviews.workspaceId, actor.workspaceId),
            eq(interviews.applicationId, application.id),
            eq(interviews.status, "scheduled"),
          ),
        )
        .for("update");
      if (!existing)
        throw new Error("Scheduled interview not found for this application.");
      // Expired coordination must release the one-open-request constraint.
      const expired = await tx
        .update(requests)
        .set({ status: "expired" })
        .where(
          and(
            eq(requests.workspaceId, actor.workspaceId),
            eq(requests.interviewId, existing.id),
            inArray(requests.status, [
              "draft",
              "awaiting_candidate",
              "pending_review",
              "needs_rescheduling",
            ]),
            lte(requests.expiresAt, new Date()),
          ),
        )
        .returning({ id: requests.id });
      if (expired.length)
        await tx
          .update(slots)
          .set({ status: "expired" })
          .where(
            and(
              inArray(
                slots.requestId,
                expired.map((r) => r.id),
              ),
              inArray(slots.status, ["offered", "proposed"]),
            ),
          );
      details = {
        interviewerId: existing.interviewerId,
        title: existing.title,
        type: existing.type,
        mode: existing.mode,
        durationMins: existing.durationMins,
        location: existing.location,
        notes: existing.notes,
      };
      team = normalizeTeam(
        existing.interviewerId,
        await getInterviewTeam(existing.id, tx),
      );
    }
    await validateInterviewTeam(actor.workspaceId, team, tx);
    const [request] = await tx
      .insert(requests)
      .values({
        ...details,
        workspaceId: actor.workspaceId,
        applicationId: application.id,
        interviewId: values.interviewId,
        createdBy: actor.userId,
        meetingProvider: values.meetingProvider,
        timeZone: values.timeZone,
        status: values.interviewId
          ? "needs_rescheduling"
          : "awaiting_candidate",
        expiresAt: new Date(Math.max(...proposed.map((d) => d.getTime()))),
      })
      .returning();
    if (team.length)
      await tx
        .insert(interviewRequestParticipants)
        .values(team.map((p) => ({ ...p, requestId: request.id })));
    await tx.insert(slots).values(
      proposed.map((scheduledAt) => ({
        requestId: request.id,
        scheduledAt,
        timeZone: values.timeZone,
        proposedBy: "recruiter" as const,
        status: "offered" as const,
      })),
    );
    await tx.insert(candidatePortalNotifications).values({
      workspaceId: actor.workspaceId,
      candidateId: application.candidateId,
      type: "interview_scheduled",
      title: "Choose an interview time",
      body: "The interview team has offered times. Choose a time or propose alternatives in your application.",
      href: `/portal/applications/${application.id}`,
      metadata: { requestId: request.id },
    });
    return request.id;
  });
}

export async function proposeSchedulingSlots(
  actor: SchedulingActor,
  input: { requestId: string; slots: string[]; timeZone: string },
) {
  const proposed = parseSlots(input.slots, input.timeZone);
  const candidate = "candidateId" in actor;
  await db.transaction(async (tx) => {
    const { request, application } = await lockedRequest(
      tx,
      actor,
      input.requestId,
    );
    assertOpen(request);
    await tx
      .update(slots)
      .set({ status: "withdrawn" })
      .where(
        and(
          eq(slots.requestId, request.id),
          inArray(slots.status, ["offered", "proposed"]),
        ),
      );
    await tx.insert(slots).values(
      proposed.map((scheduledAt) => ({
        requestId: request.id,
        scheduledAt,
        timeZone: input.timeZone,
        proposedBy: candidate ? ("candidate" as const) : ("recruiter" as const),
        status: candidate ? ("proposed" as const) : ("offered" as const),
      })),
    );
    await tx
      .update(requests)
      .set({
        status: candidate
          ? "pending_review"
          : request.interviewId
            ? "needs_rescheduling"
            : "awaiting_candidate",
        expiresAt: new Date(Math.max(...proposed.map((d) => d.getTime()))),
      })
      .where(eq(requests.id, request.id));
    if (candidate)
      await tx
        .update(candidates)
        .set({ timezone: input.timeZone })
        .where(
          and(
            eq(candidates.id, application.candidateId),
            eq(candidates.workspaceId, actor.workspaceId),
          ),
        );
    else
      await tx.insert(candidatePortalNotifications).values({
        workspaceId: actor.workspaceId,
        candidateId: application.candidateId,
        type: "interview_scheduled",
        title: "Choose an interview time",
        body: "The interview team has offered new times.",
        href: `/portal/applications/${application.id}`,
      });
    await tx.insert(activityEvents).values({
      workspaceId: actor.workspaceId,
      actorId: "userId" in actor ? actor.userId : null,
      entityType: "application",
      entityId: application.id,
      type: "interview.times_proposed",
      metadata: {
        requestId: request.id,
        proposedBy: candidate ? "candidate" : "recruiter",
      },
    });
  });
}

export async function confirmSchedulingSlot(
  actor: SchedulingActor,
  requestId: string,
  slotId: string,
  timeZone?: string,
) {
  const result = await db.transaction(async (tx) => {
    const { request, application } = await lockedRequest(tx, actor, requestId);
    assertOpen(request);
    const [slot] = await tx
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.requestId, request.id)))
      .limit(1);
    if (!slot || slot.scheduledAt <= new Date())
      throw new Error("This time is no longer available.");
    if (timeZone) {
      timeZoneSchema.parse(timeZone);
      await tx
        .update(candidates)
        .set({ timezone: timeZone })
        .where(
          and(
            eq(candidates.id, application.candidateId),
            eq(candidates.workspaceId, actor.workspaceId),
          ),
        );
    }
    const candidate = "candidateId" in actor;
    if (
      candidate &&
      (slot.proposedBy !== "recruiter" ||
        slot.status !== "offered" ||
        request.status === "pending_review")
    )
      throw new Error(
        "Candidate-proposed times require approval by the interview team.",
      );
    if (!["offered", "proposed"].includes(slot.status))
      throw new Error("This time is no longer available.");
    const participants = await tx
      .select({
        userId: interviewRequestParticipants.userId,
        role: interviewRequestParticipants.role,
      })
      .from(interviewRequestParticipants)
      .where(eq(interviewRequestParticipants.requestId, request.id));
    const team = normalizeTeam(request.interviewerId, participants);
    await validateInterviewTeam(actor.workspaceId, team, tx);
    await lockAndCheckTeam(tx, {
      workspaceId: actor.workspaceId,
      userIds: team.map((p) => p.userId),
      when: slot.scheduledAt,
      durationMins: request.durationMins,
      excludeInterviewId: request.interviewId ?? undefined,
    });
    let previous;
    if (request.interviewId) {
      [previous] = await tx
        .select()
        .from(interviews)
        .where(
          and(
            eq(interviews.id, request.interviewId),
            eq(interviews.workspaceId, actor.workspaceId),
            eq(interviews.applicationId, application.id),
          ),
        )
        .for("update");
      if (!previous || previous.status !== "scheduled")
        throw new Error("The interview is no longer scheduled.");
    }
    const [interview] = previous
      ? await tx
          .update(interviews)
          .set({ scheduledAt: slot.scheduledAt })
          .where(eq(interviews.id, previous.id))
          .returning()
      : await tx
          .insert(interviews)
          .values({
            workspaceId: actor.workspaceId,
            applicationId: application.id,
            candidateId: application.candidateId,
            jobId: application.jobId,
            interviewerId: request.interviewerId,
            title: request.title,
            type: request.type,
            mode: request.mode,
            durationMins: request.durationMins,
            location: request.location,
            notes: request.notes,
            scheduledAt: slot.scheduledAt,
            meetLink: deriveMeetLink(request.mode, request.location),
          })
          .returning();
    if (!previous && team.length)
      await tx
        .insert(interviewParticipants)
        .values(team.map((p) => ({ ...p, interviewId: interview.id })));
    await tx
      .update(slots)
      .set({ status: "rejected" })
      .where(
        and(
          eq(slots.requestId, request.id),
          ne(slots.id, slot.id),
          inArray(slots.status, ["offered", "proposed"]),
        ),
      );
    await tx
      .update(slots)
      .set({ status: "accepted" })
      .where(eq(slots.id, slot.id));
    await tx
      .update(requests)
      .set({ status: "confirmed", interviewId: interview.id })
      .where(eq(requests.id, request.id));
    const providers = previous
      ? existingSyncProviders(previous)
      : await confirmedSyncProviders(
          actor.workspaceId,
          request.mode,
          request.meetingProvider as ApiMeetingProvider,
          Boolean(deriveMeetLink(request.mode, request.location)),
        );
    await persistSyncIntents(tx, interview, providers);
    const action = previous ? ("rescheduled" as const) : ("scheduled" as const);
    await tx.insert(candidatePortalNotifications).values({
      workspaceId: actor.workspaceId,
      ...interviewPortalNotification({
        action,
        interview,
        timeZone: timeZone ?? application.timeZone,
      }),
    });
    await tx.insert(activityEvents).values({
      workspaceId: actor.workspaceId,
      actorId: "userId" in actor ? actor.userId : null,
      entityType: "application",
      entityId: application.id,
      type: `interview.${action}`,
      metadata: {
        requestId: request.id,
        interviewId: interview.id,
        slotId: slot.id,
      },
    });
    const event = await persistDomainEvent(tx, {
      name: `interview.${action}`,
      workspaceId: actor.workspaceId,
      actorId: request.createdBy,
      aggregateType: "interview",
      aggregateId: interview.id,
      payload: { interview: serializeInterview(interview) },
    });
    return { interview, previous, request, action, event };
  });
  await publishPersistedDomainEvents([result.event]);
  await runApiInterviewSideEffects({
    workspaceId: actor.workspaceId,
    actorUserId: result.request.createdBy,
    interview: result.interview,
    previous: result.previous,
    action: result.action,
    meetingProvider: result.request.meetingProvider as ApiMeetingProvider,
  });
  return result.interview.id;
}

export async function cancelSchedulingRequest(
  actor: SchedulingActor,
  requestId: string,
) {
  await db.transaction(async (tx) => {
    const { request } = await lockedRequest(tx, actor, requestId);
    if (request.status === "confirmed")
      throw new Error("Cancel the confirmed interview instead.");
    await tx
      .update(requests)
      .set({ status: "cancelled" })
      .where(eq(requests.id, request.id));
    await tx
      .update(slots)
      .set({ status: "withdrawn" })
      .where(
        and(
          eq(slots.requestId, request.id),
          inArray(slots.status, ["offered", "proposed"]),
        ),
      );
  });
}
