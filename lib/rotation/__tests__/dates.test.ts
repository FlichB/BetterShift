import { describe, expect, it } from "vitest";
import {
  addDays,
  fromDayNumber,
  hasStarted,
  isValidLocalDate,
  isoWeekday,
  mondayOf,
  toDayNumber,
} from "@/lib/rotation/dates";

describe("dates", () => {
  it("round-trips day numbers", () => {
    expect(fromDayNumber(toDayNumber("2026-11-07"))).toBe("2026-11-07");
    expect(toDayNumber("1970-01-01")).toBe(0);
  });

  it("computes ISO weekdays", () => {
    expect(isoWeekday(toDayNumber("2026-11-02"))).toBe(1); // Monday
    expect(isoWeekday(toDayNumber("2026-11-07"))).toBe(6); // Saturday
    expect(isoWeekday(toDayNumber("2026-11-08"))).toBe(7); // Sunday
  });

  it("finds the Monday of a week", () => {
    expect(fromDayNumber(mondayOf(toDayNumber("2026-11-08")))).toBe("2026-11-02");
    expect(fromDayNumber(mondayOf(toDayNumber("2026-11-02")))).toBe("2026-11-02");
  });

  it("adds days across DST and year boundaries", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("validates local dates", () => {
    expect(isValidLocalDate("2026-02-28")).toBe(true);
    expect(isValidLocalDate("2026-02-30")).toBe(false);
    expect(isValidLocalDate("2026-2-3")).toBe(false);
  });

  it("treats a duty as started from its local start time", () => {
    const now = new Date(2026, 10, 7, 9, 29); // 2026-11-07 09:29 local
    expect(hasStarted("2026-11-07", "09:30", now)).toBe(false);
    expect(hasStarted("2026-11-07", "09:29", now)).toBe(true);
    expect(hasStarted("2026-11-06", "09:30", now)).toBe(true);
  });
});
