"use client";
import { useSyncExternalStore } from "react";
import { getBrowserTimeZone } from "./shared";
import { Input } from "@/components/ui/input";
import { SelectedAvailability } from "./SelectedAvailability";
import { AvailabilityCalendarDialog } from "./AvailabilityCalendarDialog";
import { AvailabilityCalendar } from "./AvailabilityCalendar";
import { localCalendarParts } from "./availability-calendar";
import { timeZoneSchema, type InterviewParticipant } from "./scheduling-shared";

export function SlotFields({
  values,
  onChange,
  timeZone,
  onTimeZoneChange,
  durationMins,
  inline = false,
}: {
  inline?: boolean;
  durationMins: number;
  values: string[];
  onChange: (values: string[]) => void;
  timeZone: string;
  onTimeZoneChange: (value: string) => void;
}) {
  const fields = (
    <div className="space-y-2">
      <label className="block text-sm">
        Timezone (IANA)
        <Input
          value={timeZone}
          onChange={(e) => onTimeZoneChange(e.target.value)}
          placeholder="America/Los_Angeles"
        />
      </label>
      {!timeZoneSchema.safeParse(timeZone).success && (
        <p role="alert" className="text-sm text-destructive">
          Enter a valid timezone, such as America/New_York.
        </p>
      )}
      {timeZoneSchema.safeParse(timeZone).success && (
        <AvailabilityCalendar
          mode="offer"
          values={values}
          onChange={onChange}
          timeZone={timeZone}
          durationMins={durationMins}
          today={localCalendarParts(new Date(), timeZone).day}
        />
      )}
    </div>
  );
  if (inline) return fields;
  return (
    <div className="space-y-2">
      <AvailabilityCalendarDialog>{fields}</AvailabilityCalendarDialog>
      <p className="text-sm text-muted-foreground">
        {values.filter(Boolean).length
          ? `${values.filter(Boolean).length} available start times selected`
          : "Select time ranges in the availability calendar."}
      </p>
      <SelectedAvailability
        values={values}
        onChange={onChange}
        durationMins={durationMins}
        timeZone={timeZone}
      />
    </div>
  );
}
export function InterviewTeamFields({
  members,
  lead,
  value,
  onChange,
}: {
  members: { userId: string; name: string }[];
  lead: string;
  value: InterviewParticipant[];
  onChange: (value: InterviewParticipant[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        Additional interview participants
      </legend>
      {members
        .filter((m) => m.userId !== lead)
        .map((m) => (
          <label
            key={m.userId}
            className="flex items-center justify-between gap-2 text-sm"
          >
            {m.name}
            <select
              aria-label={`${m.name} role`}
              className="rounded border bg-background p-1"
              value={value.find((p) => p.userId === m.userId)?.role ?? "none"}
              onChange={(e) =>
                onChange([
                  ...value.filter((p) => p.userId !== m.userId),
                  ...(e.target.value === "none"
                    ? []
                    : [
                        {
                          userId: m.userId,
                          role: e.target.value as "interviewer" | "observer",
                        },
                      ]),
                ])
              }
            >
              <option value="none">Not participating</option>
              <option value="interviewer">Interviewer</option>
              <option value="observer">Observer</option>
            </select>
          </label>
        ))}
    </fieldset>
  );
}

const subscribeToTimeZone = () => () => undefined;
/** Match the server snapshot during hydration, then use the browser's zone. */
export function useBrowserTimeZone() {
  return useSyncExternalStore(
    subscribeToTimeZone,
    getBrowserTimeZone,
    () => "UTC",
  );
}
