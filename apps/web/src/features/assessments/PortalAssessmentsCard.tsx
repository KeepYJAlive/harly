import Link from "next/link";
import type { Route } from "next";
import { ClipboardCheck, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatShort } from "@/lib/date";

type PortalAssignment = {
  id: string;
  assessmentName: string;
  description: string | null;
  definitionActive: boolean;
  status:
    | "assigned"
    | "started"
    | "completed"
    | "expired"
    | "cancelled"
    | "error";
  assignedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
};

const STATUS_LABEL: Record<PortalAssignment["status"], string> = {
  assigned: "Ready to start",
  started: "In progress",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
  error: "Temporarily unavailable",
};

export function PortalAssessmentsCard({
  assignments,
}: {
  assignments: PortalAssignment[];
}) {
  if (assignments.length === 0) return null;
  const now = new Date();

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        Assessments
      </h2>
      <div className="space-y-3">
        {assignments.map((assignment) => {
          const launchable =
            assignment.definitionActive &&
            (assignment.status === "assigned" ||
              assignment.status === "started") &&
            (!assignment.expiresAt || assignment.expiresAt > now);
          return (
            <Card key={assignment.id} className="p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ClipboardCheck className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{assignment.assessmentName}</p>
                    {assignment.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {assignment.description}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {STATUS_LABEL[assignment.status]}
                      </span>
                      <span>Assigned {formatShort(assignment.assignedAt)}</span>
                      {assignment.expiresAt ? (
                        <span>Expires {formatShort(assignment.expiresAt)}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                {launchable ? (
                  <Button asChild className="shrink-0">
                    <Link
                      href={
                        `/portal/assessments/${assignment.id}/start` as Route
                      }
                    >
                      <ExternalLink className="size-4" />
                      {assignment.status === "started"
                        ? "Continue assessment"
                        : "Start assessment"}
                    </Link>
                  </Button>
                ) : null}
              </div>
              {assignment.status === "completed" ? (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                  Results will appear after the organization synchronizes them.
                </p>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
