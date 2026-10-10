"use client";
import { useSyncExternalStore } from "react";
import { getBrowserTimeZone } from "./shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { timeZoneSchema, type InterviewParticipant } from "./scheduling-shared";

export function SlotFields({
  values,
  onChange,
  timeZone,
  onTimeZoneChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  timeZone: string;
  onTimeZoneChange: (value: string) => void;
}) {
  return (
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
      {values.map((value, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`Proposed time ${i + 1}`}
            type="datetime-local"
            value={value}
            onChange={(e) =>
              onChange(values.map((v, j) => (i === j ? e.target.value : v)))
            }
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(values.filter((_, j) => i !== j))}
            disabled={values.length === 1}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={values.length >= 12}
        onClick={() => onChange([...values, ""])}
      >
        Add possible time
      </Button>
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
