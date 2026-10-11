import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarWeekStart,
  localCalendarParts,
  overlapsReservation,
  rangeToSlots,
} from "./availability-calendar";
import { parseSlots } from "./scheduling-shared";

describe("two-week interview availability", () => {
  it("expands a range into starts that fit the full interview", () => {
    expect(
      rangeToSlots("2099-06-01", 13 * 60, 15 * 60, 45, "America/Los_Angeles"),
    ).toEqual([
      "2099-06-01T20:00:00.000Z",
      "2099-06-01T20:15:00.000Z",
      "2099-06-01T20:30:00.000Z",
      "2099-06-01T20:45:00.000Z",
      "2099-06-01T21:00:00.000Z",
      "2099-06-01T21:15:00.000Z",
    ]);
  });
  it("keeps the same instant when displaying candidate timezone", () => {
    const [slot] = rangeToSlots(
      "2099-06-01",
      15 * 60,
      16 * 60,
      60,
      "America/Los_Angeles",
    );
    expect(localCalendarParts(slot, "America/New_York")).toEqual({
      day: "2099-06-01",
      minutes: 18 * 60,
    });
  });
  it("navigates by calendar days across month and DST boundaries", () => {
    expect(calendarWeekStart("2027-03-14")).toBe("2027-03-08");
    expect(addCalendarDays("2027-03-08", 7)).toBe("2027-03-15");
    expect(addCalendarDays("2027-12-27", 13)).toBe("2028-01-09");
  });
  it("rejects too-short ranges and nonexistent DST times", () => {
    expect(() => rangeToSlots("2099-06-01", 600, 630, 45, "UTC")).toThrow(
      /at least 45/,
    );
    expect(() =>
      rangeToSlots("2027-03-14", 120, 180, 30, "America/Los_Angeles"),
    ).toThrow(/daylight saving/);
  });
  it("supports broad two-week availability without the old twelve-slot limit", () => {
    const slots = rangeToSlots("2099-06-01", 9 * 60, 17 * 60, 45, "UTC");
    expect(slots.length).toBeGreaterThan(12);
    expect(parseSlots(slots, "UTC")).toHaveLength(slots.length);
  });
  it("excludes overlapping master reservations but allows adjacent bookings", () => {
    const busy = [
      { scheduledAt: new Date("2099-06-01T14:00Z"), durationMins: 60 },
    ];
    expect(overlapsReservation("2099-06-01T13:30Z", 45, busy)).toBe(true);
    expect(overlapsReservation("2099-06-01T13:15Z", 45, busy)).toBe(false);
    expect(overlapsReservation("2099-06-01T15:00Z", 45, busy)).toBe(false);
  });
});
