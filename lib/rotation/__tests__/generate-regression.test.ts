// Frozen output of the generator before verstärkte Tage (2026-10-27). Never update this snapshot:
// without verstärkte Tage the seat-stream generator must produce exactly these plans.
import { describe, expect, it } from "vitest";
import { generateDays } from "@/lib/rotation/generate";
import type { RotationRule } from "@/lib/rotation/types";

const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
const base: RotationRule = {
  memberIds: eight,
  perShift: 2,
  period: "week",
  periodDays: null,
  startDate: "2026-11-02",
  startOffset: 0,
  weekdays: [6],
  closedDates: [],
  openHolidays: [],
  reinforcedDates: [],
};

const cases: [string, RotationRule][] = [
  ["8/2 Samstag", base],
  ["7/2 Samstag", { ...base, memberIds: eight.slice(0, 7) }],
  ["6/2 Samstag ab Jänner", { ...base, memberIds: eight.slice(0, 6), startDate: "2027-01-01" }],
  ["8/1 Samstag", { ...base, perShift: 1 }],
  ["8/3 Samstag", { ...base, perShift: 3 }],
  ["7/3 Samstag", { ...base, memberIds: eight.slice(0, 7), perShift: 3 }],
  ["8/2 Tag Mo–Fr", { ...base, period: "day", weekdays: [1, 2, 3, 4, 5] }],
  ["8/2 alle 3 Tage", { ...base, period: "days", periodDays: 3, weekdays: [] }],
  [
    "8/2 Offset 5 mit Schließtagen",
    {
      ...base,
      startOffset: 5,
      closedDates: [
        { date: "2026-12-26", reason: "Inventur", source: "skip" },
        { date: "2027-03-06", reason: "Feiertag", source: "holiday" },
      ],
    },
  ],
  ["8/2 Start Mittwoch", { ...base, startDate: "2026-11-04" }],
];

describe("generator regression (no verstärkte Tage)", () => {
  it.each(cases)("%s", (_label, rule) => {
    const { duties, closures } = generateDays(rule, "2026-11-01", "2029-12-31");
    expect({
      duties: duties.map((d) => `${d.date} ${d.userIds.join("")}${d.openHoliday ? ` ${d.openHoliday}` : ""}`),
      closures: closures.map((c) => c.date),
    }).toMatchSnapshot();
  });
});
