"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addCalendarDays,
  availabilityRanges,
  calendarWeekStart,
  localCalendarParts,
  MAX_AVAILABILITY_SLOTS,
  rangeToSlots,
} from "./availability-calendar";
import { formatSlot } from "./scheduling-shared";

type Choice = { id: string; scheduledAt: string };
type Props = {
  timeZone: string;
  durationMins: number;
  today: string;
  disabled?: boolean;
} & (
  | { mode: "offer"; values: string[]; onChange: (values: string[]) => void }
  | {
      mode: "choose";
      choices: Choice[];
      selectedId?: string;
      onSelect: (choice: Choice) => void;
    }
);
const ROW_HEIGHT = 24;
const clockLabel = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function AvailabilityCalendar(props: Props) {
  const { timeZone, durationMins, today, disabled } = props;
  const [weekOffset, setWeekOffset] = useState(0);
  const [allHours, setAllHours] = useState(false);
  const [drag, setDrag] = useState<{
    day: string;
    from: number;
    to: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startDay = addCalendarDays(calendarWeekStart(today), weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) =>
    addCalendarDays(startDay, i),
  );
  const now = localCalendarParts(new Date(), timeZone);
  const isPast = (day: string, minute: number) =>
    day < today || day < now.day || (day === now.day && minute <= now.minutes);
  const values = props.mode === "offer" ? props.values : undefined;
  const choices = props.mode === "choose" ? props.choices : undefined;
  const entries = useMemo(
    () =>
      values
        ? values
            .filter(Boolean)
            .map((scheduledAt) => ({ id: scheduledAt, scheduledAt }))
        : (choices ?? []),
    [values, choices],
  );
  const mapped = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        ...localCalendarParts(entry.scheduledAt, timeZone),
      })),
    [entries, timeZone],
  );
  const ranges = useMemo(
    () => availabilityRanges(values ?? [], durationMins, timeZone),
    [values, durationMins, timeZone],
  );
  const visible = mapped.filter((entry) => days.includes(entry.day));
  const startHour = allHours
    ? 0
    : Math.min(8, ...visible.map((e) => Math.floor(e.minutes / 60)));
  const endHour = allHours
    ? 24
    : Math.min(
        24,
        Math.max(
          20,
          ...visible.map((e) => Math.ceil((e.minutes + durationMins) / 60)),
        ),
      );
  const minutes = Array.from(
    { length: (endHour - startHour) * 4 },
    (_, i) => startHour * 60 + i * 15,
  );
  const selected = useMemo(
    () => new Set(entries.map((e) => e.scheduledAt)),
    [entries],
  );
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat("en", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${day}T12:00Z`));

  function applyRange(day: string, from: number, to: number) {
    if (props.mode !== "offer" || disabled || isPast(day, Math.min(from, to)))
      return;
    try {
      const starts = rangeToSlots(
        day,
        Math.min(from, to),
        Math.max(from, to) + 15,
        durationMins,
        timeZone,
      );
      if (starts.some((s) => new Date(s).getTime() <= Date.now()))
        throw new Error("Choose a future time range.");
      const remove = starts.every((s) => selected.has(s));
      const next = remove
        ? [...selected].filter((s) => !starts.includes(s))
        : [...new Set([...selected, ...starts])].sort();
      if (next.length > MAX_AVAILABILITY_SLOTS)
        throw new Error("Choose fewer availability ranges before adding more.");
      props.onChange(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Choose another range.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {dayLabel(days[0])} – {dayLabel(days[6])}
          </p>
          <p className="text-xs text-muted-foreground">
            Weekly availability · {timeZone} · {durationMins} minutes
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Previous week"
            disabled={weekOffset <= 0}
            onClick={() => setWeekOffset((v) => Math.max(0, v - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset(0)}
          >
            This week
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Next week"
            onClick={() => setWeekOffset((v) => v + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {props.mode === "offer"
          ? "Drag down a day to select a time range. Select a highlighted range again to remove it. You can also click a start time to offer one interview."
          : "Select an available start time. Only times offered for your interview appear here."}
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={allHours}
          onChange={(e) => setAllHours(e.target.checked)}
        />
        Show all 24 hours
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="min-w-[700px]">
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b bg-muted/40">
            <span className="p-2 text-xs text-muted-foreground">Time</span>
            {days.map((day) => (
              <div
                key={day}
                className={cn(
                  "border-l p-2 text-center text-xs font-medium",
                  day === today && "bg-primary/10 text-primary",
                  day < today && "bg-muted text-muted-foreground opacity-60",
                )}
              >
                {dayLabel(day)}
              </div>
            ))}
          </div>
          <div className="h-[min(56dvh,640px)] overflow-y-auto">
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
              <div>
                {minutes.map((minute) => (
                  <div
                    key={minute}
                    style={{ height: ROW_HEIGHT }}
                    className="pr-2 text-right text-[10px] text-muted-foreground"
                  >
                    {minute % 60 === 0 ? clockLabel(minute) : ""}
                  </div>
                ))}
              </div>
              {days.map((day) => (
                <div
                  key={day}
                  className={cn(
                    "relative border-l",
                    day < today && "bg-muted/60",
                  )}
                  style={{
                    touchAction: props.mode === "offer" ? "none" : "auto",
                  }}
                  onPointerMove={(e) => {
                    if (!drag || drag.day !== day) return;
                    const row = Math.max(
                      0,
                      Math.min(
                        minutes.length - 1,
                        Math.floor(
                          (e.clientY -
                            e.currentTarget.getBoundingClientRect().top) /
                            ROW_HEIGHT,
                        ),
                      ),
                    );
                    if (!isPast(day, minutes[row]))
                      setDrag({ ...drag, to: minutes[row] });
                  }}
                  onPointerUp={(e) => {
                    if (!drag) return;
                    const current = drag;
                    setDrag(null);
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    applyRange(
                      current.day,
                      current.from,
                      current.to === current.from
                        ? current.from + Math.ceil(durationMins / 15) * 15 - 15
                        : current.to,
                    );
                  }}
                  onPointerCancel={() => setDrag(null)}
                >
                  {minutes.map((minute) => {
                    const past = isPast(day, minute);
                    const choices = mapped.filter(
                      (entry) =>
                        entry.day === day &&
                        entry.minutes >= minute &&
                        entry.minutes < minute + 15,
                    );
                    const highlighted =
                      props.mode === "offer" &&
                      mapped.some(
                        (entry) =>
                          entry.day === day &&
                          entry.minutes <= minute &&
                          entry.minutes + durationMins > minute,
                      );
                    const preview =
                      drag?.day === day &&
                      minute >= Math.min(drag.from, drag.to) &&
                      minute <= Math.max(drag.from, drag.to);
                    return (
                      <div
                        key={minute}
                        style={{ height: ROW_HEIGHT }}
                        className={cn(
                          "border-t",
                          minute % 60 === 0
                            ? "border-border"
                            : "border-border/30",
                          highlighted && "bg-primary/20",
                          preview && "bg-primary/40",
                          past && "bg-muted/60 opacity-50",
                        )}
                      >
                        {props.mode === "offer" ? (
                          <button
                            type="button"
                            disabled={disabled || past}
                            aria-label={`${dayLabel(day)} ${clockLabel(minute)}, offer ${durationMins} minutes`}
                            aria-pressed={highlighted}
                            className="h-full w-full enabled:hover:bg-primary/15 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                            onPointerDown={(e) => {
                              if (e.button !== 0 || disabled || past) return;
                              e.preventDefault();
                              e.currentTarget.parentElement?.parentElement?.setPointerCapture(
                                e.pointerId,
                              );
                              setDrag({ day, from: minute, to: minute });
                            }}
                            onClick={(e) => {
                              if (e.detail === 0)
                                applyRange(
                                  day,
                                  minute,
                                  minute +
                                    Math.ceil(durationMins / 15) * 15 -
                                    15,
                                );
                            }}
                          >
                            {minute % 60 === 0 && highlighted && (
                              <span className="text-[10px] text-primary">
                                Available
                              </span>
                            )}
                          </button>
                        ) : (
                          choices.map((choice) => (
                            <button
                              key={choice.id}
                              type="button"
                              disabled={disabled || past}
                              aria-label={formatSlot(
                                choice.scheduledAt,
                                timeZone,
                              )}
                              aria-pressed={props.selectedId === choice.id}
                              onClick={() => props.onSelect(choice)}
                              className={cn(
                                "h-full w-full rounded border border-primary/25 bg-primary/10 text-xs font-medium text-primary hover:bg-primary/25 focus-visible:outline",
                                props.selectedId === choice.id &&
                                  "bg-primary text-primary-foreground",
                              )}
                            >
                              {clockLabel(choice.minutes)}
                            </button>
                          ))
                        )}
                      </div>
                    );
                  })}
                  {props.mode === "offer" &&
                    ranges
                      .filter((range) => range.day === day)
                      .map((range) => (
                        <button
                          key={range.start}
                          type="button"
                          disabled={disabled}
                          aria-label={`Remove availability ${formatSlot(range.start, timeZone)}`}
                          className="absolute right-1 z-10 rounded bg-background/90 p-1 shadow-sm hover:bg-muted focus-visible:outline-2"
                          style={{
                            top:
                              ((localCalendarParts(range.start, timeZone)
                                .minutes -
                                startHour * 60) /
                                15) *
                              ROW_HEIGHT,
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onPointerUp={(event) => event.stopPropagation()}
                          onClick={() =>
                            props.onChange(
                              props.values.filter(
                                (value) => !range.values.includes(value),
                              ),
                            )
                          }
                        >
                          <X className="size-3" />
                        </button>
                      ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {props.mode === "offer" ? (
        <div className="flex items-center justify-between text-sm">
          <span>{entries.length} available start times</span>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || !entries.length}
            onClick={() => props.onChange([])}
          >
            Clear availability
          </Button>
        </div>
      ) : (
        !visible.length && (
          <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            No available times this week. Browse another week or propose
            alternatives.
          </p>
        )
      )}
    </div>
  );
}
