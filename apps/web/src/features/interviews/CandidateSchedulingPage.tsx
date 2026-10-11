"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvailabilityCalendar } from "./AvailabilityCalendar";
import { SlotFields, useBrowserTimeZone } from "./CoordinationFields";
import { localCalendarParts } from "./availability-calendar";
import {
  formatSlot,
  schedulingLabels,
  timeZoneSchema,
} from "./scheduling-shared";
import {
  proposePortalSchedulingSlotsAction,
  selectPortalSchedulingSlotAction,
} from "./scheduling-actions";
import type { SchedulingRequestItem } from "./scheduling-data";

export function CandidateSchedulingPage({
  request,
}: {
  request: SchedulingRequestItem;
}) {
  const router = useRouter();
  const browserZone = useBrowserTimeZone();
  const [zone, setZone] = useState<string | null>(null);
  const timeZone = zone ?? request.candidateTimeZone ?? browserZone;
  const validZone = timeZoneSchema.safeParse(timeZone).success;
  const [selectedId, setSelectedId] = useState<string>();
  const [alternatives, setAlternatives] = useState(false);
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const open = [
    "awaiting_candidate",
    "needs_rescheduling",
    "pending_review",
  ].includes(request.status);
  const choices = request.slots.filter(
    (s) => s.status === "offered" && s.proposedBy === "recruiter",
  );
  const selected = choices.find((s) => s.id === selectedId);
  const accepted = request.slots.find((s) => s.status === "accepted");
  function submit(propose: boolean) {
    startTransition(async () => {
      const result = propose
        ? await proposePortalSchedulingSlotsAction({
            requestId: request.id,
            timeZone,
            slots: values,
          })
        : await selectPortalSchedulingSlotAction({
            requestId: request.id,
            slotId: selectedId!,
            timeZone,
          });
      if (!result.success) {
        setError(
          result.error ??
            "This time is no longer available. Choose another time.",
        );
        router.refresh();
      } else {
        setError(undefined);
        setSelectedId(undefined);
        setAlternatives(false);
        router.refresh();
      }
    });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        className="text-sm text-muted-foreground hover:underline"
        href={`/portal/applications/${request.applicationId}` as Route}
      >
        ← Back to application
      </Link>
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">{request.jobTitle}</p>
        <h1 className="text-2xl font-semibold">
          {open ? "Choose an interview time" : schedulingLabels[request.status]}
        </h1>
        <p className="text-muted-foreground">
          {request.title || request.type.replaceAll("_", " ")} ·{" "}
          {request.durationMins} minutes · {request.mode}
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-destructive"
        >
          {error}
        </p>
      )}
      {!open && accepted && validZone && (
        <p>{formatSlot(accepted.scheduledAt, timeZone)}</p>
      )}
      {open && (
        <>
          {request.status === "pending_review" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h2 className="font-medium">Times proposed — awaiting review</h2>
              <p className="text-sm">
                Your proposed times are requests. They are not confirmed until
                approved by the interview team.
              </p>
            </div>
          )}
          {!alternatives && (
            <>
              <label className="block max-w-sm space-y-1 text-sm">
                Your timezone
                <Input
                  aria-label="Your timezone"
                  value={timeZone}
                  onChange={(e) => setZone(e.target.value)}
                />
              </label>
              {!validZone ? (
                <p role="alert" className="text-sm text-destructive">
                  Choose a valid timezone, such as America/New_York.
                </p>
              ) : (
                <AvailabilityCalendar
                  mode="choose"
                  choices={
                    request.status === "pending_review"
                      ? request.slots.filter((s) => s.status === "proposed")
                      : choices
                  }
                  selectedId={selectedId}
                  onSelect={(choice) => {
                    setSelectedId(choice.id);
                    setError(undefined);
                  }}
                  durationMins={request.durationMins}
                  timeZone={timeZone}
                  today={localCalendarParts(new Date(), timeZone).day}
                  disabled={pending || request.status === "pending_review"}
                />
              )}
              {selected && validZone && request.status !== "pending_review" && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                  <p>{formatSlot(selected.scheduledAt, timeZone)}</p>
                  <Button disabled={pending} onClick={() => submit(false)}>
                    {pending ? "Confirming…" : "Confirm interview time"}
                  </Button>
                </div>
              )}
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setAlternatives(true)}
              >
                None of these work — propose alternatives
              </Button>
            </>
          )}
          {alternatives && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">When are you available?</h2>
              <p className="text-sm text-muted-foreground">
                Select ranges that work for you. The interview team must approve
                a time before it is confirmed.
              </p>
              <SlotFields
                inline
                values={values}
                onChange={setValues}
                durationMins={request.durationMins}
                timeZone={timeZone}
                onTimeZoneChange={setZone}
              />
              <div className="flex gap-2">
                <Button
                  disabled={pending || !values.length || !validZone}
                  onClick={() => submit(true)}
                >
                  {pending ? "Submitting…" : "Send availability for review"}
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => setAlternatives(false)}
                >
                  Back to offered times
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
