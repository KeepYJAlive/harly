"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, interviews, interviewSchedulingRequests } from "@harly/db";
import { getWorkspaceContext } from "@/features/workspaces/context";
import { requireApplicationPermission } from "@/features/workspaces/permissions-server";
import {
  isPortalEnabled,
  PORTAL_SESSION_COOKIE,
  resolvePortalSession,
} from "@/lib/portal-auth";
import {
  cancelSchedulingRequest,
  confirmSchedulingSlot,
  createSchedulingRequest,
  proposeSchedulingSlots,
  type SchedulingRequestInput,
} from "./scheduling-service";

async function recruiter(requestId?: string, applicationId?: string) {
  const { organization, user } = await getWorkspaceContext();
  if (requestId) {
    const [request] = await db
      .select({ applicationId: interviewSchedulingRequests.applicationId })
      .from(interviewSchedulingRequests)
      .where(
        and(
          eq(interviewSchedulingRequests.id, requestId),
          eq(interviewSchedulingRequests.workspaceId, organization.id),
        ),
      )
      .limit(1);
    if (!request) throw new Error("Scheduling request not found.");
    applicationId = request.applicationId;
  }
  if (!applicationId) throw new Error("Application is required.");
  await requireApplicationPermission("interviews:manage", applicationId);
  return { workspaceId: organization.id, userId: user.id };
}
async function candidate() {
  const token = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = token ? await resolvePortalSession(token) : null;
  if (!session || !(await isPortalEnabled(session.workspaceId)))
    throw new Error("Your candidate session has expired.");
  return { workspaceId: session.workspaceId, candidateId: session.candidateId };
}
async function perform(run: () => Promise<unknown>) {
  try {
    await run();
    revalidatePath("/dashboard/calendars");
    revalidatePath("/dashboard/candidates", "layout");
    revalidatePath("/portal", "layout");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error:
        e instanceof Error ? e.message : "Could not update scheduling request.",
    };
  }
}
export async function createSchedulingRequestAction(
  input: SchedulingRequestInput,
) {
  return perform(async () =>
    createSchedulingRequest(
      await recruiter(undefined, input.applicationId),
      input,
    ),
  );
}
export async function offerSchedulingSlotsAction(input: {
  requestId: string;
  slots: string[];
  timeZone: string;
}) {
  return perform(async () =>
    proposeSchedulingSlots(await recruiter(input.requestId), input),
  );
}
export async function approveSchedulingSlotAction(input: {
  requestId: string;
  slotId: string;
}) {
  return perform(async () =>
    confirmSchedulingSlot(
      await recruiter(input.requestId),
      input.requestId,
      input.slotId,
    ),
  );
}
export async function cancelSchedulingRequestAction(requestId: string) {
  return perform(async () =>
    cancelSchedulingRequest(await recruiter(requestId), requestId),
  );
}
export async function selectPortalSchedulingSlotAction(input: {
  requestId: string;
  slotId: string;
  timeZone?: string;
}) {
  return perform(async () =>
    confirmSchedulingSlot(
      await candidate(),
      input.requestId,
      input.slotId,
      input.timeZone,
    ),
  );
}
export async function proposePortalSchedulingSlotsAction(input: {
  requestId: string;
  slots: string[];
  timeZone: string;
}) {
  return perform(async () => proposeSchedulingSlots(await candidate(), input));
}

export async function coordinateRescheduleAction(input: {
  interviewId: string;
  slots: string[];
  timeZone: string;
}) {
  return perform(async () => {
    const { organization } = await getWorkspaceContext();
    const [interview] = await db
      .select()
      .from(interviews)
      .where(
        and(
          eq(interviews.id, input.interviewId),
          eq(interviews.workspaceId, organization.id),
        ),
      )
      .limit(1);
    if (!interview) throw new Error("Interview not found.");
    const actor = await recruiter(undefined, interview.applicationId);
    await createSchedulingRequest(actor, {
      ...interview,
      interviewId: interview.id,
      slots: input.slots,
      timeZone: input.timeZone,
      meetingProvider: interview.zoomMeetingId
        ? "zoom"
        : interview.teamsMeetingId
          ? "teams"
          : interview.jitsiRoom
            ? "jitsi"
            : interview.gcalEventId
              ? "google_meet"
              : "auto",
    });
  });
}
