import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  applications,
  candidates,
  db,
  interviews,
  interviewParticipants,
  interviewSchedulingRequests as requests,
  interviewSchedulingSlots as slots,
  interviewSyncs,
  jobs,
  jobStages,
  member,
  organization,
  user,
} from "@harly/db";

const effects = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./api-side-effects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api-side-effects")>()),
  runApiInterviewSideEffects: effects.run,
}));
vi.mock("@/server/events/emit", () => ({
  persistDomainEvent: vi.fn(async () => ({ eventId: "event" })),
  publishPersistedDomainEvents: vi.fn(async () => undefined),
}));
vi.mock("@/server/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));
vi.mock("@/lib/gcal/config", () => ({
  getWorkspaceGCalConfig: vi.fn(async () => ({
    calendarId: "workspace-calendar",
  })),
}));
vi.mock("@/lib/zoom/config", () => ({ getZoomToken: vi.fn(async () => null) }));
vi.mock("@/lib/outlook/config", () => ({
  getWorkspaceOutlookConfig: vi.fn(async () => null),
}));
vi.mock("@/lib/jitsi/config", () => ({
  getWorkspaceJitsiConfig: vi.fn(async () => null),
}));

import {
  confirmSchedulingSlot,
  createSchedulingRequest,
  proposeSchedulingSlots,
} from "./scheduling-service";
import { createInterviewForApi, setInterviewStatusForApi } from "./service";
import { participantEmails } from "./participants";
import { formatSlot, parseSlots } from "./scheduling-shared";

// Opt-in: use an isolated database after applying the normal migration chain.
// HARLY_SCHEDULING_INTEGRATION=1 DATABASE_URL=... pnpm --filter web test scheduling.integration
const suite =
  process.env.HARLY_SCHEDULING_INTEGRATION === "1" ? describe : describe.skip;
suite("interview scheduling transactions", () => {
  let workspaceId: string,
    foreignWorkspaceId: string,
    lead: string,
    observer: string,
    candidateId: string,
    otherCandidate: string,
    applicationId: string;
  const first = "2099-06-01T15:00",
    second = "2099-06-02T15:00";
  beforeEach(async () => {
    vi.clearAllMocks();
    workspaceId = randomUUID();
    foreignWorkspaceId = randomUUID();
    lead = randomUUID();
    observer = randomUUID();
    await db.insert(organization).values(
      [workspaceId, foreignWorkspaceId].map((id) => ({
        id,
        name: "Scheduling test",
        slug: id,
        createdAt: new Date(),
      })),
    );
    await db.insert(user).values(
      [lead, observer].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
      })),
    );
    await db.insert(member).values(
      [lead, observer].map((userId) => ({
        id: randomUUID(),
        organizationId: workspaceId,
        userId,
        role: "admin",
        createdAt: new Date(),
      })),
    );
    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        title: "Engineer",
        slug: randomUUID(),
        description: "Test",
        employmentType: "full_time",
        workplaceType: "remote",
        createdById: lead,
      })
      .returning();
    const [stage] = await db
      .insert(jobStages)
      .values({ workspaceId, jobId: job.id, name: "Interview", order: 0 })
      .returning();
    const people = await db
      .insert(candidates)
      .values(
        ["Jane", "Other"].map((firstName) => ({
          workspaceId,
          firstName,
          lastName: "Test",
          email: `${randomUUID()}@example.test`,
          timezone: "America/New_York",
        })),
      )
      .returning();
    candidateId = people[0].id;
    otherCandidate = people[1].id;
    const [application] = await db
      .insert(applications)
      .values({
        workspaceId,
        candidateId,
        jobId: job.id,
        currentStageId: stage.id,
      })
      .returning();
    applicationId = application.id;
  });
  afterEach(async () => {
    await db
      .delete(organization)
      .where(inArray(organization.id, [workspaceId, foreignWorkspaceId]));
    await db.delete(user).where(inArray(user.id, [lead, observer]));
  });
  const input = () => ({
    applicationId,
    interviewerId: lead,
    participants: [{ userId: observer, role: "observer" as const }],
    type: "technical" as const,
    mode: "video" as const,
    durationMins: 45,
    timeZone: "America/Los_Angeles",
    slots: [first, second],
  });
  const recruiter = () => ({ workspaceId, userId: lead });
  const candidate = () => ({ workspaceId, candidateId });
  async function offered(requestId: string) {
    return db
      .select()
      .from(slots)
      .where(and(eq(slots.requestId, requestId), eq(slots.status, "offered")));
  }

  it("manual API scheduling remains compatible with legacy single-interviewer interviews", async () => {
    const interview = await createInterviewForApi({
      workspaceId,
      actorUserId: lead,
      values: {
        applicationId,
        candidateId,
        interviewerId: lead,
        type: "technical",
        mode: "phone",
        scheduledAt: new Date("2099-06-01T22:00Z"),
        durationMins: 45,
      },
    });
    expect(interview.interviewerId).toBe(lead);
    expect(
      await db
        .select()
        .from(requests)
        .where(eq(requests.workspaceId, workspaceId)),
    ).toHaveLength(0);
    expect(effects.run).toHaveBeenCalledWith(
      expect.objectContaining({ action: "scheduled" }),
    );
  });

  it("creates multiple tentative slots without meetings or calendar work", async () => {
    const id = await createSchedulingRequest(recruiter(), input());
    const choices = await offered(id);
    expect(choices).toHaveLength(2);
    expect(choices[0].scheduledAt.toISOString()).toBe(
      "2099-06-01T22:00:00.000Z",
    );
    expect(formatSlot(choices[0].scheduledAt, "America/New_York")).toContain(
      "6:00",
    );
    expect(
      await db
        .select()
        .from(interviews)
        .where(eq(interviews.workspaceId, workspaceId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(interviewSyncs)
        .where(eq(interviewSyncs.workspaceId, workspaceId)),
    ).toHaveLength(0);
    expect(effects.run).not.toHaveBeenCalled();
  });

  it("candidate selection confirms a normal interview, team and durable calendar intent", async () => {
    const id = await createSchedulingRequest(recruiter(), input());
    const [slot] = await offered(id);
    const interviewId = await confirmSchedulingSlot(candidate(), id, slot.id);
    const [interview] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, interviewId));
    expect(interview.scheduledAt).toEqual(slot.scheduledAt);
    expect(
      await db
        .select()
        .from(interviewParticipants)
        .where(eq(interviewParticipants.interviewId, interviewId)),
    ).toHaveLength(2);
    expect(await participantEmails(interviewId)).toEqual(
      expect.arrayContaining([
        `${lead}@example.test`,
        `${observer}@example.test`,
      ]),
    );
    expect(
      await db
        .select()
        .from(interviewSyncs)
        .where(eq(interviewSyncs.interviewId, interviewId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "google_calendar",
          operation: "upsert",
        }),
      ]),
    );
    expect(effects.run).toHaveBeenCalledOnce();
  });

  it("candidate alternatives require approval and cannot self-confirm", async () => {
    const id = await createSchedulingRequest(recruiter(), input());
    await proposeSchedulingSlots(candidate(), {
      requestId: id,
      slots: ["2099-06-03T18:00"],
      timeZone: "America/New_York",
    });
    const [request] = await db
      .select()
      .from(requests)
      .where(eq(requests.id, id));
    const [proposal] = await db
      .select()
      .from(slots)
      .where(and(eq(slots.requestId, id), eq(slots.status, "proposed")));
    expect(request.status).toBe("pending_review");
    expect(proposal.scheduledAt.toISOString()).toBe("2099-06-03T22:00:00.000Z");
    expect(effects.run).not.toHaveBeenCalled();
    await expect(
      confirmSchedulingSlot(candidate(), id, proposal.id),
    ).rejects.toThrow(/approval/);
    await confirmSchedulingSlot(recruiter(), id, proposal.id);
    expect(effects.run).toHaveBeenCalledOnce();
  });

  it("serializes racing confirmations so only one slot and interview wins", async () => {
    const id = await createSchedulingRequest(recruiter(), input());
    const choices = await offered(id);
    const results = await Promise.allSettled(
      choices.map((s) => confirmSchedulingSlot(candidate(), id, s.id)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db
        .select()
        .from(slots)
        .where(and(eq(slots.requestId, id), eq(slots.status, "accepted"))),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(interviews)
        .where(eq(interviews.workspaceId, workspaceId)),
    ).toHaveLength(1);
  });

  it("serializes overlapping teams even when their lead and participant order is reversed", async () => {
    const one = await createSchedulingRequest(recruiter(), input());
    const two = await createSchedulingRequest(recruiter(), {
      ...input(),
      interviewerId: observer,
      participants: [{ userId: lead, role: "interviewer" }],
    });
    const [slotOne] = await offered(one);
    const [slotTwo] = await offered(two);
    const results = await Promise.allSettled([
      confirmSchedulingSlot(candidate(), one, slotOne.id),
      confirmSchedulingSlot(candidate(), two, slotTwo.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(interviews)
        .where(eq(interviews.workspaceId, workspaceId)),
    ).toHaveLength(1);
  });

  it("rejects another candidate, workspace, application, participant and foreign slot", async () => {
    const id = await createSchedulingRequest(recruiter(), input());
    const [slot] = await offered(id);
    await expect(
      confirmSchedulingSlot(
        { workspaceId, candidateId: otherCandidate },
        id,
        slot.id,
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      confirmSchedulingSlot(
        { workspaceId: foreignWorkspaceId, userId: lead },
        id,
        slot.id,
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      createSchedulingRequest(
        { workspaceId: foreignWorkspaceId, userId: lead },
        input(),
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      createSchedulingRequest(recruiter(), {
        ...input(),
        participants: [{ userId: randomUUID(), role: "observer" }],
      }),
    ).rejects.toThrow(/belong/);
    const other = await createSchedulingRequest(recruiter(), input());
    const [otherSlot] = await offered(other);
    await expect(
      confirmSchedulingSlot(candidate(), id, otherSlot.id),
    ).rejects.toThrow(/no longer available/);
    expect(effects.run).not.toHaveBeenCalled();
  });

  it("rescheduling keeps the old reservation until confirmation and updates the same interview", async () => {
    const id = await createSchedulingRequest(recruiter(), input());
    const [slot] = await offered(id);
    const interviewId = await confirmSchedulingSlot(candidate(), id, slot.id);
    await db
      .update(interviews)
      .set({
        meetLink: "https://example.test/current",
        zoomMeetingId: "existing-zoom",
      })
      .where(eq(interviews.id, interviewId));
    const replacement = await createSchedulingRequest(recruiter(), {
      ...input(),
      interviewId,
      slots: ["2099-06-04T15:00"],
    });
    const [before] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, interviewId));
    expect(before.scheduledAt).toEqual(slot.scheduledAt);
    expect(before.meetLink).toBe("https://example.test/current");
    const [newSlot] = await offered(replacement);
    expect(
      await confirmSchedulingSlot(candidate(), replacement, newSlot.id),
    ).toBe(interviewId);
    expect(
      await db
        .select()
        .from(interviews)
        .where(eq(interviews.workspaceId, workspaceId)),
    ).toHaveLength(1);
    expect(effects.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "rescheduled",
        previous: expect.objectContaining({ id: interviewId }),
      }),
    );
    // A second rescheduling cycle must get a fresh request ID.
    expect(
      await createSchedulingRequest(recruiter(), {
        ...input(),
        interviewId,
        slots: ["2099-06-05T15:00"],
      }),
    ).not.toBe(replacement);
  });

  it("expired coordination does not block offering new replacement times", async () => {
    const original = await createSchedulingRequest(recruiter(), input());
    const [slot] = await offered(original);
    const interviewId = await confirmSchedulingSlot(
      candidate(),
      original,
      slot.id,
    );
    const expired = await createSchedulingRequest(recruiter(), {
      ...input(),
      interviewId,
    });
    await db
      .update(requests)
      .set({ expiresAt: new Date("2000-01-01") })
      .where(eq(requests.id, expired));
    const replacement = await createSchedulingRequest(recruiter(), {
      ...input(),
      interviewId,
      slots: ["2099-06-05T15:00"],
    });
    expect(replacement).not.toBe(expired);
    expect(
      (await db.select().from(requests).where(eq(requests.id, expired)))[0]
        .status,
    ).toBe("expired");
    expect(
      (
        await db.select().from(interviews).where(eq(interviews.id, interviewId))
      )[0].scheduledAt,
    ).toEqual(slot.scheduledAt);
  });

  it("cancellation detaches the link and persists provider cleanup intents", async () => {
    const id = await createSchedulingRequest(recruiter(), input());
    const [slot] = await offered(id);
    const interviewId = await confirmSchedulingSlot(candidate(), id, slot.id);
    await db
      .update(interviews)
      .set({
        meetLink: "https://example.test/old",
        zoomMeetingId: "zoom-id",
        gcalEventId: "calendar-id",
      })
      .where(eq(interviews.id, interviewId));
    const canceled = await setInterviewStatusForApi({
      workspaceId,
      actorUserId: lead,
      interviewId,
      status: "canceled",
    });
    expect(canceled.meetLink).toBeNull();
    const intents = await db
      .select()
      .from(interviewSyncs)
      .where(eq(interviewSyncs.interviewId, interviewId));
    expect(intents).toHaveLength(2);
    expect(intents.every((s) => s.operation === "cancel")).toBe(true);
    expect(effects.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "canceled" }),
    );
    expect(
      (await db.select().from(requests).where(eq(requests.id, id)))[0].status,
    ).toBe("cancelled");
  });

  it("additional participants conflict with legacy lead-only reservations", async () => {
    await createInterviewForApi({
      workspaceId,
      actorUserId: lead,
      values: {
        applicationId,
        candidateId,
        interviewerId: observer,
        type: "screening",
        mode: "phone",
        scheduledAt: parseSlots([first], "America/Los_Angeles")[0],
        durationMins: 45,
      },
    });
    const id = await createSchedulingRequest(recruiter(), input());
    const [slot] = await offered(id);
    await expect(
      confirmSchedulingSlot(candidate(), id, slot.id),
    ).rejects.toThrow(/overlapping/);
    expect(
      (await db.select().from(requests).where(eq(requests.id, id)))[0].status,
    ).toBe("awaiting_candidate");
  });
});
