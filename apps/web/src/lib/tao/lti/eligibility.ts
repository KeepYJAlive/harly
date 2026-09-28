export type LaunchableAssignmentStatus =
  | "assigned"
  | "started"
  | "completed"
  | "expired"
  | "cancelled"
  | "error";

export function assignmentLaunchBlockReason(input: {
  status: LaunchableAssignmentStatus;
  activeDefinition: boolean;
  expiresAt: Date | null;
  now: Date;
}): "expired" | "unavailable" | null {
  if (input.expiresAt && input.expiresAt <= input.now) return "expired";
  if (!input.activeDefinition) return "unavailable";
  if (input.status !== "assigned" && input.status !== "started") {
    return "unavailable";
  }
  return null;
}
