"use client";
import { X } from "lucide-react";
import { availabilityRanges } from "./availability-calendar";
import { timeZoneSchema } from "./scheduling-shared";

export function SelectedAvailability({
  values,
  onChange,
  durationMins,
  timeZone,
  disabled,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  durationMins: number;
  timeZone: string;
  disabled?: boolean;
}) {
  if (!timeZoneSchema.safeParse(timeZone).success) return null;
  const ranges = availabilityRanges(values, durationMins, timeZone);
  const format = new Intl.DateTimeFormat("en", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <ul
      aria-label="Selected availability"
      className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
    >
      {ranges.map((range) => {
        const label = `${format.format(new Date(range.start))} – ${format.format(new Date(range.end))}`;
        return (
          <li
            key={range.start}
            className="flex items-center gap-2 rounded-lg border bg-accent/40 py-1 pl-3 pr-1 text-xs"
          >
            <span>{label}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove availability ${label}`}
              className="rounded p-1.5 hover:bg-muted focus-visible:outline-2"
              onClick={() =>
                onChange(
                  values.filter((value) => !range.values.includes(value)),
                )
              }
            >
              <X className="size-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
