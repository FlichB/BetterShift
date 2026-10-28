import { describe, expect, it } from "vitest";
import { DAY_OFF_COLOR, VACATION_COLOR, vacationIndexEntries, dayOffEntries, dayOffEntriesForDays, expandDutyPlaces, placeTitles } from "@/lib/rotation/places";
import { formatDateToLocal } from "@/lib/date-utils";
import { sortShifts } from "@/lib/shift-display";
import type { ShiftWithCalendar } from "@/lib/types";

const duty = {
  id: "s1",
  calendarId: "c1",
  title: "Samstagsdienst",
  startTime: "09:30",
  endTime: "15:00",
  isAllDay: false,
  signupCapacity: 3,
  signups: [
    { id: "u1", name: "Günther Maier", email: "g@example.at" },
    { id: "u2", name: "Anna Berger", email: "a@example.at" },
  ],
} as unknown as ShiftWithCalendar;
const other = { ...duty, id: "s2", title: "Inventur", signups: [] } as unknown as ShiftWithCalendar;
const index = { templates: new Map([["s1", "{Vorname} Dienst"]]), dayOffs: new Map() };

describe("placeTitles", () => {
  it("one title per holder, then one per free Platz", () => {
    expect(placeTitles(duty, "{Vorname} Dienst", "Offener Platz")).toEqual([
      { userId: "u1", title: "Günther Dienst" },
      { userId: "u2", title: "Anna Dienst" },
      { userId: null, title: "Offener Platz" },
    ]);
  });
});

describe("expandDutyPlaces", () => {
  it("replaces a duty by per-Platz copies and leaves other shifts alone", () => {
    const result = expandDutyPlaces([duty, other], index, "Offener Platz");
    expect(result.map((s) => [s.id, s.title])).toEqual([
      ["s1:u1", "Günther Dienst"],
      ["s1:u2", "Anna Dienst"],
      ["s1:open-0", "Offener Platz"],
      ["s2", "Inventur"],
    ]);
    expect(result[0]).toMatchObject({ startTime: "09:30", endTime: "15:00", signups: [], signupCapacity: null, dutyPlace: { shiftId: "s1", userId: "u1" } });
    expect(result[2].dutyPlace).toEqual({ shiftId: "s1", userId: null });
    expect(result[3]).toBe(other);
  });

  it("keeps a templated duty without holders and capacity visible", () => {
    const empty = { ...duty, id: "s3", signups: [], signupCapacity: null } as unknown as ShiftWithCalendar;
    const result = expandDutyPlaces([empty], { templates: new Map([["s3", "{Vorname} Dienst"]]), dayOffs: new Map() }, "Offener Platz");
    expect(result).toEqual([empty]);
  });
});

describe("dayOffEntries", () => {
  const dayOffIndex = {
    templates: new Map<string, string>(),
    dayOffs: new Map([
      ["2026-11-09", [
        { id: "d1", calendarId: "c1", title: "Günther dienstfrei" },
        { id: "d2", calendarId: "c2", title: "Anna dienstfrei" },
      ]],
    ]),
  };
  const base = { ...duty, calendar: { id: "c1", name: "Team", color: "#123456" } } as ShiftWithCalendar;

  it("builds an all-day rendering entry per Dienstfrei of the base's calendar on that date", () => {
    const result = dayOffEntries("2026-11-09", base, dayOffIndex);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "dayoff:d1",
      calendarId: "c1",
      calendar: { id: "c1", name: "Team", color: "#123456" },
      title: "Günther dienstfrei",
      isAllDay: true,
      startTime: "00:00",
      endTime: "23:59",
      color: DAY_OFF_COLOR,
      signups: [],
      signupCapacity: null,
      dayOff: { id: "d1" },
    });
    expect(formatDateToLocal(result[0].date!)).toBe("2026-11-09");
    expect(result[0].dutyPlace).toBeUndefined();
  });

  it("returns every calendar's entries without a base and none on other dates", () => {
    expect(dayOffEntries("2026-11-09", null, dayOffIndex).map((e) => e.dayOff?.id)).toEqual(["d1", "d2"]);
    expect(dayOffEntries("2026-11-10", base, dayOffIndex)).toEqual([]);
  });
});

describe("dayOffEntriesForDays", () => {
  const dayOffIndex = {
    templates: new Map<string, string>(),
    dayOffs: new Map([
      ["2026-11-09", [
        { id: "d1", calendarId: "c1", title: "Günther dienstfrei" },
        { id: "d2", calendarId: "c2", title: "Anna dienstfrei" },
      ]],
      ["2026-12-01", [{ id: "d3", calendarId: "c1", title: "Günther dienstfrei" }]],
    ]),
  };
  const team = { id: "c1", name: "Team", color: "#123456" };

  it("builds entries for the shown calendar on the rendered dates without any shift in view", () => {
    const result = dayOffEntriesForDays(["2026-11-09", "2026-11-10"], [team], dayOffIndex);
    expect(result.map((e) => [e.id, e.calendarId, e.calendar])).toEqual([["dayoff:d1", "c1", team]]);
    expect(dayOffEntriesForDays(["2026-11-09"], [], dayOffIndex)).toEqual([]);
  });

  it("sorts after real shifts whatever the sort order", () => {
    const [entry] = dayOffEntriesForDays(["2026-11-09"], [team], dayOffIndex);
    for (const order of ["asc", "desc"] as const) {
      expect(sortShifts([entry, duty], "startTime", order).map((s) => s.id)).toEqual(["s1", "dayoff:d1"]);
      expect(sortShifts([entry, duty], "title", order).map((s) => s.id)).toEqual(["s1", "dayoff:d1"]);
    }
  });
});

it("[fork] renders vacation entries with their own colour and marker", () => {
  const index = { templates: new Map(), dayOffs: new Map([["2026-12-07", [{ id: "v1", calendarId: "c1", title: "Mia Urlaub", kind: "vacation" as const }]]]) };
  const [entry] = dayOffEntries("2026-12-07", null, index);
  expect(entry).toMatchObject({ id: "vacation:v1:2026-12-07", title: "Mia Urlaub", color: VACATION_COLOR, vacation: { id: "v1" } });
  expect(entry.dayOff).toBeUndefined();
});

it("[fork] expands a vacation range into one index entry per day", () => {
  const map = vacationIndexEntries([{ id: "v1", startDate: "2026-12-07", endDate: "2026-12-09", name: "Mia Muster", email: null }], "c1", (name) => `${name} Urlaub`);
  expect([...map.keys()]).toEqual(["2026-12-07", "2026-12-08", "2026-12-09"]);
  expect(map.get("2026-12-08")).toEqual([{ id: "v1", calendarId: "c1", title: "Mia Urlaub", kind: "vacation" }]);
});
