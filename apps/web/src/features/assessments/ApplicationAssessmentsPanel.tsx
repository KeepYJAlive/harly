"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ClipboardCheck,
  Copy,
  Link2,
  Loader2,
  Plus,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/notification-island/toast";
import {
  assignAssessmentAction,
  cancelAssessmentAssignmentAction,
  regenerateAssessmentLinkAction,
} from "./assignment-actions";
import type {
  AssessmentAssignmentItem,
  TaoAssessmentDefinitionItem,
} from "./types";

type ApplicationOption = { id: string; jobTitle: string };

const STATUS_LABEL: Record<AssessmentAssignmentItem["status"], string> = {
  assigned: "Waiting for candidate",
  started: "In progress",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
  error: "Launch error",
};

function sevenDaysFromNow() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  return date.toISOString().slice(0, 10);
}

export function ApplicationAssessmentsPanel({
  applications,
  definitions,
  assignments,
  canManage,
}: {
  applications: ApplicationOption[];
  definitions: TaoAssessmentDefinitionItem[];
  assignments: AssessmentAssignmentItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? "");
  const [expiration, setExpiration] = useState(sevenDaysFromNow);
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeDefinitions = useMemo(
    () => definitions.filter((definition) => definition.active),
    [definitions],
  );

  function openAssign() {
    setApplicationId(applications[0]?.id ?? "");
    setDefinitionId(activeDefinitions[0]?.id ?? "");
    setExpiration(sevenDaysFromNow());
    setCandidateUrl(null);
    setDialogOpen(true);
  }

  function assign() {
    const expiresAt = new Date(`${expiration}T23:59:59.999`).toISOString();
    startTransition(async () => {
      const result = await assignAssessmentAction({
        applicationId,
        assessmentDefinitionId: definitionId,
        expiresAt,
      });
      if (!result.ok || !result.candidateUrl) {
        toast.error(result.error ?? "Could not assign assessment.");
        return;
      }
      setCandidateUrl(result.candidateUrl);
      toast.success("Assessment assigned");
      router.refresh();
    });
  }

  function cancel(id: string) {
    startTransition(async () => {
      const result = await cancelAssessmentAssignmentAction(id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not cancel assessment.");
        return;
      }
      toast.success("Assessment cancelled");
      router.refresh();
    });
  }

  function regenerate(id: string) {
    startTransition(async () => {
      const result = await regenerateAssessmentLinkAction(id);
      if (!result.ok || !result.candidateUrl) {
        toast.error(result.error ?? "Could not regenerate assessment link.");
        return;
      }
      setCandidateUrl(result.candidateUrl);
      setDialogOpen(true);
      toast.success("Previous link invalidated");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold">Assessments</h3>
          <p className="text-sm text-muted-foreground">
            Assign an assessment to a specific job application.
          </p>
        </div>
        <Button
          size="sm"
          onClick={openAssign}
          disabled={
            !canManage ||
            applications.length === 0 ||
            activeDefinitions.length === 0
          }
        >
          <Plus className="size-4" /> Assign assessment
        </Button>
      </div>

      {assignments.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <ClipboardCheck className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No assessments assigned</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Active TAO assessments configured by an administrator appear in the
            assignment dialog.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map((assignment) => {
            const mutable =
              assignment.status === "assigned" ||
              assignment.status === "started";
            return (
              <Card key={assignment.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{assignment.assessmentName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {assignment.jobTitle}
                    </p>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="inline text-muted-foreground">
                          Status:{" "}
                        </dt>
                        <dd className="inline font-medium">
                          {STATUS_LABEL[assignment.status]}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-muted-foreground">
                          Assigned:{" "}
                        </dt>
                        <dd className="inline">
                          {new Date(assignment.assignedAt).toLocaleDateString()}
                        </dd>
                      </div>
                      {assignment.startedAt ? (
                        <div>
                          <dt className="inline text-muted-foreground">
                            Started:{" "}
                          </dt>
                          <dd className="inline">
                            {new Date(assignment.startedAt).toLocaleString()}
                          </dd>
                        </div>
                      ) : null}
                      {assignment.expiresAt ? (
                        <div>
                          <dt className="inline text-muted-foreground">
                            Expires:{" "}
                          </dt>
                          <dd className="inline">
                            {new Date(
                              assignment.expiresAt,
                            ).toLocaleDateString()}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {assignment.status === "completed" &&
                    assignment.score === null ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Score: pending result synchronization
                      </p>
                    ) : null}
                  </div>
                  {mutable ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => regenerate(assignment.id)}
                        disabled={!canManage || pending}
                      >
                        <Link2 className="size-3.5" /> Regenerate link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => cancel(assignment.id)}
                        disabled={!canManage || pending}
                      >
                        <XCircle className="size-3.5" /> Cancel
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {candidateUrl ? "Candidate assessment link" : "Assign assessment"}
            </DialogTitle>
          </DialogHeader>
          {candidateUrl ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Copy this link now. Harly stores only its cryptographic hash, so
                it cannot display the same link later. Regenerating invalidates
                the previous link.
              </p>
              <div className="flex gap-2">
                <Input
                  value={candidateUrl}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(candidateUrl);
                    toast.success("Assessment link copied");
                  }}
                >
                  <Copy className="size-4" /> Copy
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {applications.length > 1 ? (
                <FormField label="Application">
                  <Select
                    value={applicationId}
                    onValueChange={setApplicationId}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {applications.map((application) => (
                        <SelectItem key={application.id} value={application.id}>
                          {application.jobTitle}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ) : null}
              <FormField label="Assessment">
                <Select value={definitionId} onValueChange={setDefinitionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an assessment" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeDefinitions.map((definition) => (
                      <SelectItem key={definition.id} value={definition.id}>
                        {definition.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Expiration">
                <Input
                  type="date"
                  value={expiration}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setExpiration(event.target.value)}
                />
              </FormField>
            </div>
          )}
          <DialogFooter>
            {candidateUrl ? (
              <Button onClick={() => setDialogOpen(false)}>Done</Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={assign}
                  disabled={
                    pending || !applicationId || !definitionId || !expiration
                  }
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
                  Assign
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
