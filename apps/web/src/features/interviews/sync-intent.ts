import "server-only";
import { and, eq } from "drizzle-orm";
import { db, interviewSyncs, type Interview } from "@harly/db";
import { getWorkspaceGCalConfig } from "@/lib/gcal/config";
import { getWorkspaceOutlookConfig } from "@/lib/outlook/config";
import { getWorkspaceJitsiConfig } from "@/lib/jitsi/config";
import { getZoomToken } from "@/lib/zoom/config";
import type { ApiMeetingProvider } from "./api-side-effects";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function confirmedSyncProviders(
  workspaceId: string,
  mode: string,
  provider: ApiMeetingProvider,
  externalLink: boolean,
) {
  const [google, zoom, teams, jitsi] = await Promise.all([
    getWorkspaceGCalConfig(workspaceId),
    getZoomToken(workspaceId),
    getWorkspaceOutlookConfig(workspaceId),
    getWorkspaceJitsiConfig(workspaceId),
  ]);
  const providers: (typeof interviewSyncs.$inferInsert.provider)[] = google
    ? ["google_calendar"]
    : [];
  if (mode === "video" && !externalLink && provider !== "external") {
    const selected =
      provider === "auto"
        ? zoom
          ? "zoom"
          : teams
            ? "teams"
            : google
              ? "google_meet"
              : jitsi
                ? "jitsi"
                : null
        : provider;
    if (selected === "zoom") providers.push("zoom");
    if (selected === "teams") providers.push("microsoft_teams");
    if (selected === "jitsi") providers.push("jitsi");
    if (selected === "google_meet" && !google)
      providers.push("google_calendar");
  }
  return providers;
}
export async function persistSyncIntents(
  tx: Tx,
  interview: Interview,
  providers: (typeof interviewSyncs.$inferInsert.provider)[],
  cancel = false,
) {
  if (cancel) {
    // Include failed/ambiguous creates even when the provider ID was never persisted.
    await tx
      .update(interviewSyncs)
      .set({
        operation: "cancel",
        status: "pending",
        nextRetryAt: new Date(Date.now() + 60_000),
      })
      .where(
        and(
          eq(interviewSyncs.workspaceId, interview.workspaceId),
          eq(interviewSyncs.interviewId, interview.id),
        ),
      );
  }
  for (const provider of new Set(providers)) {
    await tx
      .insert(interviewSyncs)
      .values({
        workspaceId: interview.workspaceId,
        interviewId: interview.id,
        provider,
        operation: cancel ? "cancel" : "upsert",
        status: "pending",
        nextRetryAt: new Date(Date.now() + 60_000),
      })
      .onConflictDoUpdate({
        target: [interviewSyncs.interviewId, interviewSyncs.provider],
        set: {
          operation: cancel ? "cancel" : "upsert",
          status: "pending",
          nextRetryAt: new Date(Date.now() + 60_000),
        },
      });
  }
}
export function existingSyncProviders(interview: Interview) {
  const providers: (typeof interviewSyncs.$inferInsert.provider)[] = [];
  if (interview.gcalEventId) providers.push("google_calendar");
  if (interview.zoomMeetingId) providers.push("zoom");
  if (interview.teamsMeetingId) providers.push("microsoft_teams");
  if (interview.jitsiRoom) providers.push("jitsi");
  return providers;
}
