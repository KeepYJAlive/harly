import { parseScheduledAt } from "./shared";

export const AVAILABILITY_STEP_MINS = 15;
export const MAX_AVAILABILITY_SLOTS = 1024;

export function localCalendarParts(value: string | Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
export function addCalendarDays(day: string, count: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function calendarWeekStart(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addCalendarDays(day, -((weekday + 6) % 7));
}
export function wallClock(day: string, minutes: number) {
  if (minutes === 1440) return `${addCalendarDays(day, 1)}T00:00`;
  return `${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
/** Expand an offered window into exact starts that fit the entire interview. */
export function rangeToSlots(
  day: string,
  from: number,
  to: number,
  durationMins: number,
  timeZone: string,
) {
  if (
    durationMins < 5 ||
    durationMins > 480 ||
    to <= from ||
    from < 0 ||
    to > 1440
  )
    throw new Error("Choose a valid time range and interview duration.");
  const end = parseScheduledAt(wallClock(day, to), timeZone).getTime();
  const starts: string[] = [];
  for (
    let minute = from;
    minute + durationMins <= to;
    minute += AVAILABILITY_STEP_MINS
  ) {
    const start = parseScheduledAt(wallClock(day, minute), timeZone);
    // Compare elapsed time as well as wall time across DST transitions.
    if (start.getTime() + durationMins * 60_000 <= end)
      starts.push(start.toISOString());
  }
  if (!starts.length)
    throw new Error(
      `Select at least ${durationMins} minutes for this interview.`,
    );
  return starts;
}
export function overlapsReservation(
  start: string,
  durationMins: number,
  reservations: { scheduledAt: Date; durationMins: number }[],
) {
  const from = new Date(start).getTime(),
    to = from + durationMins * 60_000;
  return reservations.some(
    (r) =>
      r.scheduledAt.getTime() < to &&
      r.scheduledAt.getTime() + r.durationMins * 60_000 > from,
  );
}

/** Group consecutive offered starts so a whole selected window can be removed. */
export function availabilityRanges(
  values: string[],
  durationMins: number,
  timeZone: string,
) {
  const ranges: {
    day: string;
    start: string;
    end: string;
    values: string[];
  }[] = [];
  for (const value of [...new Set(values.filter(Boolean))].sort()) {
    const day = localCalendarParts(value, timeZone).day;
    const previous = ranges.at(-1);
    const end = new Date(
      new Date(value).getTime() + durationMins * 60_000,
    ).toISOString();
    if (
      previous &&
      previous.day === day &&
      new Date(value).getTime() -
        new Date(previous.values.at(-1)!).getTime() ===
        AVAILABILITY_STEP_MINS * 60_000
    ) {
      previous.end = end;
      previous.values.push(value);
    } else ranges.push({ day, start: value, end, values: [value] });
  }
  return ranges;
}
