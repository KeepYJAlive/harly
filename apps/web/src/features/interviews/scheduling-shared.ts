import { z } from "zod";
import { parseScheduledAt } from "./shared";

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone.");
export const participantSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["lead", "interviewer", "observer"]),
});
export type InterviewParticipant = z.infer<typeof participantSchema>;
export const teamSchema = z.array(participantSchema).max(30).default([]);
export function normalizeTeam(
  lead: string | null | undefined,
  participants: InterviewParticipant[],
) {
  const team = new Map(participants.map((p) => [p.userId, p]));
  if (participants.some((p) => p.role === "lead" && p.userId !== lead))
    throw new Error(
      "Choose the lead interviewer using the lead interviewer field.",
    );
  if (lead) team.set(lead, { userId: lead, role: "lead" });
  return [...team.values()];
}
export const slotsSchema = z
  .array(z.string().min(1))
  .min(1, "Offer at least one time.")
  .max(12);
export function parseSlots(values: string[], timeZone: string) {
  timeZoneSchema.parse(timeZone);
  const slots = slotsSchema
    .parse(values)
    .map((value) => parseScheduledAt(value, timeZone));
  if (
    slots.some(
      (d) => !Number.isFinite(d.getTime()) || d.getTime() <= Date.now(),
    )
  )
    throw new Error("All proposed times must be in the future.");
  if (new Set(slots.map((d) => d.toISOString())).size !== slots.length)
    throw new Error("Proposed times must be distinct.");
  return slots;
}
export function formatSlot(value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
export const schedulingLabels = {
  draft: "Draft",
  awaiting_candidate: "Awaiting Candidate",
  pending_review: "Pending Review",
  confirmed: "Interview confirmed",
  needs_rescheduling: "Needs Rescheduling",
  expired: "Expired",
  cancelled: "Interview cancelled",
};
