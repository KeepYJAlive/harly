"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/notification-island/toast";
import {
  formatSlot,
  schedulingLabels,
  timeZoneSchema,
} from "./scheduling-shared";
import type { SchedulingRequestItem } from "./scheduling-data";
import { SlotFields, useBrowserTimeZone } from "./CoordinationFields";
import {
  approveSchedulingSlotAction,
  cancelSchedulingRequestAction,
  offerSchedulingSlotsAction,
  proposePortalSchedulingSlotsAction,
  selectPortalSchedulingSlotAction,
} from "./scheduling-actions";

export function SchedulingRequests({
  requests,
  portal = false,
}: {
  requests: SchedulingRequestItem[];
  portal?: boolean;
}) {
  return (
    <section className="space-y-3" aria-label="Interview coordination">
      {requests.length > 0 && (
        <h2 className="text-lg font-semibold">Interview coordination</h2>
      )}
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} portal={portal} />
      ))}
    </section>
  );
}
function RequestCard({
  request,
  portal,
}: {
  request: SchedulingRequestItem;
  portal: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState([""]);
  const browserTimeZone = useBrowserTimeZone();
  const [selectedTimeZone, setTimeZone] = useState<string | null>(null);
  const timeZone =
    selectedTimeZone ??
    (portal ? request.candidateTimeZone || browserTimeZone : browserTimeZone);
  const displayTimeZone = timeZoneSchema.safeParse(timeZone).success
    ? timeZone
    : browserTimeZone;
  const open = [
    "awaiting_candidate",
    "pending_review",
    "needs_rescheduling",
  ].includes(request.status);
  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.success)
        toast.error(result.error ?? "Could not update request.");
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }
  return (
    <article className="space-y-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-medium">
          {request.title || request.type.replaceAll("_", " ")} ·{" "}
          {request.jobTitle}
        </h3>
        <span className="text-sm">{schedulingLabels[request.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {!portal && `${request.candidateName} · `}
        {request.durationMins} min · {request.mode} · {request.department} ·{" "}
        {timeZone}
      </p>
      {open && (
        <>
          <p className="text-sm">
            {request.status === "pending_review"
              ? portal
                ? "Times proposed — awaiting review. Your proposed times are requests and are not confirmed until approved by the interview team."
                : "Candidate proposed alternative interview times. Approve a time or offer different times."
              : "Choose an interview time. These options are tentative until selected."}
          </p>
          <div className="space-y-2">
            {request.slots
              .filter((s) => ["offered", "proposed"].includes(s.status))
              .map((slot) => (
                <div
                  key={slot.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {formatSlot(slot.scheduledAt, displayTimeZone)} ·{" "}
                    {slot.proposedBy === "candidate"
                      ? "Candidate proposal"
                      : "Offered"}
                  </span>
                  {(!portal || slot.status === "offered") && (
                    <Button
                      disabled={pending}
                      variant="outline"
                      onClick={() =>
                        run(() =>
                          portal
                            ? selectPortalSchedulingSlotAction({
                                requestId: request.id,
                                slotId: slot.id,
                                timeZone,
                              })
                            : approveSchedulingSlotAction({
                                requestId: request.id,
                                slotId: slot.id,
                              }),
                        )
                      }
                    >
                      {portal ? "Select this time" : "Approve selected time"}
                    </Button>
                  )}
                </div>
              ))}
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setEditing(!editing)}
          >
            {portal
              ? "None of these work — propose alternatives"
              : "Offer different times"}
          </Button>
          {!portal && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                run(() => cancelSchedulingRequestAction(request.id))
              }
            >
              Cancel coordination
            </Button>
          )}
          {editing && (
            <div className="space-y-3">
              <SlotFields
                values={values}
                onChange={setValues}
                timeZone={timeZone}
                onTimeZoneChange={setTimeZone}
              />
              <Button
                disabled={pending}
                onClick={() =>
                  run(() =>
                    portal
                      ? proposePortalSchedulingSlotsAction({
                          requestId: request.id,
                          slots: values,
                          timeZone,
                        })
                      : offerSchedulingSlotsAction({
                          requestId: request.id,
                          slots: values,
                          timeZone,
                        }),
                  )
                }
              >
                {portal ? "Submit times for review" : "Send new options"}
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
