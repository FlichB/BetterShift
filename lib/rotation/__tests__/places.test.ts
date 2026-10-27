import { describe, expect, it } from "vitest";
import { expandDutyPlaces, placeTitles } from "@/lib/rotation/places";
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
const index = { templates: new Map([["s1", "{Vorname} Dienst"]]) };

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
    const result = expandDutyPlaces([empty], { templates: new Map([["s3", "{Vorname} Dienst"]]) }, "Offener Platz");
    expect(result).toEqual([empty]);
  });
});
